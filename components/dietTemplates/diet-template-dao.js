const mongoose = require("mongoose");
const dietTemplateSchema = require("./diet-template-schema");
const mealSchema = require("../meals/meal-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customProductDao = require("../customProducts/custom-product-dao");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// Clona un Meal con sus CustomProducts, ids nuevos en cada nivel — mismo
// patrón que cloneWorkoutDeep() en workoutTemplates (funcionalidad 5).
// Alcance MVP: solo customProducts (alimentos sueltos), sin customRecipes —
// clonar una CustomRecipe implica clonar también sus propios
// addedCustomProducts/modifiedBaseCustomProducts (otro nivel de
// profundidad) vía recipeMergeService, que no se reutiliza aquí para no
// sumar superficie a esta primera versión. Si se necesita más adelante, se
// retoma como extensión.
async function cloneMealDeep(mealId) {
  const mealDoc = await mealSchema.findById(mealId).lean();
  if (!mealDoc) {
    throw makeError(404, "MEAL_NOT_FOUND", "Comida no encontrada");
  }

  const productIds = mealDoc.customProducts || [];
  let newProductIds = [];
  if (productIds.length) {
    const products = await customProductSchema
      .find({ _id: { $in: productIds } })
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const clones = [];
    productIds.forEach((id) => {
      const src = byId.get(String(id));
      if (!src) return;
      const clone = { ...src, _id: new mongoose.Types.ObjectId() };
      delete clone.mealId;
      delete clone.customRecipeId;
      clones.push(clone);
    });
    if (clones.length) await customProductSchema.insertMany(clones);
    newProductIds = clones.map((c) => c._id);
  }

  const newMeal = await mealSchema.create({
    name: mealDoc.name,
    notes: mealDoc.notes,
    customProducts: newProductIds,
    customRecipes: [],
  });
  return newMeal._id;
}

module.exports = {
  cloneMealDeep,

  async createTemplate({ trainerId, name, description }) {
    return dietTemplateSchema.create({
      trainerId,
      name,
      description: description || "",
      days: [],
    });
  },

  async findById(id) {
    return dietTemplateSchema.findById(id);
  },

  async findByIdPopulated(id) {
    return dietTemplateSchema
      .findById(id)
      .populate({
        path: "days.meals",
        populate: { path: "customProducts", populate: { path: "product" } },
      })
      .lean();
  },

  async findTemplatesByTrainer(trainerId, search) {
    const query = { trainerId };
    if (search) query.name = { $regex: search, $options: "i" };
    return dietTemplateSchema.find(query).sort({ _id: -1 }).lean();
  },

  async updateMetadata(id, { name, description }) {
    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    return dietTemplateSchema.findByIdAndUpdate(id, { $set: update }, { new: true });
  },

  // Cascada real: borra los Meal de todos los días (que a su vez cascadean
  // sus CustomProducts/CustomRecipes vía el hook ya existente en
  // meal-schema.js) antes de borrar la plantilla.
  async deleteTemplate(id) {
    const template = await dietTemplateSchema.findById(id).lean();
    if (template) {
      const mealIds = (template.days || []).flatMap((d) => d.meals || []);
      if (mealIds.length) await mealSchema.deleteMany({ _id: { $in: mealIds } });
    }
    return dietTemplateSchema.deleteOne({ _id: id });
  },

  async addDay(templateId, dayLabel) {
    return dietTemplateSchema.findByIdAndUpdate(
      templateId,
      { $push: { days: { dayLabel, meals: [] } } },
      { new: true }
    );
  },

  async renameDay(templateId, dayIndex, dayLabel) {
    return dietTemplateSchema.findByIdAndUpdate(
      templateId,
      { $set: { [`days.${dayIndex}.dayLabel`]: dayLabel } },
      { new: true }
    );
  },

  async deleteDay(templateId, dayIndex) {
    const template = await dietTemplateSchema.findById(templateId);
    if (!template || !template.days[dayIndex]) {
      throw makeError(404, "DAY_NOT_FOUND", "Día no encontrado");
    }
    const mealIds = template.days[dayIndex].meals || [];
    if (mealIds.length) await mealSchema.deleteMany({ _id: { $in: mealIds } });
    template.days.splice(dayIndex, 1);
    await template.save();
    return template;
  },

  async reorderDays(templateId, order) {
    const template = await dietTemplateSchema.findById(templateId);
    if (!template) throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    if (order.length !== template.days.length) {
      throw makeError(400, "INVALID_ORDER", "El orden no coincide con los días existentes");
    }
    template.days = order.map((i) => template.days[i]);
    await template.save();
    return template;
  },

  async addMealToDay(templateId, dayIndex, name) {
    const template = await dietTemplateSchema.findById(templateId);
    if (!template || !template.days[dayIndex]) {
      throw makeError(404, "DAY_NOT_FOUND", "Día no encontrado");
    }
    const meal = await mealSchema.create({ name, customProducts: [], customRecipes: [] });
    template.days[dayIndex].meals.push(meal._id);
    await template.save();
    return meal;
  },

  async removeMealFromDay(templateId, dayIndex, mealId) {
    const template = await dietTemplateSchema.findById(templateId);
    if (!template || !template.days[dayIndex]) {
      throw makeError(404, "DAY_NOT_FOUND", "Día no encontrado");
    }
    template.days[dayIndex].meals = template.days[dayIndex].meals.filter(
      (id) => String(id) !== String(mealId)
    );
    await template.save();
    return mealSchema.deleteOne({ _id: mealId });
  },

  // Comprueba que un Meal pertenece a ALGÚN día de esta plantilla — misma
  // disciplina que M3 (funcionalidad 5): nunca confiar en ids sueltos sin
  // verificar contención real.
  async isMealOwnedByTemplate(templateId, mealId) {
    const template = await dietTemplateSchema.findById(templateId).lean();
    if (!template) return false;
    return (template.days || []).some((d) =>
      (d.meals || []).some((m) => String(m) === String(mealId))
    );
  },

  async addCustomProductToMeal(mealId, customProductPayload, trainerId) {
    return customProductDao.createCustomProductAndAddToMeal(
      mealId,
      customProductPayload,
      trainerId
    );
  },

  async removeCustomProductFromMeal(mealId, customProductId) {
    await mealSchema.findByIdAndUpdate(mealId, {
      $pull: { customProducts: customProductId },
    });
    return customProductDao.delete(customProductId);
  },
};
