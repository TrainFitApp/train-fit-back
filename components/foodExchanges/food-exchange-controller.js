const mongoose = require("mongoose");
const FoodExchangeGroup = require("./food-exchange-schema");
const Product = require("../products/product-schema");
const {
  MACROS,
  computeServing,
  groupStatus,
  hasServing,
  isDeclared,
  itemDeviation,
  itemMacros,
} = require("./exchange-profile");
const { STARTER_GROUPS, REFERENCE_PROFILES } = require("./starter-pack");
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
const VALID_ROLES = new Set(["carb", "protein", "fat", "vegetable", "fruit", "dairy"]);

// Las macros por 100 g de los productos vinculados, para poder calcular el
// perfil de la ración al guardar. Solo los alimentos con productId: un grupo
// escrito a mano sigue siendo válido y no dispara ninguna consulta.
async function loadProducts(items) {
  const ids = (items || [])
    .map((item) => readProductId(item.productId))
    .filter(Boolean);
  if (!ids.length) return new Map();

  const products = await Product.find({ _id: { $in: [...new Set(ids)] } })
    .select("energyKcal100g protein100g carbohydrates100g fat100g")
    .lean();
  return new Map(products.map((product) => [String(product._id), product]));
}

/**
 * El perfil de UNA ración del grupo: `anchor` + `serving`.
 *
 * Cada macro por separado: lo que el entrenador escribe gana, y lo que deja
 * en blanco se rellena con las macros de los productos vinculados.
 *
 * Los dos caminos hacen falta, y el segundo NO basta. En los grupos reales de
 * `pre`, 15 de 19 alimentos no están vinculados a ningún producto — un
 * entrenador escribe "85 g de patata" y sigue, que es lo razonable. Si el
 * perfil solo pudiera salir del catálogo, el cuadre del día no se podría
 * calcular para casi nadie. Y al revés: las tablas de intercambio publicadas
 * dan el perfil hecho (1 ración de almidón = 80 kcal, 15 g HC, 3 g P, 0-1 g
 * G), así que teclear cuatro cifras una vez por grupo es MENOS trabajo que
 * buscar y vincular seis productos.
 *
 * Lo que no se acepta del cliente es un macro que él no ha declarado: ese se
 * recalcula siempre aquí. Si el front mandara un perfil desfasado quedaría
 * guardado como bueno y descuadraría los repartos sin que se viera.
 *
 * Compatible con las apps publicadas: si llegan `basis`/`basisAmount` en vez
 * de `anchor`/`serving`, se leen igual — es el mismo dato con otro nombre.
 */
function buildProfile(body, items, productsById) {
  const anchor = VALID_BASES.has(body?.anchor)
    ? body.anchor
    : VALID_BASES.has(body?.basis)
    ? body.basis
    : null;

  // Los productos se pegan al item solo para el cálculo; lo que se guarda
  // sigue siendo el item pelado (ver buildPayload).
  const withProducts = (items || []).map((item) => ({
    ...item,
    product: item.productId ? productsById.get(String(item.productId)) || null : null,
  }));
  const { serving } = computeServing(withProducts);

  // Lo que él declara gana sobre lo calculado, macro a macro: el catálogo
  // puede estar mal o incompleto, su criterio no se discute.
  const declaredByHand = {};
  for (const macro of MACROS) {
    const value = Number(body?.serving?.[macro]);
    if (isDeclared(body?.serving?.[macro]) && value >= 0) declaredByHand[macro] = value;
  }
  // `basisAmount` de las apps publicadas: es el anchor escrito a mano, con el
  // nombre viejo.
  if (anchor && declaredByHand[anchor] === undefined && Number(body?.basisAmount) > 0) {
    declaredByHand[anchor] = Number(body.basisAmount);
  }
  for (const [macro, value] of Object.entries(declaredByHand)) serving[macro] = value;

  const isManual = Object.keys(declaredByHand).length > 0;
  // Si él lo dice, manda. Solo se deduce cuando no hay nada que decir: un
  // grupo cuyos alimentos están vinculados SÍ tiene perfil calculable, y aun
  // así puede no pesarse ("Verduras libres"). Eso no se adivina.
  const freeQuantity =
    typeof body?.freeQuantity === "boolean"
      ? body.freeQuantity
      : !isManual && !hasServing(serving);

  return {
    anchor,
    serving,
    servingSource: isManual ? "manual" : "computed",
    freeQuantity,
    tolerancePct: clampTolerance(body?.tolerancePct),
    role: VALID_ROLES.has(body?.role) ? body.role : null,
    // LEGACY, derivados y nunca al revés: las apps publicadas los leen y
    // así no pueden divergir del perfil.
    basis: anchor,
    basisAmount: anchor && isDeclared(serving[anchor]) ? Number(serving[anchor]) : null,
  };
}

