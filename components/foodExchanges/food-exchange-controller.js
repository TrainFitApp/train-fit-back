const mongoose = require("mongoose");
const FoodExchangeGroup = require("./food-exchange-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");
const NutritionalGoal = require("../nutritionalGoals/nutritional-goal-schema");

// Lo mínimo del producto para pintar una card de alimento en el constructor
// de dietas (nombre + macros por 100 g). No el documento entero: un grupo
// puede tener 20 alimentos y el resto del producto (micros, alérgenos,
// trazas) no se usa para nada en esta pantalla.
const PRODUCT_CARD_FIELDS =
  "name brand productQuantity energyKcal100g protein100g carbohydrates100g fat100g";

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return "Un grupo de intercambio necesita al menos 2 alimentos";
  }
  if (items.length > 20) return "Un grupo admite como mucho 20 alimentos";
  for (const item of items) {
    if (!item?.name?.trim()) return "Cada alimento necesita un nombre";
    if (!(Number(item.quantity) > 0)) return `"${item.name}" necesita una cantidad mayor que 0`;
    if (!item?.unit?.trim()) return `"${item.name}" necesita una unidad`;
  }
  return null;
}

const VALID_BASES = new Set(["protein", "carbs", "fat", "kcal"]);

// Movimiento 5 Coach Pro — base numérica del grupo. Los dos campos van
// juntos o no van: una base sin cantidad ("iguala hidratos", ¿cuántos?) no
// permite calcular nada, y una cantidad sin base no significa nada.
function buildBasis(body) {
  const basis = VALID_BASES.has(body?.basis) ? body.basis : null;
  const amount = Number(body?.basisAmount);
  if (!basis || !Number.isFinite(amount) || amount <= 0) {
    return { basis: null, basisAmount: null };
  }
  return { basis, basisAmount: amount };
}

// El front devuelve el item tal y como lo recibió, y en listMine `productId`
// viaja separado del producto poblado (ver toClientShape) — pero un cliente
// viejo, o uno que no haya separado bien, puede mandar el objeto entero. Se
// acepta el id que traiga dentro en vez de dejar que Mongoose reviente con un
// CastError 500 en algo que es un 400 del cliente.
function readProductId(raw) {
  const id = raw && typeof raw === "object" ? raw._id : raw;
  return id && mongoose.isValidObjectId(id) ? String(id) : null;
}

function buildPayload(body) {
  return {
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim(),
    equivalenceNote: String(body.equivalenceNote || "").trim(),
    ...buildBasis(body),
    items: (body.items || []).map((item) => ({
      productId: readProductId(item.productId),
      name: String(item.name).trim(),
      quantity: Number(item.quantity),
      unit: String(item.unit || "g").trim(),
      note: String(item.note || "").trim(),
    })),
  };
}

// `populate` deja el producto DENTRO de `productId`, y eso obligaría al front
// a distinguir "id" de "objeto" en cada lectura y a volver a aplanarlo al
// guardar. Se devuelven los dos campos separados: `productId` sigue siendo un
// id como siempre (los clientes anteriores a esto no notan nada) y `product`
// es el añadido.
// Ojo con el `instanceof`: un ObjectId responde a `._id` devolviéndose a sí
// mismo, así que "tiene _id" NO distingue un producto poblado de una ref sin
// poblar (producto borrado). Hay que preguntar por el tipo.
function isPopulatedProduct(value) {
  return !!value && typeof value === "object" && !(value instanceof mongoose.Types.ObjectId);
}

function toClientShape(group) {
  return {
    ...group,
    items: (group.items || []).map(({ productId, ...item }) => {
      const product = isPopulatedProduct(productId) ? productId : null;
      return {
        ...item,
        productId: product ? String(product._id) : productId ? String(productId) : null,
        // null y no ausente: distingue "no vinculado" de "vinculado a un
        // producto que ya no existe" — populate deja null en ese caso, y el
        // front necesita poder decirlo.
        product,
      };
    }),
  };
}

