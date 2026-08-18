const DietTemplate = require("./diet-template-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

// El controller (sanitizeAlternatives) ya valida label/estructura pero deja
// customProducts/customRecipes tal cual llegan del body (mismo formato
// "clipboard" crudo de siempre — {product, quantity}/{recipe, quantity}, sin
// _id real). Aquí es donde se materializan como documentos reales, mismo
// criterio que mealDao.pasteMeal usa para clonar en cualquier paste real —
// no reutiliza esa función porque pasteMeal exige un Meal destino ya
// existente (mealToPaste._id) y aquí no hay Meal de por medio, solo la
// plantilla.
async function materializeAlternative(alt) {
  const rawProducts = Array.isArray(alt?.customProducts) ? alt.customProducts : [];
  const rawRecipes = Array.isArray(alt?.customRecipes) ? alt.customRecipes : [];

  const productsToCreate = rawProducts.map((cp) => {
    const { _id, ...rest } = cp && typeof cp === "object" ? cp : {};
    return rest;
  });
  const newProducts = productsToCreate.length
    ? await customProductSchema.insertMany(productsToCreate)
    : [];

  const newRecipes = [];
  for (const cr of rawRecipes) {
    if (!cr?.recipe) continue;
    newRecipes.push(await customRecipeDao.createCustomRecipe(cr));
  }

  return {
    label: alt?.label || "",
    customProducts: newProducts.map((p) => p._id),
    customRecipes: newRecipes.map((r) => r._id),
  };
}

async function materializeMeals(meals) {
  const result = [];
  for (const meal of meals || []) {
    const alternatives = [];
    for (const alt of meal.alternatives || []) {
      alternatives.push(await materializeAlternative(alt));
    }
    result.push({ slot: meal.slot, alternatives });
  }
  return result;
}

async function materializeDays(days) {
  const result = [];
  for (const day of days || []) {
    result.push({ dayLabel: day.dayLabel, meals: await materializeMeals(day.meals) });
  }
  return result;
}

async function materializeDayPatterns(dayPatterns) {
  const result = [];
  for (const pattern of dayPatterns || []) {
    result.push({
      name: pattern.name,
      appliesTo: pattern.appliesTo,
      meals: await materializeMeals(pattern.meals),
    });
  }
  return result;
}

async function deleteContentIds({ productIds, recipeIds }) {
  if (productIds.length) await customProductSchema.deleteMany({ _id: { $in: productIds } });
  if (recipeIds.length) await customRecipeSchema.deleteMany({ _id: { $in: recipeIds } });
}

module.exports = {
  // Exportadas para reuso en scripts/migrate-diet-template-refs.js (mismo
  // criterio que materializeBlocksAsExercises en workoutTemplates).
  materializeDays,
  materializeDayPatterns,

  async create(trainerId, name, days, mode, dayPatterns) {
    const created = await DietTemplate.create({
      trainerId,
      name,
      days: await materializeDays(days),
      mode: mode || "sequential",
      dayPatterns: await materializeDayPatterns(dayPatterns),
    });
    // create() no pasa por el middleware de autopopulate (solo corre en
    // find/findOne) — se relee para devolver customProducts/customRecipes ya
    // poblados, mismo shape que listByTrainer/update.
    return DietTemplate.findOne({ _id: created._id, trainerId });
  },

  async listByTrainer(trainerId) {
    return DietTemplate.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  // TASK-045 (MASTER_BACKLOG.md) — lookup en lote para adjuntar planName al
  // listar el historial de PlanAssignment de un cliente (varias fases,
  // posiblemente de plantillas ya editadas/borradas después).
  async findManyByIds(trainerId, ids) {
    return DietTemplate.find({ _id: { $in: ids }, trainerId }).select("name");
  },

  async update(trainerId, id, { name, days, mode, dayPatterns }) {
    const existing = await DietTemplate.findOne({ _id: id, trainerId });
    if (!existing) return null;

    const setOps = {};
    if (name !== undefined) setOps.name = name;
    if (mode !== undefined) setOps.mode = mode;

    const replacingDays = days !== undefined;
    const replacingPatterns = dayPatterns !== undefined;
    if (replacingDays || replacingPatterns) {
      // Fuera el CustomProduct/CustomRecipe viejo del contenido que se
      // reemplaza, dentro el nuevo materializado — mismo criterio que
      // workoutTemplates/workout-template-dao.js#update. Solo se limpia lo
      // que de verdad se reemplaza (days o dayPatterns, no ambos si el body
      // solo tocó uno).
      const ids = DietTemplate.collectContentIds({
        days: replacingDays ? existing.days : [],
        dayPatterns: replacingPatterns ? existing.dayPatterns : [],
      });
      await deleteContentIds(ids);
    }
    if (replacingDays) setOps.days = await materializeDays(days);
    if (replacingPatterns) setOps.dayPatterns = await materializeDayPatterns(dayPatterns);

    await DietTemplate.updateOne({ _id: id }, { $set: setOps });
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  // deleteOne (no deleteMany) dispara el hook en cascada de
  // diet-template-schema.js que borra los CustomProduct/CustomRecipe de la
  // plantilla.
  async delete(trainerId, id) {
    return DietTemplate.deleteOne({ _id: id, trainerId });
  },
};
