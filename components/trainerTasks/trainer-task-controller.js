const trainerTaskService = require("./trainer-task-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[TRAINER_TASKS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async createForClient(req, res) {
    try {
      const task = await trainerTaskService.createForClient(
        req.user.id,
        req.params.clientId,
        req.body || {}
      );
      return res.status(201).send(task);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async listForClient(req, res) {
    try {
      const tasks = await trainerTaskService.listForClient(req.user.id, req.params.clientId);
      return res.send(tasks);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async update(req, res) {
    try {
      const task = await trainerTaskService.update(req.user.id, req.params.id, req.body || {});
      return res.send(task);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async setActive(req, res) {
    try {
      const task = await trainerTaskService.setActive(
        req.user.id,
        req.params.id,
        Boolean(req.body?.active)
      );
      return res.send(task);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Lado cliente ---

  async listMine(req, res) {
    const tasks = await trainerTaskService.listMine(req.user.id);
    return res.send(tasks);
  },

  async listCompletions(req, res) {
    const taskIds = (req.query.taskIds || "").split(",").filter(Boolean);
    const completions = await trainerTaskService.listCompletions(req.user.id, taskIds, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    return res.send(completions);
  },

  async setCompletion(req, res) {
    try {
      const completion = await trainerTaskService.setCompletion(
        req.user.id,
        req.params.id,
        req.body?.date,
        Boolean(req.body?.completed)
      );
      return res.send(completion);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
