const dietTemplateService = require("./diet-template-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[DIET_TEMPLATES] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async list(req, res) {
    const templates = await dietTemplateService.listMyTemplates(req.user.id, req.query.search);
    return res.send(templates);
  },

  async create(req, res) {
    try {
      const template = await dietTemplateService.createTemplate(req.user.id, req.body || {});
      return res.status(201).send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getById(req, res) {
    try {
      const template = await dietTemplateService.getMyTemplate(req.user.id, req.params.id);
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateMetadata(req, res) {
    try {
      const template = await dietTemplateService.updateMetadata(
        req.user.id,
        req.params.id,
        req.body || {}
      );
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async remove(req, res) {
    try {
      await dietTemplateService.deleteTemplate(req.user.id, req.params.id);
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addDay(req, res) {
    try {
      const template = await dietTemplateService.addDay(
        req.user.id,
        req.params.id,
        req.body?.dayLabel
      );
      return res.status(201).send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async renameDay(req, res) {
    try {
      const template = await dietTemplateService.renameDay(
        req.user.id,
        req.params.id,
        Number(req.params.dayIndex),
        req.body?.dayLabel
      );
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteDay(req, res) {
    try {
      const template = await dietTemplateService.deleteDay(
        req.user.id,
        req.params.id,
        Number(req.params.dayIndex)
      );
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async reorderDays(req, res) {
    try {
      const template = await dietTemplateService.reorderDays(
        req.user.id,
        req.params.id,
        req.body?.order || []
      );
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addMeal(req, res) {
    try {
      const meal = await dietTemplateService.addMealToDay(
        req.user.id,
        req.params.id,
        Number(req.params.dayIndex),
        req.body?.name
      );
      return res.status(201).send(meal);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async removeMeal(req, res) {
    try {
      await dietTemplateService.removeMealFromDay(
        req.user.id,
        req.params.id,
        Number(req.params.dayIndex),
        req.params.mealId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addCustomProduct(req, res) {
    try {
      const customProduct = await dietTemplateService.addCustomProductToMeal(
        req.user.id,
        req.params.id,
        req.params.mealId,
        req.body?.customProduct
      );
      return res.status(201).send(customProduct);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async removeCustomProduct(req, res) {
    try {
      await dietTemplateService.removeCustomProductFromMeal(
        req.user.id,
        req.params.id,
        req.params.mealId,
        req.params.customProductId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