module.exports = {
  // GET /trainer/food-exchanges
  //
  // Único endpoint que puebla el producto: es el que alimenta el generador de
  // alternativas del constructor de dietas, y ahí hacen falta las macros para
  // pintar la card del alimento. Los endpoints del cliente NO lo pueblan — su
  // pantalla enseña nombre y cantidad, y cargar el producto entero por cada
  // alimento de cada grupo sería pagar por algo que no se mira.
  async listMine(req, res) {
    const groups = await FoodExchangeGroup.find({ trainerId: req.auth.userId })
      .populate({ path: "items.productId", select: PRODUCT_CARD_FIELDS })
      .sort({ category: 1, name: 1 })
      .lean();
    return res.send(groups.map(toClientShape));
  },

  async create(req, res) {
    const body = req.body || {};
    if (!body.name?.trim()) {
      return res.status(400).send({ message: "El grupo necesita un nombre" });
    }
    const itemsError = validateItems(body.items);
    if (itemsError) return res.status(400).send({ message: itemsError });

    try {
      const group = await FoodExchangeGroup.create({
        trainerId: req.auth.userId,
        ...buildPayload(body),
      });
      return res.status(201).send(group);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes un grupo con ese nombre" });
      }
      throw e;
    }
  },

  async update(req, res) {
    const body = req.body || {};
    const itemsError = validateItems(body.items);
    if (itemsError) return res.status(400).send({ message: itemsError });

    try {
      const group = await FoodExchangeGroup.findOneAndUpdate(
        { _id: req.params.id, trainerId: req.auth.userId },
        { $set: { ...buildPayload(body), updatedAt: new Date() } },
        { new: true, runValidators: true }
      ).lean();
      if (!group) return res.status(404).send({ message: "Grupo no encontrado" });
      return res.send(group);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes un grupo con ese nombre" });
      }
      throw e;
    }
  },

  async remove(req, res) {
    const group = await FoodExchangeGroup.findOneAndDelete({
      _id: req.params.id,
      trainerId: req.auth.userId,
    });
    if (!group) return res.status(404).send({ message: "Grupo no encontrado" });
    return res.sendStatus(204);
  },

  // GET /trainer/food-exchanges/my-plan — lado CLIENTE.
  //
  // Las dos mitades de su pantalla en UNA petición, porque una sin la otra no
  // sirve: el reparto ("2 raciones de proteína en la comida") no dice qué
  // puede comer, y los grupos sin el reparto no dicen cuánto.
  //
  // `groups` son TODOS los del profesional que lleva su nutrición, no solo los
  // que aparecen en el reparto. Antes eran solo esos, y eso dejaba dos
  // agujeros: un profesional que creaba grupos en su biblioteca y no los
  // repartía en el objetivo no se los enseñaba a nadie, y la sección "Todos
  // tus intercambios" de la pantalla solo podía mostrar un subconjunto de la
  // de arriba, es decir, nada nuevo.
  async getMyPlan(req, res) {
    const [user, relations] = await Promise.all([
      userSchema.findById(req.auth.userId).select("goalInUse").lean(),
      trainerClientDao.findActiveByClient(req.auth.userId),
    ]);

    const goal = user?.goalInUse
      ? await NutritionalGoal.findById(user.goalInUse).select("mealExchanges").lean()
      : null;
    const meals = goal?.mealExchanges || [];

    const trainerIds = [
      ...new Set(
        relations.filter((r) => r.scope === "nutrition").map((r) => String(r.trainerId))
      ),
    ];
    // Los grupos referenciados por el reparto van SIEMPRE, aunque su
    // profesional ya no lleve a este cliente: si no, una relación terminada
    // vaciaría de alimentos una pauta que el cliente sigue viendo.
    const referencedIds = [
      ...new Set(
        meals.flatMap((meal) =>
          (meal.exchanges || []).map((exchange) => String(exchange.groupId))
        )
      ),
    ];
    if (!trainerIds.length && !referencedIds.length) return res.send({ meals, groups: [] });

    const groups = await FoodExchangeGroup.find({
      $or: [{ trainerId: { $in: trainerIds } }, { _id: { $in: referencedIds } }],
    })
      .select("name category equivalenceNote items")
      .sort({ category: 1, name: 1 })
      .lean();

    // El reparto se devuelve TAL CUAL, aunque algún grupo ya no exista: la
    // pauta guarda groupName, así que el cliente sigue leyendo "2 raciones
    // de Proteína" y la pantalla dice que ese grupo ya no está disponible.
    // Filtrarlo aquí haría desaparecer parte de su pauta sin explicación.
    return res.send({ meals, groups });
  },
};
