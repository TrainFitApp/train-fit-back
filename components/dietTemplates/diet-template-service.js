const dietTemplateDao = require("./diet-template-dao");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function requireOwnedTemplate(trainerId, templateId) {
  const template = await dietTemplateDao.findById(templateId);
  if (!template || String(template.trainerId) !== String(trainerId)) {
    throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
  }
  return template;
}

async function requireOwnedMeal(trainerId, templateId, mealId) {
  await requireOwnedTemplate(trainerId, templateId);
  const owned = await dietTemplateDao.isMealOwnedByTemplate(templateId, mealId);
  if (!owned) {
    throw makeError(404, "MEAL_NOT_FOUND", "Comida no encontrada en esta plantilla");
  }
}

module.exports = {
  cloneMealDeep: dietTemplateDao.cloneMealDeep,

  async listMyTemplates(trainerId, search) {
    return dietTemplateDao.findTemplatesByTrainer(trainerId, search);
  },

  async createTemplate(trainerId, { name, description }) {
    if (!name || !name.trim()) {
      throw makeError(400, "NAME_REQUIRED", "El nombre es obligatorio");
    }
    return dietTemplateDao.createTemplate({ trainerId, name: name.trim(), description });
  },

  async getMyTemplate(trainerId, templateId) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.findByIdPopulated(templateId);
  },

  async updateMetadata(trainerId, templateId, data) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.updateMetadata(templateId, data);
  },

  async deleteTemplate(trainerId, templateId) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.deleteTemplate(templateId);
  },

  async addDay(trainerId, templateId, dayLabel) {
    await requireOwnedTemplate(trainerId, templateId);
    if (!dayLabel || !dayLabel.trim()) {
      throw makeError(400, "DAY_LABEL_REQUIRED", "El nombre del día es obligatorio");
    }
    return dietTemplateDao.addDay(templateId, dayLabel.trim());
  },

  async renameDay(trainerId, templateId, dayIndex, dayLabel) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.renameDay(templateId, dayIndex, dayLabel);
  },

  async deleteDay(trainerId, templateId, dayIndex) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.deleteDay(templateId, dayIndex);
  },

  async reorderDays(trainerId, templateId, order) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.reorderDays(templateId, order);
  },

  async addMealToDay(trainerId, templateId, dayIndex, name) {
    await requireOwnedTemplate(trainerId, templateId);
    if (!name || !name.trim()) {
      throw makeError(400, "NAME_REQUIRED", "El nombre es obligatorio");
    }
    return dietTemplateDao.addMealToDay(templateId, dayIndex, name.trim());
  },

  async removeMealFromDay(trainerId, templateId, dayIndex, mealId) {
    await requireOwnedTemplate(trainerId, templateId);
    return dietTemplateDao.removeMealFromDay(templateId, dayIndex, mealId);
  },

  async addCustomProductToMeal(trainerId, templateId, mealId, customProductPayload) {
    await requireOwnedMeal(trainerId, templateId, mealId);
    return dietTemplateDao.addCustomProductToMeal(mealId, customProductPayload, trainerId);
  },

  async removeCustomProductFromMeal(trainerId, templateId, mealId, customProductId) {
    await requireOwnedMeal(trainerId, templateId, mealId);
    return dietTemplateDao.removeCustomProductFromMeal(mealId, customProductId);
  },
};
