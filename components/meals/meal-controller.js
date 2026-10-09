const mealService = require("./meal-service");
const { resolveOwnedMealById } = require("../dietDays/diet-day-resolver");
const { canActOnSubject } = require("../trainerClients/subject-access");

// Toda ruta de /meals/:id opera sobre una comida de un día del usuario del
// token: resolveOwnedMealById lo comprueba (400 MEAL_NOT_FOUND si no es suya)
// y devuelve la comida de BD, nunca la que mande el cliente. Una comida o un
// alimento pautados por el profesional no se pueden recomponer
// (assertMealEditable: 403 MEAL_PROTECTED); marcar consumido o ajustar la
// cantidad consumida sí (seguimiento no es composición).

function itemNotFound(res, kind) {
  const message = kind === "customRecipes" ? "Receta no encontrada en esta comida" : "Producto no encontrado en esta comida";
  return res.status(400).send({ message });
}

const findItem = (meal, kind, itemId) => (meal[kind] || []).find((item) => String(item._id) === String(itemId));

function parseQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

// Marcar consumido / ajustar cantidad de un alimento o receta de la comida.
function trackItem(kind, apply) {
  return async (req, res) => {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    const item = findItem(meal, kind, req.params.itemId);
    if (!item) return itemNotFound(res, kind);
    return apply(req, res, item);
  };
}

