const checkinService = require("./checkin-service");
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");
const { validateQuestionList, normalizeQuestionDefinition } = require("../forms/custom-question");
const { validateTiming } = require("./checkin-schedule-dates");
const { defaultTiming } = require("./checkin-schedule-content");
const { todayIsoDate } = require("../util/date-util");

// Comprueba la forma de TODAS las preguntas propias antes de guardar la
// plantilla. Devuelve el primer error o null.
function validateCustomQuestions(questions) {
  return questions === undefined ? null : validateQuestionList(questions);
}

function validEnabledFields(enabledFields) {
  return Array.isArray(enabledFields) && enabledFields.every((f) => CHECKIN_FIELD_KEYS.includes(f));
}

// Un obligatorio que no está activado no tiene sentido (el cliente no lo
// vería y nunca podría enviar): se exige que sea subconjunto de enabledFields.
function requiredFieldsError(requiredFields, enabledFields) {
  if (requiredFields === undefined) return null;
  if (!validEnabledFields(requiredFields)) return "requiredFields contiene una clave no reconocida en el catálogo";
  if (enabledFields && requiredFields.some((f) => !enabledFields.includes(f))) {
    return "Un campo obligatorio tiene que estar activado en la plantilla";
  }
  return null;
}

module.exports = {
  // --- Lado profesional: CRUD de plantillas maestras ---
  async listDefinitions(req, res) {
    return res.send(await checkinService.listDefinitions(req.auth.userId));
  },

  async createDefinition(req, res) {
    const { name, enabledFields, requiredFields, customQuestions } = req.body || {};
    if (!name || !name.trim()) return res.status(400).send({ message: "name es obligatorio" });
    if (!validEnabledFields(enabledFields || [])) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    const requiredError = requiredFieldsError(requiredFields, enabledFields || []);
    if (requiredError) return res.status(400).send({ message: requiredError });
    const questionError = validateCustomQuestions(customQuestions);
    if (questionError) return res.status(400).send({ message: questionError });

    const definition = await checkinService.createDefinition(req.auth.userId, {
      name: name.trim(),
      enabledFields: enabledFields || [],
      customQuestions: (customQuestions || []).map(normalizeQuestionDefinition),
      requiredFields: requiredFields || [],
    });
    return res.status(201).send(definition);
  },

  async updateDefinition(req, res) {
    const { name, enabledFields, requiredFields, customQuestions } = req.body || {};
    if (enabledFields && !validEnabledFields(enabledFields)) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    const requiredError = requiredFieldsError(requiredFields, enabledFields);
    if (requiredError) return res.status(400).send({ message: requiredError });
    const questionError = validateCustomQuestions(customQuestions);
    if (questionError) return res.status(400).send({ message: questionError });

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (enabledFields !== undefined) updates.enabledFields = enabledFields;
    if (requiredFields !== undefined) updates.requiredFields = requiredFields;
    if (customQuestions !== undefined) updates.customQuestions = customQuestions.map(normalizeQuestionDefinition);

    return res.send(await checkinService.updateDefinition(req.auth.userId, req.params.id, updates));
  },

  async deleteDefinition(req, res) {
    await checkinService.deleteDefinition(req.auth.userId, req.params.id);
    return res.sendStatus(204);
  },

  // POST /trainer/checkin-templates/:id/apply — body: { clientIds, timing? }
  // Aplicar una plantilla es PROGRAMAR check-ins: crea (o reemplaza) la
  // programación de esa plantilla en cada cliente. Sin fechas en el cuerpo se
  // usan las por defecto (hoy, semanal) y el entrenador las afina en la ficha.
  async applyDefinition(req, res) {
    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : [];
    if (!clientIds.length) return res.status(400).send({ message: "clientIds es obligatorio y no puede estar vacío" });
    const timing = { ...defaultTiming(todayIsoDate(req.auth.timeZone)), ...(req.body?.timing || {}) };
    const timingError = validateTiming(timing);
    if (timingError) return res.status(400).send({ message: timingError });

    return res.send(await checkinService.applyDefinition(req.auth.userId, req.params.id, clientIds, timing));
  },

  // GET /trainer/checkins/responses — "Reportes": histórico de TODOS los
  // clientes de este entrenador.
  async getMyCheckinResponses(req, res) {
    return res.send(await checkinService.listResponsesForTrainer(req.auth.userId));
  },

  async getUnseenCount(req, res) {
    return res.send({ count: await checkinService.countUnseenForTrainer(req.auth.userId) });
  },

  // Visitar "Reportes" limpia el contador, igual que abrir una bandeja de
  // entrada.
  async markSeen(req, res) {
    await checkinService.markAllSeenForTrainer(req.auth.userId);
    return res.sendStatus(204);
  },

  // GET /trainer/clients/:clientId/checkin-responses — histórico de un cliente
  async getClientCheckinResponses(req, res) {
    return res.send(await checkinService.listResponses(req.auth.userId, req.params.clientId));
  },

  // --- Lado cliente ---
  // GET /trainer/checkins/mine — los check-ins ABIERTOS hoy, de cada
  // profesional con relación activa, con la semana de dieta a la que
  // pertenecen. Sin push ni recordatorios: la app pregunta al abrirse.
  async listMine(req, res) {
    return res.send(await checkinService.openForClient(req.auth.userId, todayIsoDate(req.auth.timeZone)));
  },

  // GET /trainer/checkins/mine/history — histórico del cliente (solo lectura:
  // un check-in cerrado ya no se toca).
  async listMyHistory(req, res) {
    return res.send(await checkinService.historyForClient(req.auth.userId));
  },

  // POST /trainer/checkins/:scheduleId/respond — el cliente responde (o
  // reescribe) el check-in ABIERTO de esa programación. Fuera de su ventana
  // de fechas no se puede ni escribir ni corregir: esa semana ya pasó.
  async respond(req, res) {
    const saved = await checkinService.respond(
      req.auth.userId,
      req.params.scheduleId,
      req.body?.values,
      todayIsoDate(req.auth.timeZone)
    );
    return res.status(saved.updated ? 200 : 201).send(saved);
  },
};
