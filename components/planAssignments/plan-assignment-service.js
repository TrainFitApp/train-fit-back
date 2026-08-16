const planAssignmentDao = require("./plan-assignment-dao");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function validatePeriod(period) {
  if (!period || !period.startDate || !period.endMode) {
    throw makeError(400, "INVALID_PERIOD", "Vigencia inválida");
  }
  if (!["fixedDate", "duration", "indefinite"].includes(period.endMode)) {
    throw makeError(400, "INVALID_PERIOD", "Vigencia inválida");
  }
  if (period.endMode === "fixedDate" && !period.endDate) {
    throw makeError(400, "INVALID_PERIOD", "Falta la fecha de fin");
  }
  if (period.endMode === "duration" && !period.durationDays) {
    throw makeError(400, "INVALID_PERIOD", "Falta la duración en días");
  }
}

module.exports = {
  // De un cliente a la vez, sin bulk-apply (funcionalidad 6). Un plan nuevo
  // reemplaza al anterior sin perder histórico — mismo criterio que
  // TrainerClient con invitaciones (funcionalidad 2).
  async applyToClient(trainerId, clientId, { templateId, period }) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");

    const template = await dietTemplateDao.findById(templateId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }
    if (!template.days || template.days.length === 0) {
      throw makeError(409, "TEMPLATE_EMPTY", "La plantilla no tiene ningún día");
    }

    validatePeriod(period);

    const current = await planAssignmentDao.findActiveByClient(clientId);

    const created = await planAssignmentDao.create({
      planId: templateId,
      clientId,
      trainerId,
      period,
      status: "active",
    });

    if (current) {
      await planAssignmentDao.markSuperseded(current._id, created._id);
    }

    notificationService.notifyClient(clientId, trainerId, "diet_assigned", "PlanAssignment", created._id);

    return created;
  },

  async getCurrentForClient(trainerId, clientId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");
    return planAssignmentDao.findActiveByTrainerAndClient(trainerId, clientId);
  },
};