function clampTolerance(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 10;
  return pct;
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

async function buildPayload(body) {
  const items = (body.items || []).map((item) => ({
    productId: readProductId(item.productId),
    name: String(item.name).trim(),
    quantity: Number(item.quantity),
    unit: String(item.unit || "g").trim(),
    note: String(item.note || "").trim(),
  }));

  const productsById = await loadProducts(items);
  return {
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim(),
    equivalenceNote: String(body.equivalenceNote || "").trim(),
    ...buildProfile(body, items, productsById),
    items,
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

/**
 * Lo que el entrenador necesita ver de un grupo y hoy no ve: qué macros tiene
 * de verdad cada alimento, cuánto se desvía del criterio que él declaró, y
 * cuánto se separan entre sí.
 *
 * Se calcula AQUÍ y no en el front porque aquí ya están los productos
 * poblados: mandarlos enteros para que el navegador repita la misma cuenta
 * sería pagar dos veces por lo mismo, y abriría la puerta a que las dos
 * cuentas dejaran de coincidir.
 *
 * Todo es de solo lectura y derivado. Nada de esto se guarda.
 */
function withVerification(group) {
  const tolerance = Number.isFinite(group.tolerancePct) ? group.tolerancePct : 10;

  const items = (group.items || []).map((item) => {
    const macros = itemMacros(item);
    const deviation = itemDeviation(item, group.serving, group.anchor);
    return {
      ...item,
      macros,
      deviation,
      // El veredicto ya masticado: la plantilla no debe decidir a base de
      // comparar números, y así los tres sitios que lo pintan coinciden.
      check: !macros
        ? "unknown"
        : !deviation
        ? "no-anchor"
        : Math.abs(deviation.pct) > tolerance
        ? "off"
        : "ok",
    };
  });

  // La dispersión es la calidad real del grupo: si sus raciones van de 83 a
  // 206 kcal, no son intercambiables en calorías por mucho que igualen la
  // proteína, y el cliente merece que se lo digan.
  const kcals = items.map((item) => item.macros?.kcal).filter(isDeclared);
  const kcalRange =
    kcals.length > 1 ? { min: Math.min(...kcals), max: Math.max(...kcals) } : null;

  return {
    ...group,
    items,
    status: groupStatus(group),
    // Lo que dice el catálogo, aparte de lo que declaró él. Verlos juntos es
    // lo que permite corregir uno de los dos con criterio.
    servingComputed: computeServing(items).serving,
    linkedCount: items.filter((item) => item.productId).length,
    offCount: items.filter((item) => item.check === "off").length,
    kcalRange,
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
    return res.send(groups.map((group) => withVerification(toClientShape(group))));
  },

  // GET /trainer/food-exchanges/reference-profiles
  //
  // Los perfiles de la tabla estándar, para ofrecerlos a quien ya tiene
  // grupos con una sola cifra declarada. El front los escala a SU tamaño de
  // ración antes de enseñarlos y solo rellena los macros en blanco: es una
  // propuesta que él acepta, no un valor que se le escriba encima.
  //
  // Estático y sin consulta: son seis filas de un módulo.
  async listReferenceProfiles(req, res) {
    return res.send(REFERENCE_PROFILES);
  },

  // POST /trainer/food-exchanges/starter-pack
  //
  // Copia la tabla estándar a SU biblioteca: grupos suyos, editables y
  // borrables, no un catálogo compartido que se actualice por detrás. Montar
  // esos seis grupos a mano es el trabajo del primer día y es idéntico para
  // todo el mundo.
  //
  // Los que ya tenga por nombre se saltan, para que pulsarlo dos veces no
  // duplique nada ni reviente contra el índice único.
  async importStarterPack(req, res) {
    const trainerId = req.auth.userId;
    const existing = await FoodExchangeGroup.find({ trainerId }).select("name").lean();
    const taken = new Set(existing.map((group) => group.name.toLowerCase()));

    const pending = STARTER_GROUPS.filter((group) => !taken.has(group.name.toLowerCase()));
    if (!pending.length) {
      return res.send({ created: 0, skipped: STARTER_GROUPS.length });
    }

    const created = await FoodExchangeGroup.insertMany(
      pending.map((group) => ({
        trainerId,
        name: group.name,
        category: group.category,
        equivalenceNote: group.equivalenceNote,
        anchor: group.anchor,
        serving: group.serving,
        // Manual: son perfiles de manual, no calculados de un catálogo. Que
        // vincular productos después no los pise.
        servingSource: "manual",
        role: group.role,
        tolerancePct: 10,
        freeQuantity: false,
        items: group.items,
        basis: group.anchor,
        basisAmount: group.serving[group.anchor],
      })),
      { ordered: false }
    );

    return res.status(201).send({
      created: created.length,
      skipped: STARTER_GROUPS.length - pending.length,
    });
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
        ...(await buildPayload(body)),
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
        { $set: { ...(await buildPayload(body)), updatedAt: new Date() } },
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
      .select("name category equivalenceNote items anchor serving freeQuantity")
      .sort({ category: 1, name: 1 })
      .lean();

    // El reparto se devuelve TAL CUAL, aunque algún grupo ya no exista: la
    // pauta guarda groupName, así que el cliente sigue leyendo "2 raciones
    // de Proteína" y la pantalla dice que ese grupo ya no está disponible.
    // Filtrarlo aquí haría desaparecer parte de su pauta sin explicación.
    return res.send({ meals, groups });
  },
};
