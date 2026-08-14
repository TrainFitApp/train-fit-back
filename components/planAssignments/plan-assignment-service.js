const planAssignmentDao = require("./plan-assignment-dao");
const { computeEndDate } = require("../util/period-util");

module.exports = {
  computeEndDate,

  // Crea la asignación y, si el cliente ya tenía una activa, la encadena
  // (supersededBy) — así "aplicar un plan nuevo" y "programar la siguiente
  // fase" son la MISMA operación, sin perder el historial de la anterior.
  async applyPlan({ trainerId, clientId, planId, startDate, endMode, fixedEndDate, durationValue, durationUnit }) {
    const endDate = computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit });

    const created = await planAssignmentDao.create({
      planId,
      clientId,
      trainerId,
      startDate,
      endMode,
      endDate,
    });

    const previousActive = await planAssignmentDao.findActiveForClient(clientId);
    if (previousActive && String(previousActive._id) !== String(created._id)) {
      await planAssignmentDao.markSuperseded(previousActive._id, created._id);
    }

    return created;
  },

  async getActiveForClient(clientId) {
    return planAssignmentDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return planAssignmentDao.listByClient(clientId);
  },

  async findCoveringDate(clientId, date) {
    return planAssignmentDao.findCoveringDate(clientId, date);
  },
};
