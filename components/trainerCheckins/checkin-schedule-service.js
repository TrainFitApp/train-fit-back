const scheduleDao = require("./checkin-schedule-dao");
const checkinDao = require("./checkin-dao");
const agenda = require("./checkin-agenda-service");
const notificationService = require("../notifications/notification-service");
const { looseContent, scheduleContent, hasQuestions } = require("./checkin-schedule-content");
const { todayForUser } = require("../users/user-time-zone");
const { badRequest, conflict, notFound } = require("../util/http-error");

// Programaciones de check-in de un cliente (checkin-schedule-schema.js) y la
// revisión de sus respuestas. "Hoy" es el del cliente.

const scheduleNotFound = () => notFound("Check-in no encontrado");
const isId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

async function getOwned(trainerId, clientId, scheduleId) {
  const schedule = await scheduleDao.findOwned(trainerId, clientId, scheduleId);
  if (!schedule) throw scheduleNotFound();
  return schedule;
}

/**
 * Las preguntas que pide el cuerpo: campos sueltos (`enabledFields`) o una
 * plantilla (`sourceTemplateId`). Al editar, volver a mandar la misma
 * plantilla no la copia otra vez: sale null y las preguntas se quedan.
 */
async function requestedContent(trainerId, data, existing) {
  if (Array.isArray(data.enabledFields)) {
    const content = looseContent(data.enabledFields);
    if (!content) throw badRequest("Hay un campo de check-in que no existe");
    return content;
  }
  if (existing && (!data.sourceTemplateId || String(existing.sourceTemplateId) === data.sourceTemplateId)) return null;
  const definition = isId(data.sourceTemplateId) ? await checkinDao.getDefinitionById(trainerId, data.sourceTemplateId) : null;
  if (!definition) throw badRequest("Selecciona una plantilla disponible");
  return scheduleContent(definition);
}

module.exports = {
  list: (trainerId, clientId) => scheduleDao.list(trainerId, clientId),

  // Todas las ocurrencias de UNA programación, de la más nueva a la más vieja.
  async history(trainerId, clientId, scheduleId, { before, limit }) {
    const schedule = await getOwned(trainerId, clientId, scheduleId);
    const history = await agenda.scheduleHistory(schedule, { before, limit, today: await todayForUser(clientId) });
    return { schedule, ...history };
  },

  /**
   * Crea (sin `scheduleId`) o edita una programación. `data`: nombre, timing,
   * preguntas (campos sueltos o plantilla) y, al editar, la `revision` que se
   * leyó. Cambiar las preguntas no toca lo ya respondido: cada respuesta
   * guarda una copia de las suyas.
   */
  async save(trainerId, clientId, scheduleId, data) {
    const existing = scheduleId ? await getOwned(trainerId, clientId, scheduleId) : null;
    const content = await requestedContent(trainerId, data, existing);
    if (content && !hasQuestions(content)) throw badRequest("El check-in necesita al menos una pregunta activa");
    const fields = {
      ...content,
      startDate: data.startDate,
      time: data.time,
      frequency: data.frequency,
      interval: data.interval,
      name: data.name.trim(),
    };
    if (!existing) return { created: true, schedule: await scheduleDao.create(trainerId, clientId, fields) };

    if (data.revision !== undefined && data.revision !== existing.revision) {
      throw conflict("La programación ha cambiado. Recarga antes de guardarla");
    }
    const updated = await scheduleDao.updateAtRevision(trainerId, clientId, existing._id, existing.revision, fields);
    if (!updated) throw conflict("La programación está cambiando. Recarga y vuelve a intentarlo");
    return { created: false, schedule: updated };
  },

  /**
   * "Enviarlo ahora": una programación "once" de hoy con las mismas preguntas
   * (mismos _id en las propias, para que sus respuestas se sigan leyendo
   * igual). Si hoy ya tiene una abierta sin responder, no se duplica.
   */
  async requestNow(trainerId, clientId, scheduleId) {
    const schedule = await getOwned(trainerId, clientId, scheduleId);
    if (!schedule.active) throw conflict("Reanuda la programación antes de enviarla");
    const today = await todayForUser(clientId);
    if (await agenda.openUnanswered(schedule, today)) return { alreadyOpen: true };
    const created = await scheduleDao.create(trainerId, clientId, {
      name: schedule.name,
      sourceTemplateId: schedule.sourceTemplateId,
      enabledFields: schedule.enabledFields,
      requiredFields: schedule.requiredFields,
      customQuestions: schedule.customQuestions,
      startDate: today,
      time: schedule.time,
      frequency: "once",
      interval: 1,
    });
    return { created };
  },

  async setActive(trainerId, clientId, scheduleId, active) {
    if (!(await scheduleDao.setActive(trainerId, clientId, scheduleId, active))) throw scheduleNotFound();
  },

  // Las respuestas ya dadas se quedan: son historial del cliente, no de la
  // programación.
  async remove(trainerId, clientId, scheduleId) {
    if (!(await scheduleDao.remove(trainerId, clientId, scheduleId))) throw scheduleNotFound();
  },

  // Revisa una respuesta y avisa al cliente dentro de la app.
  async review(trainerId, clientId, responseId, comment) {
    const reviewed = await checkinDao.review(trainerId, clientId, responseId, comment);
    if (!reviewed) throw scheduleNotFound();
    await notificationService.create(clientId, trainerId, "checkin_reviewed", {
      name: reviewed.name,
      occurrenceDate: reviewed.occurrenceDate,
      hasComment: !!reviewed.reviewComment,
    });
    return reviewed;
  },
};