module.exports = {
  async getMeal(req, res) {
    return res.send(await resolveOwnedMealById(req.auth.userId, req.params.id));
  },

  // POST /meals/search — productos y recetas para añadir a una comida.
  async search(req, res) {
    const toBoolean = (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return !!value;
    };

    // Ids de 24 hex y como mucho 50: son los recientes que el frontend ya
    // tiene cargados para esa comida y sirven solo para subirlos en el
    // ranking (ver meal-dao.js#searchAllWithFilters).
    const recentIds = (Array.isArray(req.body.recentIds) ? req.body.recentIds : [])
      .map((value) => String(value || ""))
      .filter((value) => /^[0-9a-fA-F]{24}$/.test(value))
      .slice(0, 50);

    const page = parseInt((req.body.page || 0).toString(), 10);
    const limit = 7;
    // `body.userId` es de quién son los productos propios, favoritos y
    // recientes que entran en la búsqueda: el propio usuario, o el cliente
    // al que su profesional de nutrición le está pautando. Cualquier otro id
    // se sustituye por el del token.
    const subjectId = req.body.userId && !(await canActOnSubject(req, req.body.userId, { trainerScope: "nutrition" }))
      ? req.user.id
      : req.body.userId;
    const list = await mealService.searchAllWithFilters(
      page,
      limit,
      req.body.search,
      toBoolean(req.body.ownFilter),
      toBoolean(req.body.recipeFilter),
      toBoolean(req.body.shieldFilter),
      toBoolean(req.body.favFilter),
      subjectId,
      recentIds,
      // Quién pregunta, además de a quién pertenece la dieta: cuando un
      // entrenador pauta una comida, `body.userId` es el del CLIENTE, y sin
      // esto los productos que el propio entrenador había creado no salían.
      req?.user?.id,
    );
    return res.send(list);
  },

  // PUT /meals/:id { name?, notes? } — solo nombre y nota. El nombre de una
  // comida pautada no se cambia; la nota sí.
  async updateMeal(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);
    const patch = {};
    if (has("name") && req.body.name !== meal.name) {
      await mealService.assertMealEditable(req.auth.userId, meal);
      patch.name = req.body.name;
    }
    if (has("notes")) patch.notes = req.body.notes;
    return res.send(await mealService.modifyMeal(meal._id, patch));
  },

  // PUT /meals/:id/paste { mealClipboard, merge } — pega en esta comida. Lo
  // pegado es siempre del cliente, aunque se copiara de algo pautado, y lo
  // pautado de esta comida sigue aunque se reemplace (meal-dao.js#keptOnPaste).
  // Solo una comida pautada entera no admite pegar.
  async pasteMeal(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    await mealService.assertMealEditable(req.auth.userId, meal);
    return res.send(await mealService.pasteMeal(req.body?.mealClipboard, meal, Boolean(req.body?.merge)));
  },

  // PUT /meals/:id/alternative { chosenIndex } — elige (o cambia) una de las
  // opciones que pautó el profesional para esta comida.
  async chooseAlternative(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    const chosenIndex = Number(req.body?.chosenIndex);
    if (!Number.isInteger(chosenIndex) || !(meal.alternatives || [])[chosenIndex]) {
      return res.status(400).send({ message: "chosenIndex no corresponde a ninguna alternativa" });
    }
    return res.send(await mealService.chooseAlternative(meal._id, chosenIndex));
  },

  // POST /meals/:id/customproducts { customProduct } — el Product inline, si
  // llega, se guarda a nombre del usuario del token.
  async addCustomProduct(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    return res.send(await mealService.addCustomProduct(meal._id, req.body?.customProduct, req.auth.userId));
  },

  // PUT /meals/:id/customproducts/:itemId — editar un alimento propio. Ni la
  // marca de pautado ni la cantidad pautada se reescriben por aquí.
  async updateCustomProduct(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    const item = findItem(meal, "customProducts", req.params.itemId);
    if (!item) return itemNotFound(res, "customProducts");
    await mealService.assertMealEditable(req.auth.userId, item);
    const { _id, assignedByTrainerId, assignedQuantity, ...changes } = req.body || {};
    return res.send(await mealService.updateCustomProduct(item._id, changes));
  },

  async deleteCustomProduct(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    await mealService.assertMealEditable(req.auth.userId, meal);
    // Nivel de item, además del de comida: una comida "mixta" puede tener
    // ESTE producto concreto pautado.
    const item = findItem(meal, "customProducts", req.params.itemId);
    if (!item) return itemNotFound(res, "customProducts");
    await mealService.assertMealEditable(req.auth.userId, item);
    return res.send(await mealService.deleteMealProduct(meal._id, item._id));
  },

  async deleteCustomRecipe(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    await mealService.assertMealEditable(req.auth.userId, meal);
    const item = findItem(meal, "customRecipes", req.params.itemId);
    if (!item) return itemNotFound(res, "customRecipes");
    await mealService.assertMealEditable(req.auth.userId, item);
    return res.send(await mealService.deleteMealCustomRecipe(meal._id, item._id));
  },

  async deleteAllCustomProducts(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    await mealService.assertMealEditable(req.auth.userId, meal);
    return res.send(await mealService.deleteMealCustomProducts(meal._id));
  },

  async deleteAllCustomRecipes(req, res) {
    const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
    await mealService.assertMealEditable(req.auth.userId, meal);
    return res.send(await mealService.deleteMealCustomRecipes(meal._id));
  },

  setCustomProductConsumed: trackItem("customProducts", async (req, res, item) =>
    res.send(await mealService.setCustomProductConsumed(item._id, req.body?.consumed !== false)),
  ),

  setCustomRecipeConsumed: trackItem("customRecipes", async (req, res, item) =>
    res.send(await mealService.setCustomRecipeConsumed(item._id, req.body?.consumed !== false)),
  ),

  // Cuánto de un alimento o receta tomó realmente el cliente, sin poder
  // tocar qué es.
  setCustomProductQuantity: trackItem("customProducts", async (req, res, item) => {
    const quantity = parseQuantity(req.body?.quantity);
    if (quantity === null) return res.status(400).send({ message: "Cantidad inválida" });
    return res.send(await mealService.setCustomProductQuantity(item._id, quantity));
  }),

  setCustomRecipeQuantity: trackItem("customRecipes", async (req, res, item) => {
    const quantity = parseQuantity(req.body?.quantity);
    if (quantity === null) return res.status(400).send({ message: "Cantidad inválida" });
    return res.send(await mealService.setCustomRecipeQuantity(item._id, quantity));
  }),
};
