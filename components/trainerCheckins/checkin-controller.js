const checkinDao = require("./checkin-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { isReadOnly } = require("../trainerClients/trainer-seat-service");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const notificationDao = require("../notifications/notification-dao");
const { cadenceDays } = require("./checkin-due");
const { cycleForClientAt } = require("../planAssignments/client-cycle");
const userSchema = require("../users/schema");
const {
  CHECKIN_FIELDS_BY_KEY,
  CHECKIN_FIELD_KEYS,
  scaleLevelsFor,
  isPlausibleValue,
} = require("./checkin-field-catalog");
const {
  isCustomKey,
  questionIdFromKey,
  validateCustomAnswer,
  normalizeCustomAnswer,
  validateQuestionDefinition,
} = require("./checkin-custom-question");

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function validEnabledFields(enabledFields) {
  return (
    Array.isArray(enabledFields) &&
    enabledFields.every((f) => CHECKIN_FIELD_KEYS.includes(f))
  );
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

// Primer campo del catálogo obligatorio sin responder, o null.
function missingRequiredField(requiredFields, values) {
  for (const key of requiredFields || []) {
    const value = values[key];
    if (value === null || value === undefined || value === "") return CHECKIN_FIELDS_BY_KEY.get(key)?.label || key;
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
    const { name, enabledFields, requiredFields, cadence, customQuestions } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).send({ message: "name es obligatorio" });
    }
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
        cadence || "weekly",
        customQuestions || [],
        requiredFields || []
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
    const { name, enabledFields, requiredFields, cadence, customQuestions } = req.body || {};
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
    if (cadence !== undefined) updates.cadence = cadence;
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

  // POST /trainer/checkin-templates/:id/apply — body: { clientIds: [...] }
  async applyDefinition(req, res) {
    const definition = await checkinDao.getDefinitionById(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });

    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : [];
    if (!clientIds.length) {
      return res.status(400).send({ message: "clientIds es obligatorio y no puede estar vacío" });
    }

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      // Transversal: cualquier scope de relación activa con ESTE profesional basta.
      const relation = await trainerClientDao.findActiveByTrainerAndClient(req.auth.userId, clientId);
      if (!relation || await isReadOnly(req.auth.userId, clientId)) {
        skipped.push(clientId);
        continue;
      }
      await checkinDao.applyToClient(req.auth.userId, clientId, definition);
      await notificationDao.create(clientId, req.auth.userId, "checkin_requested", {
        templateName: definition.name,
      });
      applied.push(clientId);
    }

    return res.send({ applied, skipped });
  },

  // GET /trainer/clients/:clientId/checkin-config — profesional, config ya aplicada
  async getClientCheckinConfig(req, res) {
    const config = await checkinDao.getAppliedConfig(req.auth.userId, req.params.clientId);
    return res.send(config);
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
    const [responses, configs] = await Promise.all([
      checkinDao.listResponsesForTrainer(req.auth.userId),
      // Una sola consulta para TODAS las plantillas del trainer: sin esto
      // las respuestas a preguntas propias se listaban con su clave cruda
      // ("custom:6a9033db…") en vez del enunciado, porque el enunciado no
      // está en el catálogo — vive en la plantilla aplicada a ese cliente.
      checkinDao.getAppliedConfigsForTrainer(req.auth.userId),
    ]);

    const preguntasPorCliente = new Map();
    for (const config of configs) {
      const clientKey = String(config.clientId?._id || config.clientId);
      const previas = preguntasPorCliente.get(clientKey) || [];
      preguntasPorCliente.set(clientKey, [...previas, ...(config.customQuestions || [])]);
    }

    return res.send(
      responses.map(({ clientId, ...rest }) => ({
        ...rest,
        client: clientId && typeof clientId === "object" ? clientId : null,
        // Solo lo que hace falta para pintar la respuesta.
        customQuestions: (rest.customQuestions || preguntasPorCliente.get(String(clientId?._id || clientId)) || []).map(
          (question) => ({
            _id: question._id,
            label: question.label,
            type: question.type,
            unit: question.unit || "",
            options: question.options || [],
          })
        ),
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
  // GET /trainer/checkins/mine — qué campos le piden, por cada profesional con relación activa
  async listMine(req, res) {
    const configs = await checkinDao.getAppliedConfigsForClient(req.auth.userId);
    const activeTrainerIds = new Set();
    for (const config of configs) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(config.trainerId, req.auth.userId);
      if (relation) activeTrainerIds.add(String(config.trainerId));
    }
    const now = new Date();
    const pending = await require("./checkin-request-schema").find({ clientId: req.auth.userId, status: "pending", scheduledAt: { $lte: now }, $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }).lean();
    for (const request of pending) {
      if (await trainerClientDao.findActiveByTrainerAndClient(request.trainerId, req.auth.userId)) activeTrainerIds.add(String(request.trainerId));
    }
    const visible = [
      ...configs.filter((c) => !c.calendarManaged && activeTrainerIds.has(String(c.trainerId))),
      // Sin "cadence": un CheckinRequest es una ocurrencia puntual del
      // sistema de calendario (frequency/interval viven en CheckinSchedule,
      // no aquí) — inventar "once" mentía sobre la periodicidad real.
      ...pending.filter(r => activeTrainerIds.has(String(r.trainerId))).map(r => ({ ...r, requestId: r._id })),
    ];

    const trainerIds = [...new Set(visible.map((c) => String(c.trainerId)))];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    // Ciclos por contenido — si el cliente está en una fase de dieta, el
    // check-in va por ciclo: se dice cuál es y si ya lo respondió.
    const cycle = await cycleForClientAt(req.auth.userId, todayIsoDate());
    const out = [];
    for (const c of visible) {
      let cycleCheckin = null;
      if (cycle && !c.requestId) {
        const existing = await checkinDao.findResponseForCycle(c.trainerId, req.auth.userId, cycle);
        cycleCheckin = {
          phaseId: cycle.phaseId,
          number: cycle.number,
          start: cycle.start,
          end: cycle.end,
          hasResponse: !!existing,
          responseId: existing ? String(existing._id) : null,
          respondedAt: existing?.respondedAt || null,
        };
      }
      out.push({ ...c, trainer: trainersById.get(String(c.trainerId)) || null, cycleCheckin });
    }
    return res.send(out);
  },

  // GET /trainer/checkins/mine/history — coach-tab FASE2, "formularios
  // completados": histórico de TODAS las respuestas del cliente, de
  // cualquier profesional con relación activa. Solo cubre respuestas con
  // algún campo "wellbeing" (incluido el nuevo "comment") — las respuestas
  // puramente de composición corporal/perímetros no generan CheckinResponse
  // (ver checkin-dao.js, van a Anthropometry), así que no aparecen aquí.
  async listMyHistory(req, res) {
    const clientId = req.auth.userId;
    const configs = await checkinDao.getAppliedConfigsForClient(clientId);
    const activeTrainerIds = new Set();
    for (const config of configs) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(config.trainerId, clientId);
      if (relation) activeTrainerIds.add(String(config.trainerId));
    }

    const activeRelations = await trainerClientDao.findActiveByClient(clientId);
    for (const relation of activeRelations) activeTrainerIds.add(String(relation.trainerId));
    const trainerIds = [...activeTrainerIds];
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

  // POST /trainer/checkins/:trainerId/respond
  async respond(req, res) {
    const clientId = req.auth.userId;
    const trainerId = req.params.trainerId;

    const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId);
    if (!relation) {
      return res.status(403).send({ message: "No tienes una relación activa con este profesional" });
    }

    const config = await checkinDao.getAppliedConfig(trainerId, clientId);
    if (config?.calendarManaged) return res.status(409).send({ message: "Abre el check-in pendiente desde Mis check-ins" });
    const enabledFields = new Set(config?.enabledFields || []);

    // Fase 5 — preguntas propias activas de ESTE cliente (las de su copia
    // aplicada, no las de la plantilla maestra, que puede haber cambiado
    // desde entonces).
    const customQuestions = new Map(
      (config?.customQuestions || [])
        .filter((q) => q.enabled)
        .map((q) => [String(q._id), q])
    );

    const values = req.body?.values || {};
    const submittedKeys = Object.keys(values);

    // Las obligatorias se comprueban ANTES que nada: si falta una, el
    // check-in entero se rechaza sin guardar la mitad de las respuestas.
    const missingField = missingRequiredField(config?.requiredFields, values);
    if (missingField) {
      return res.status(400).send({
        message: `"${missingField}" es obligatoria`,
        code: "CHECKIN_REQUIRED_MISSING",
      });
    }
    for (const [questionId, question] of customQuestions) {
      if (!question.required) continue;
      const key = `custom:${questionId}`;
      const value = values[key];
      if (value === null || value === undefined || value === "") {
        return res.status(400).send({
          message: `"${question.label}" es obligatoria`,
          code: "CHECKIN_REQUIRED_MISSING",
        });
      }
    }

    for (const key of submittedKeys) {
      if (isCustomKey(key)) {
        const question = customQuestions.get(questionIdFromKey(key));
        if (!question) {
          return res.status(400).send({
            message: "Esa pregunta ya no está activa en este check-in",
            code: "CHECKIN_FIELD_NOT_ACTIVE",
          });
        }
        const error = validateCustomAnswer(question, values[key]);
        if (error) return res.status(400).send({ message: error });
        values[key] = normalizeCustomAnswer(question, values[key]);
        continue;
      }

      if (!enabledFields.has(key)) {
        return res.status(400).send({
          message: `El campo "${key}" no está activo para este check-in`,
          code: "CHECKIN_FIELD_NOT_ACTIVE",
        });
      }
      const fieldDef = CHECKIN_FIELDS_BY_KEY.get(key);
      const value = values[key];
      // El máximo sale de las anclas del campo, no de un 5 fijo: el color de
      // orina tiene 8 niveles y el resto 5, sin que ninguno necesite un tipo
      // propio. Ver checkin-field-catalog.js#scaleLevelsFor.
      if (fieldDef.type === "scale_1_5") {
        const levels = scaleLevelsFor(fieldDef);
        if (value < 1 || value > levels) {
          return res.status(400).send({ message: `"${key}" debe estar entre 1 y ${levels}` });
        }
      }
      // Cotas de plausibilidad: un ombligo de 44 cm no es una medida, es un
      // dedo que ha resbalado. Se rechaza AQUÍ, al teclearlo, que es el único
      // momento en que alguien puede corregirlo. Ver el comentario de min/max
      // en checkin-field-catalog.js para el fallo real que originó esto.
      if (fieldDef.type === "number" && !isPlausibleValue(fieldDef, value)) {
        const unit = fieldDef.unit ? ` ${fieldDef.unit}` : "";
        const range =
          fieldDef.min !== undefined && fieldDef.max !== undefined
            ? ` Debe estar entre ${fieldDef.min}${unit} y ${fieldDef.max}${unit}.`
            : "";
        return res.status(400).send({
          message: `"${fieldDef.label}" no parece una medida real.${range}`,
          code: "CHECKIN_VALUE_IMPLAUSIBLE",
        });
      }
      if (fieldDef.type === "text") {
        if (typeof value !== "string" || !value.trim()) {
          return res.status(400).send({ message: `"${key}" es obligatorio y debe ser texto` });
        }
        if (value.length > 1000) {
          return res.status(400).send({ message: `"${key}" no puede superar 1000 caracteres` });
        }
        values[key] = value.trim();
      }
    }

    const anthropometryFields = {};
    for (const key of submittedKeys) {
      // Una pregunta propia nunca escribe en Anthropometry: no tiene
      // semántica conocida (ver checkin-custom-question.js).
      if (isCustomKey(key)) continue;
      const fieldDef = CHECKIN_FIELDS_BY_KEY.get(key);
      if (fieldDef.storage === "anthropometry") {
        anthropometryFields[fieldDef.anthropometryField] = values[key];
      }
    }

    let anthropometryDoc = null;
    if (Object.keys(anthropometryFields).length) {
      anthropometryDoc = await anthropometryDao.mergeAnthropometryFields(
        clientId,
        todayIsoDate(),
        anthropometryFields
      );
    }

    // Antes solo se creaba CheckinResponse si había campos wellbeing — un
    // check-in respondido ÚNICAMENTE con composición corporal (peso,
    // perímetros...) nunca generaba ningún registro aquí, así que jamás
    // aparecía en "Respuestas de check-in" del trainer aunque el cliente sí
    // hubiera respondido y visto el toast de éxito. Ahora se guarda SIEMPRE
    // que se haya enviado algo, con TODOS los valores enviados (no solo los
    // wellbeing) — usa las mismas claves del catálogo que ya sabe
    // renderizar el frontend del trainer (checkinFieldLabel/Unit), así que
    // los campos de composición se ven ahí con su etiqueta y unidad
    // correctas sin tocar el frontend.
    // UN check-in por ciclo. Antes cada envío creaba un CheckinResponse
    // nuevo sin mirar si ya había uno esa semana, así que un cliente podía
    // acumular siete respuestas donde la cadencia pedía una — de ahí el
    // "7 de 4" de la ficha. Si ya respondió su ciclo, el envío no crea otra:
    // reescribe la suya, para que pueda corregirse sin perder el registro.
    //
    // `respondedAt` no se toca al reescribir: moverlo cambiaría el ciclo al
    // que pertenece la respuesta y falsearía la adherencia.
    //
    // Ciclos por contenido (docs/plan-ciclos-por-contenido.md): con fase de
    // dieta, el ciclo es el de la DIETA (una respuesta por ciclo, la última
    // sobreescribe a la anterior y sí actualiza respondedAt). Sin fase, la
    // ventana de cadencia de siempre.
    let responseDoc = null;
    let updated = false;
    if (submittedKeys.length) {
      const cycle = await cycleForClientAt(clientId, todayIsoDate());
      let existente = null;
      if (cycle) {
        existente = await checkinDao.findResponseForCycle(trainerId, clientId, cycle);
      } else if (config?.cadence !== "once") {
        existente = await checkinDao.findResponseInCurrentCycle(
          trainerId,
          clientId,
          cadenceDays(config?.cadence),
          new Date()
        );
      }

      if (existente && cycle) {
        responseDoc = await checkinDao.overwriteCycleResponse(existente._id, values);
        updated = true;
      } else if (existente) {
        responseDoc = await checkinDao.updateResponseValues(existente._id, values);
        updated = true;
      } else {
        const cycleKey = cycle
          ? { phaseId: cycle.phaseId, number: cycle.number, start: cycle.start, end: cycle.end }
          : null;
        responseDoc = await checkinDao.createResponse(trainerId, clientId, values, cycleKey);
      }
      await notificationDao.createForTrainer(trainerId, clientId, "checkin_responded", {});
    }

    return res
      .status(updated ? 200 : 201)
      .send({ anthropometry: anthropometryDoc, response: responseDoc, updated });
  },
};
