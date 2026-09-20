const checkinDao = require("./checkin-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const agenda = require("./checkin-agenda-service");
const Schedule = require("./checkin-schedule-schema");
const userSchema = require("../users/schema");
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");
const { validateQuestionDefinition } = require("./checkin-custom-question");
const { validateTiming } = require("./checkin-schedule-dates");
const { scheduleContent, hasQuestions, defaultTiming } = require("./checkin-agenda-controller");
const { revisionForClientAt } = require("../planAssignments/revision-service");

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
    const definitions = await checkinDao.listDefinitions(req.auth.userId);
    return res.send(definitions);
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

    try {
      const definition = await checkinDao.createDefinition(
        req.auth.userId,
        name.trim(),
        enabledFields || [],
        customQuestions || [],
        requiredFields || []
      );
      return res.status(201).send(definition);
    } catch (e) {
      if (e.code === 11000) return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      throw e;
    }
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
    if (customQuestions !== undefined) updates.customQuestions = customQuestions;

    try {
      const definition = await checkinDao.updateDefinition(req.auth.userId, req.params.id, updates);
      if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
      return res.send(definition);
    } catch (e) {
      if (e.code === 11000) return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      throw e;
    }
  },

  async deleteDefinition(req, res) {
    const definition = await checkinDao.deleteDefinition(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
    return res.sendStatus(204);
  },

  // POST /trainer/checkin-templates/:id/apply — body: { clientIds, timing? }
  // Aplicar una plantilla es PROGRAMAR check-ins: crea (o reemplaza) la
  // programación de esa plantilla en cada cliente. Sin fechas en el cuerpo se
  // usan las por defecto (hoy, semanal) y el entrenador las afina en la ficha.
  async applyDefinition(req, res) {
    const definition = await checkinDao.getDefinitionById(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });

    const content = scheduleContent(definition);
    if (!hasQuestions(content)) {
      return res.status(400).send({ message: "El check-in necesita al menos una pregunta activa" });
    }

    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : [];
    if (!clientIds.length) return res.status(400).send({ message: "clientIds es obligatorio y no puede estar vacío" });

    const timing = { ...defaultTiming(), ...(req.body?.timing || {}) };
    const timingError = validateTiming(timing);
    if (timingError) return res.status(400).send({ message: timingError });

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      // Cualquier scope de relación activa con ESTE profesional basta.
      const relation = await trainerClientDao.findActiveByTrainerAndClient(req.auth.userId, clientId);
      if (!relation) {
        skipped.push(clientId);
        continue;
      }
      await Schedule.findOneAndUpdate(
        { trainerId: req.auth.userId, clientId, sourceTemplateId: definition._id },
        { $set: { ...content, ...timing, active: true }, $inc: { revision: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      applied.push(clientId);
    }

    return res.send({ applied, skipped });
  },

  // GET /trainer/checkins/responses — "Reportes": histórico de TODOS los
  // clientes de este entrenador.
  async getMyCheckinResponses(req, res) {
    const responses = await checkinDao.listResponsesForTrainer(req.auth.userId);
    return res.send(
      responses.map(({ clientId, ...rest }) => ({
        ...rest,
        client: clientId && typeof clientId === "object" ? clientId : null,
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

  async getUnseenCount(req, res) {
    const count = await checkinDao.countUnseenForTrainer(req.auth.userId);
    return res.send({ count });
  },

  // Visitar "Reportes" limpia el contador, igual que abrir una bandeja de
  // entrada.
  async markSeen(req, res) {
    await checkinDao.markAllSeenForTrainer(req.auth.userId);
    return res.sendStatus(204);
  },

  // GET /trainer/clients/:clientId/checkin-responses — histórico de un cliente
  async getClientCheckinResponses(req, res) {
    const responses = await checkinDao.listResponses(req.auth.userId, req.params.clientId);
    return res.send(responses);
  },

  // --- Lado cliente ---
  // GET /trainer/checkins/mine — los check-ins ABIERTOS hoy, de cada
  // profesional con relación activa, con la revisión de dieta a la que
  // pertenecen. Sin push ni recordatorios: la app pregunta al abrirse.
  async listMine(req, res) {
    const clientId = req.auth.userId;
    const relations = await trainerClientDao.findActiveByClient(clientId);
    const trainerIds = relations.map((relation) => String(relation.trainerId?._id || relation.trainerId));
    if (!trainerIds.length) return res.send([]);

    const today = agenda.todayIso();
    const open = await agenda.openForClient(clientId, today, trainerIds);
    const revision = await revisionForClientAt(clientId, today);
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    return res.send(
      open.map(({ schedule, entry }) => ({
        ...entry,
        trainerId: String(schedule.trainerId),
        trainer: trainersById.get(String(schedule.trainerId)) || null,
        revision,
      }))
    );
  },

  // GET /trainer/checkins/mine/history — histórico del cliente (solo lectura:
  // un check-in cerrado ya no se toca).
  async listMyHistory(req, res) {
    const clientId = req.auth.userId;
    const relations = await trainerClientDao.findActiveByClient(clientId);
    const trainerIds = relations.map((relation) => String(relation.trainerId?._id || relation.trainerId));
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    const responses = await checkinDao.listResponsesForClient(clientId);
    return res.send(
      responses.map((response) => ({
        ...response,
        trainer: trainersById.get(String(response.trainerId)) || null,
      }))
    );
  },

  // POST /trainer/checkins/:scheduleId/respond — el cliente responde (o
  // reescribe) el check-in ABIERTO de esa programación. Fuera de su ventana
  // de fechas no se puede ni escribir ni corregir: esa revisión ya pasó.
  async respond(req, res) {
    const clientId = req.auth.userId;
    const schedule = await Schedule.findOne({ _id: req.params.scheduleId, clientId }).lean();
    if (!schedule) return res.status(404).send({ message: "Check-in no encontrado" });

    const relation = await trainerClientDao.findActiveByTrainerAndClient(schedule.trainerId, clientId);
    if (!relation) return res.status(403).send({ message: "No tienes una relación activa con este profesional" });

    const today = agenda.todayIso();
    const open = await agenda.openForClient(clientId, today, [String(schedule.trainerId)]);
    const current = open.find((o) => String(o.schedule._id) === String(schedule._id));
    if (!current) {
      return res.status(409).send({
        message: "Este check-in ya está cerrado. Responde el siguiente cuando llegue su fecha",
        code: "CHECKIN_CLOSED",
      });
    }

    const result = agenda.validateAnswers(schedule, req.body?.values);
    if (result.error) return res.status(400).send({ message: result.error, code: "CHECKIN_INVALID_ANSWER" });

    const saved = await agenda.saveResponse({
      schedule,
      occurrence: current.occurrence,
      values: result.values,
      today,
    });
    return res.status(saved.updated ? 200 : 201).send(saved);
  },
};
