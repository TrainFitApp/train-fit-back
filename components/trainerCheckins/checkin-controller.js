const checkinService = require("./checkin-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[TRAINER_CHECKINS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async getFieldCatalog(req, res) {
    return res.send(checkinService.getFieldCatalog());
  },

  // --- Plantillas maestras ---

  async listDefinitions(req, res) {
    const definitions = await checkinService.listDefinitions(req.user.id);
    return res.send(definitions);
  },

  async createDefinition(req, res) {
    try {
      const definition = await checkinService.createDefinition(req.user.id, req.body || {});
      return res.status(201).send(definition);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateDefinition(req, res) {
    try {
      const definition = await checkinService.updateDefinition(
        req.user.id,
        req.params.id,
        req.body || {}
      );
      return res.send(definition);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteDefinition(req, res) {
    try {
      await checkinService.deleteDefinition(req.user.id, req.params.id);
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async applyDefinition(req, res) {
    try {
      const result = await checkinService.applyDefinition(
        req.user.id,
        req.params.id,
        req.body?.clientIds
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- "Reportes" (todos los clientes) ---

  async getMyCheckinResponses(req, res) {
    const responses = await checkinService.listResponsesForTrainer(req.user.id);
    return res.send(responses);
  },

  async getUnseenCount(req, res) {
    const result = await checkinService.getUnseenCount(req.user.id);
    return res.send(result);
  },

  async markSeen(req, res) {
    const result = await checkinService.markSeen(req.user.id);
    return res.send(result);
  },

  // --- Cliente concreto (lado trainer) ---

  async getClientCheckinConfig(req, res) {
    try {
      const config = await checkinService.getClientCheckinConfig(req.user.id, req.params.clientId);
      return res.send(config);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getClientCheckinResponses(req, res) {
    try {
      const responses = await checkinService.getClientCheckinResponses(
        req.user.id,
        req.params.clientId
      );
      return res.send(responses);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Lado cliente ---

  async listMine(req, res) {
    const configs = await checkinService.listMine(req.user.id);
    return res.send(configs);
  },

  async listMyHistory(req, res) {
    const history = await checkinService.listMyHistory(req.user.id);
    return res.send(history);
  },

  async respond(req, res) {
    try {
      const result = await checkinService.respond(
        req.user.id,
        req.params.trainerId,
        req.body?.values || {}
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
