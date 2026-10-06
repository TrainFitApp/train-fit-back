const routineAssignmentService = require("./routine-assignment-service");

// Fases de rutina de un cliente (routine-assignment-service.js).
module.exports = {
  // POST /trainer/clients/:clientId/tables/:tableId/apply  { startDate, reason? }
  // Crea UNA fase de rutina; desde su fecha sustituye a la anterior.
  async applyRoutine(req, res) {
    const { clientId, tableId } = req.params;
    const { startDate, reason } = req.body || {};
    res.status(201).send(
      await routineAssignmentService.applyRoutine({ trainerId: req.auth.userId, clientId, tableId, startDate, reason }),
    );
  },

  // GET /trainer/clients/:clientId/routine-assignments/history
  async getHistory(req, res) {
    res.send(await routineAssignmentService.history(req.params.clientId));
  },

  // GET /trainer/clients/:clientId/routine-assignments/schedule?from=&to=
  async getSchedule(req, res) {
    res.send(await routineAssignmentService.schedule(req.params.clientId, req.query.from, req.query.to));
  },

  // DELETE /trainer/clients/:clientId/routine-assignments/:assignmentId
  // Quitar CUALQUIER fase (futura, pasada o la vigente).
  async cancelPhase(req, res) {
    const { clientId, assignmentId } = req.params;
    await routineAssignmentService.cancelPhase({ trainerId: req.auth.userId, clientId, assignmentId, reason: req.body?.reason });
    res.status(204).send();
  },

  // PATCH /trainer/clients/:clientId/routine-assignments/:assignmentId  { startDate, reason? }
  // Cambiar la fecha de una fase PROGRAMADA (aún no en curso).
  async reschedulePhase(req, res) {
    const { clientId, assignmentId } = req.params;
    const { startDate, reason } = req.body || {};
    res.send(
      await routineAssignmentService.rescheduleScheduledPhase({ trainerId: req.auth.userId, clientId, assignmentId, startDate, reason }),
    );
  },
};
