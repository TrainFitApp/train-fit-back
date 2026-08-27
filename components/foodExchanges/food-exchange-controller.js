const FoodExchangeGroup = require("./food-exchange-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");
const NutritionalGoal = require("../nutritionalGoals/nutritional-goal-schema");

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

function buildPayload(body) {
  return {
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim(),
    equivalenceNote: String(body.equivalenceNote || "").trim(),
    ...buildBasis(body),
    items: (body.items || []).map((item) => ({
      productId: item.productId || null,
      name: String(item.name).trim(),
      quantity: Number(item.quantity),
      unit: String(item.unit || "g").trim(),
      note: String(item.note || "").trim(),
    })),
  };
}

module.exports = {
  // GET /trainer/food-exchanges
  async listMine(req, res) {
    const groups = await FoodExchangeGroup.find({ trainerId: req.auth.userId })
      .sort({ category: 1, name: 1 })
      .lean();
    return res.send(groups);
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

  // GET /food-exchanges/mine — lado CLIENTE: los grupos de los profesionales
  // con los que tiene relación activa de nutrición. Es la mitad que da
  // sentido a la funcionalidad: un intercambio que el cliente no ve no
  // sirve de nada.
  async listForClient(req, res) {
    const relations = await trainerClientDao.findActiveByClient(req.auth.userId);
    const trainerIds = [
      ...new Set(
        relations.filter((r) => r.scope === "nutrition").map((r) => String(r.trainerId))
      ),
    ];
    if (!trainerIds.length) return res.send([]);

    const groups = await FoodExchangeGroup.find({ trainerId: { $in: trainerIds } })
      .sort({ category: 1, name: 1 })
      .lean();
    return res.send(groups);
  },

  // GET /trainer/food-exchanges/my-plan — lado CLIENTE, Movimiento 5.
  //
  // El reparto por comidas de su objetivo vigente, MÁS los grupos a los que
  // apunta. Las dos mitades en una petición porque una sin la otra no sirve:
  // "2 raciones de proteína en la comida" no dice qué puede comer, y la
  // lista de grupos sin el reparto no dice cuánto.
  //
  // Solo se devuelven los grupos REFERENCIADOS por el reparto, no todos los
  // del profesional: en esta pantalla el cliente sigue una pauta, y para
  // consultar el catálogo entero ya está /food-exchanges/mine.
  async getMyPlan(req, res) {
    const user = await userSchema.findById(req.auth.userId).select("goalInUse").lean();
    if (!user?.goalInUse) return res.send({ meals: [], groups: [] });

    const goal = await NutritionalGoal.findById(user.goalInUse).select("mealExchanges").lean();
    const meals = goal?.mealExchanges || [];
    if (!meals.length) return res.send({ meals: [], groups: [] });

    const groupIds = [
      ...new Set(
        meals.flatMap((meal) =>
          (meal.exchanges || []).map((exchange) => String(exchange.groupId))
        )
      ),
    ];

    const groups = await FoodExchangeGroup.find({ _id: { $in: groupIds } })
      .select("name category equivalenceNote items")
      .lean();

    // El reparto se devuelve TAL CUAL, aunque algún grupo ya no exista: la
    // pauta guarda groupName, así que el cliente sigue leyendo "2 raciones
    // de Proteína" y la pantalla dice que ese grupo ya no está disponible.
    // Filtrarlo aquí haría desaparecer parte de su pauta sin explicación.
    return res.send({ meals, groups });
  },
};
