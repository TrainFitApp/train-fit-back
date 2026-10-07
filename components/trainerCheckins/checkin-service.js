const checkinDao = require("./checkin-dao");
const scheduleDao = require("./checkin-schedule-dao");
const agenda = require("./checkin-agenda-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const userDao = require("../users/user-dao");
const { weekForClientAt } = require("../dietPhases/week-service");
const { scheduleContent, hasQuestions } = require("./checkin-schedule-content");
const { badRequest, conflict, forbidden, notFound } = require("../util/http-error");

// Plantillas de check-in del profesional, su aplicación a clientes y las
// respuestas (las de la ficha de un cliente: checkin-schedule-service.js).

const templateNotFound = () => notFound("Plantilla no encontrada");
const duplicateName = () => conflict("Ya tienes una plantilla con ese nombre");

// 11000 = otra plantilla suya con el mismo nombre.
async function withUniqueName(write) {
  try {
    return await write();
  } catch (error) {
    if (error.code === 11000) throw duplicateName();
    throw error;
  }
}

async function trainersById(trainerIds) {
  const trainers = await userDao.listFields(trainerIds, "name lastname");
  return new Map(trainers.map((trainer) => [String(trainer._id), trainer]));
}

module.exports = {
  // --- Biblioteca de plantillas ---
  listDefinitions: (trainerId) => checkinDao.listDefinitions(trainerId),

  async createDefinition(trainerId, { name, enabledFields, customQuestions, requiredFields }) {
    return withUniqueName(() => checkinDao.createDefinition(trainerId, name, enabledFields, customQuestions, requiredFields));
  },

  async updateDefinition(trainerId, id, updates) {
    const definition = await withUniqueName(() => checkinDao.updateDefinition(trainerId, id, updates));
    if (!definition) throw templateNotFound();
    return definition;
  },

  async deleteDefinition(trainerId, id) {
    if (!(await checkinDao.deleteDefinition(trainerId, id))) throw templateNotFound();
  },

  /**
   * Aplicar una plantilla es PROGRAMAR check-ins: crea (o reemplaza) la
   * programación de esa plantilla en cada cliente con relación activa y
   * escribible. Devuelve { applied, skipped }.
   */
  async applyDefinition(trainerId, id, clientIds, timing) {
    const definition = await checkinDao.getDefinitionById(trainerId, id);
    if (!definition) throw templateNotFound();
    const content = scheduleContent(definition);
    if (!hasQuestions(content)) throw badRequest("El check-in necesita al menos una pregunta activa");

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      if (await trainerClientService.clientWriteBlock(trainerId, clientId)) {
        skipped.push(clientId);
        continue;
      }
      await scheduleDao.upsertFromTemplate(trainerId, clientId, definition._id, { ...content, ...timing, active: true });
      applied.push(clientId);
    }
    return { applied, skipped };
  },

  listResponses: (trainerId, clientId) => checkinDao.listResponses(trainerId, clientId),

  // --- Lado cliente ---
  /**
   * Los check-ins ABIERTOS hoy de cada profesional con relación activa, con
   * su semana de dieta y `prefill` (medidas ya apuntadas en el periodo del
   * check-in, para que el formulario salga relleno).
   */
  async openForClient(clientId, today) {
    const trainerIds = [...(await trainerClientDao.findActiveTrainerIds(clientId))];
    if (!trainerIds.length) return [];
    const open = await agenda.openForClient(clientId, today, trainerIds);
    const week = await weekForClientAt(clientId, today);
    const byId = await trainersById(trainerIds);
    return Promise.all(
      open.map(async ({ schedule, occurrence, entry }) => ({
        ...entry,
        trainerId: String(schedule.trainerId),
        trainer: byId.get(String(schedule.trainerId)) || null,
        week,
        prefill: await agenda.prefillFor(clientId, schedule, occurrence, today),
      }))
    );
  },

  // Su histórico (solo lectura: un check-in cerrado ya no se toca).
  async historyForClient(clientId) {
    const trainerIds = [...(await trainerClientDao.findActiveTrainerIds(clientId))];
    const byId = await trainersById(trainerIds);
    const responses = await checkinDao.listResponsesForClient(clientId);
    return responses.map((response) => ({ ...response, trainer: byId.get(String(response.trainerId)) || null }));
  },

  /**
   * El cliente responde (o reescribe) el check-in ABIERTO de esa
   * programación. Fuera de su ventana no se puede ni escribir ni corregir.
   * Devuelve la respuesta guardada (`updated` si ya existía).
   */
  async respond(clientId, scheduleId, rawValues, today) {
    const schedule = await scheduleDao.findForClient(scheduleId, clientId);
    if (!schedule) throw notFound("Check-in no encontrado");
    if (!(await trainerClientService.hasActiveClient(schedule.trainerId, clientId))) {
      throw forbidden("No tienes una relación activa con este profesional");
    }
    const open = await agenda.openForClient(clientId, today, [String(schedule.trainerId)]);
    const current = open.find((o) => String(o.schedule._id) === String(schedule._id));
    if (!current) throw conflict("Este check-in ya está cerrado. Responde el siguiente cuando llegue su fecha", "CHECKIN_CLOSED");

    const result = agenda.validateAnswers(schedule, rawValues);
    if (result.error) throw badRequest(result.error, "CHECKIN_INVALID_ANSWER");
    const photos = await agenda.validatePhotoAnswers(clientId, result.values);
    if (photos.error) throw badRequest(photos.error, "CHECKIN_INVALID_ANSWER");

    return agenda.saveResponse({ schedule, occurrence: current.occurrence, values: result.values, today });
  },
};
