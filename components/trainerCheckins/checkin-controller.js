const checkinDao = require("./checkin-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const notificationDao = require("../notifications/notification-dao");
const CheckinSchedule = require("./checkin-schedule-schema");
const calendarService = require("./checkin-calendar-service");
const { occurrenceAt, validateTiming, calendarDate } = require("./checkin-schedule-dates");
const userSchema = require("../users/schema");
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");
const { validateQuestionDefinition } = require("./checkin-custom-question");
const CheckinRequest = require("./checkin-request-schema");

// Hora por defecto al programar desde una plantilla. El entrenador puede
// cambiarla luego en el calendario del cliente.
const DEFAULT_SCHEDULE_TIME = "09:00";
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";

// Fase 5 Coach Pro — comprueba la forma de TODAS las preguntas propias antes
// de guardar la plantilla. Devuelve el primer error o null.
function validateCustomQuestions(questions) {
  if (questions === undefined) return null;
  if (!Array.isArray(questions)) return "customQuestions debe ser una lista";
  if (questions.length > 20) return "Una plantilla admite como mucho 20 preguntas propias";
  for (const question of questions) {
    const error = validateQuestionDefinition(question);
    if (error) return error;
  }
  return null;
}

function validEnabledFields(enabledFields) {
  return (
    Array.isArray(enabledFields) &&
    enabledFields.every((f) => CHECKIN_FIELD_KEYS.includes(f))
  );
}

module.exports = {
  // --- Lado profesional: CRUD de plantillas maestras ---
  async listDefinitions(req, res) {
    const definitions = await checkinDao.listDefinitions(req.auth.userId);
    return res.send(definitions);
  },

  async createDefinition(req, res) {
    const { name, enabledFields, frequency, interval, customQuestions } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).send({ message: "name es obligatorio" });
    }
    if (!validEnabledFields(enabledFields || [])) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    const questionError = validateCustomQuestions(customQuestions);
    if (questionError) return res.status(400).send({ message: questionError });

    try {
      const definition = await checkinDao.createDefinition(
        req.auth.userId,
        name.trim(),
        enabledFields || [],
        { frequency: frequency || "weekly", interval: interval || 1 },
        customQuestions || []
      );
      return res.status(201).send(definition);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      }
      throw e;
    }
  },

  async updateDefinition(req, res) {
    const { name, enabledFields, frequency, interval, customQuestions } = req.body || {};
    if (enabledFields && !validEnabledFields(enabledFields)) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    const questionError = validateCustomQuestions(customQuestions);
    if (questionError) return res.status(400).send({ message: questionError });

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (enabledFields !== undefined) updates.enabledFields = enabledFields;
    if (frequency !== undefined) updates.frequency = frequency;
    if (interval !== undefined) updates.interval = interval;
    if (customQuestions !== undefined) updates.customQuestions = customQuestions;

    try {
      const definition = await checkinDao.updateDefinition(req.auth.userId, req.params.id, updates);
      if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
      return res.send(definition);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      }
      throw e;
    }
  },

  async deleteDefinition(req, res) {
    const definition = await checkinDao.deleteDefinition(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
    return res.sendStatus(204);
  },

  // POST /trainer/checkin-templates/:id/apply — body: { clientIds, timeZone }
  //
  // Aplicar una plantilla a varios clientes es PROGRAMARLES el check-in.
  // Antes esto escribía una "configuración aplicada" con su propia cadencia,
  // un segundo motor en paralelo al calendario: el que de verdad genera las
  // solicitudes, el que cuenta para la adherencia y el que ve el cliente.
  // Ahora escribe directamente en ese, con la periodicidad por defecto de la
  // plantilla; el entrenador puede afinarla luego cliente a cliente.
  async applyDefinition(req, res) {
    const definition = await checkinDao.getDefinitionById(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });

    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : [];
    if (!clientIds.length) {
      return res.status(400).send({ message: "clientIds es obligatorio y no puede estar vacío" });
    }
    if (!definition.enabledFields?.length && !definition.customQuestions?.some((q) => q.enabled !== false)) {
      return res.status(400).send({ message: "El check-in necesita al menos una pregunta activa" });
    }

    const now = new Date();
    const timeZone = typeof req.body?.timeZone === "string" && req.body.timeZone ? req.body.timeZone : DEFAULT_TIME_ZONE;
    // Fase 8b — antes esto era siempre "hoy, semanal": el entrenador que
    // quería aplicar en bloque para dentro de tres días, o a diario, tenía
    // que aplicar y luego entrar cliente a cliente a cambiar la fecha. Los
    // tres overrides son opcionales; sin ellos se comporta igual que antes
    // (hoy, a la hora y periodicidad por defecto de la plantilla).
    const timing = {
      startDate: typeof req.body?.startDate === "string" ? req.body.startDate : now.toISOString().slice(0, 10),
      time: typeof req.body?.time === "string" ? req.body.time : DEFAULT_SCHEDULE_TIME,
      timeZone,
      frequency: typeof req.body?.frequency === "string" ? req.body.frequency : (definition.frequency || "weekly"),
      interval: Number.isInteger(req.body?.interval) ? req.body.interval : (definition.interval || 1),
    };
    const timingError = validateTiming(timing);
    if (timingError) return res.status(400).send({ message: timingError });
    // Mismo criterio que saveSchedule: no se inventan solicitudes anteriores a hoy.
    if (timing.startDate < calendarDate(now, timing.timeZone)) {
      return res.status(400).send({ message: "El inicio debe ser hoy o una fecha futura" });
    }

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      // Transversal: cualquier scope de relación activa con ESTE profesional basta.
      const relation = await trainerClientDao.findActiveByTrainerAndClient(req.auth.userId, clientId);
      if (!relation) {
        skipped.push(clientId);
        continue;
      }

      const schedule = await CheckinSchedule.create({
        trainerId: req.auth.userId,
        clientId,
        name: definition.name,
        sourceTemplateId: definition._id,
        enabledFields: definition.enabledFields,
        customQuestions: definition.customQuestions || [],
        ...timing,
        nextRunAt: occurrenceAt(timing, 0),
      });
      // La primera solicitud sale ya: aplicar una plantilla y que el cliente
      // no vea nada hasta la semana que viene se lee como que no funcionó.
      await calendarService.materialize(schedule.toObject(), now);
      applied.push(clientId);
    }

    return res.send({ applied, skipped });
  },

  // GET /trainer/clients/:clientId/checkin-responses — profesional, histórico
  async getClientCheckinResponses(req, res) {
    const responses = await checkinDao.listResponses(req.auth.userId, req.params.clientId);
    return res.send(responses);
  },

  // GET /trainer/checkins/responses — TASK-002 ("Reportes"): histórico de
  // check-ins de TODOS los clientes de este entrenador, no solo uno.
  // trainerId ya escopea correctamente (a diferencia de listMyHistory, no
  // hace falta iterar por cliente). clientId viene populado con
  // name/lastname/email — se aplana a `client` para que el frontend no
  // tenga que distinguir entre el campo crudo y el objeto poblado.
  async getMyCheckinResponses(req, res) {
    const responses = await checkinDao.listResponsesForTrainer(req.auth.userId);

    return res.send(
      responses.map(({ clientId, ...rest }) => ({
        ...rest,
        client: clientId && typeof clientId === "object" ? clientId : null,
        // El enunciado de una pregunta propia viaja EN la respuesta desde que
        // cada solicitud guarda su propia copia (ver checkin-request-schema):
        // antes había que ir a buscarlo a la configuración aplicada del
        // cliente, que ya no existe.
        customQuestions: (rest.customQuestions || []).map((question) => ({
          _id: question._id,
          label: question.label,
          type: question.type,
          unit: question.unit || "",
          options: question.options || [],
        })),
      }))
    );
  },

  // GET /trainer/checkins/unseen-count
  // TASK-024 (MASTER_BACKLOG.md)
  async getUnseenCount(req, res) {
    const count = await checkinDao.countUnseenForTrainer(req.auth.userId);
    return res.send({ count });
  },

  // POST /trainer/checkins/mark-seen — marca TODAS las respuestas del
  // trainer como vistas (misma semántica que "abrir la bandeja" en un
  // cliente de correo: visitar Reportes limpia el contador).
  async markSeen(req, res) {
    await checkinDao.markAllSeenForTrainer(req.auth.userId);
    return res.sendStatus(204);
  },

  // --- Lado cliente ---
  // GET /trainer/checkins/mine — sus check-ins abiertos ahora mismo.
  //
  // Antes esto mezclaba dos cosas: las "configuraciones aplicadas" del
  // sistema legacy (que no eran una solicitud concreta, sino una intención
  // permanente) y las solicitudes reales del calendario. El cliente veía un
  // formulario siempre abierto junto a otro con fecha de cierre, sin
  // diferencia visible entre ambos. Ahora solo hay solicitudes.
  async listMine(req, res) {
    const now = new Date();
    const pending = await CheckinRequest.find({
      clientId: req.auth.userId,
      status: "pending",
      scheduledAt: { $lte: now },
      $or: [{ closesAt: null }, { closesAt: { $gt: now } }],
    }).lean();

    const visible = [];
    for (const request of pending) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(request.trainerId, req.auth.userId);
      if (relation) visible.push({ ...request, requestId: request._id });
    }

    const trainerIds = [...new Set(visible.map((c) => String(c.trainerId)))];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    return res.send(visible.map((c) => ({ ...c, trainer: trainersById.get(String(c.trainerId)) || null })));
  },

  // GET /trainer/checkins/mine/history — coach-tab FASE2, "formularios
  // completados": histórico de TODAS las respuestas del cliente, de
  // cualquier profesional con relación activa. Solo cubre respuestas con
  // algún campo "wellbeing" (incluido el nuevo "comment") — las respuestas
  // puramente de composición corporal/perímetros no generan CheckinResponse
  // (ver checkin-dao.js, van a Anthropometry), así que no aparecen aquí.
  async listMyHistory(req, res) {
    const clientId = req.auth.userId;
    const activeRelations = await trainerClientDao.findActiveByClient(clientId);
    const trainerIds = [...new Set(activeRelations.map((relation) => String(relation.trainerId)))];

    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    const allResponses = [];
    for (const trainerId of trainerIds) {
      const responses = await checkinDao.listResponses(trainerId, clientId);
      for (const response of responses) {
        allResponses.push({ ...response, trainer: trainersById.get(trainerId) || null });
      }
    }
    allResponses.sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));

    return res.send(allResponses);
  },
};

