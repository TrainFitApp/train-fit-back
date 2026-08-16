const planAssignmentService = require("./plan-assignment-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[PLAN_ASSIGNMENTS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async applyToClient(req, res) {
    try {
      const assignment = await planAssignmentService.applyToClient(
        req.user.id,
        req.params.clientId,
        req.body || {}
      );
      return res.status(201).send(assignment);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getCurrent(req, res) {
    try {
      const assignment = await planAssignmentService.getCurrentForClient(
        req.user.id,
        req.params.clientId
      );
      return res.send(assignment);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
