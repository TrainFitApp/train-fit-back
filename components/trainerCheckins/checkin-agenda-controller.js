const Schedule = require("./checkin-schedule-schema");
const checkinDao = require("./checkin-dao");
const agenda = require("./checkin-agenda-service");
const notificationDao = require("../notifications/notification-dao");
const { validateTiming, validDate } = require("./checkin-schedule-dates");
const { CHECKIN_FIELDS_BY_KEY } = require("./checkin-field-catalog");
const { todayForUser } = require("../users/user-time-zone");

const scope = (req) => ({ trainerId: req.auth.userId, clientId: req.params.clientId });
const validId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const notFound = (res) => res.status(404).send({ message: "Check-in no encontrado" });

// Tope del resumen de Seguimiento: el chip más largo es "3 años".
const MAX_SUMMARY_DAYS = 3 * 365;

// Timing por defecto al aplicar una plantilla desde la biblioteca: empieza
// hoy (el del entrenador, que es quien la aplica), semanal. El entrenador lo
// afina después en la ficha del cliente — aplicar no debería obligar a
// rellenar un formulario de fechas.
function defaultTiming(today) {
  return { startDate: today, time: "09:00", frequency: "weekly", interval: 1 };
}

function scheduleContent(definition) {
  return {
    name: definition.name,
    sourceTemplateId: definition._id,
    enabledFields: definition.enabledFields || [],
    requiredFields: definition.requiredFields || [],
    customQuestions: (definition.customQuestions || []).map((q) => (typeof q.toObject === "function" ? q.toObject() : q)),
  };
}

// PURO. Preguntas elegidas campo a campo, sin plantilla: solo claves del
// catálogo, sin repetir, ninguna obligatoria y sin preguntas propias.
// null si alguna clave no existe.
function looseContent(fields) {
  const enabledFields = [...new Set(fields)];
  if (enabledFields.some((key) => !CHECKIN_FIELDS_BY_KEY.has(key))) return null;
  return { sourceTemplateId: null, enabledFields, requiredFields: [], customQuestions: [] };
}

function hasQuestions(content) {
  return !!content.enabledFields?.length || !!content.customQuestions?.some((q) => q.enabled !== false);
}

/**
 * Las preguntas que pide el cuerpo de la petición: campos sueltos
 * (`enabledFields`) o una plantilla (`sourceTemplateId`). Al editar, volver a
 * mandar la misma plantilla no la copia otra vez: `content` sale null y las
 * preguntas se quedan como estaban.
 */
async function requestedContent(req, data, existing) {
  if (Array.isArray(data.enabledFields)) {
    const content = looseContent(data.enabledFields);
    return content ? { content } : { error: "Hay un campo de check-in que no existe" };
  }
  if (existing && (!data.sourceTemplateId || String(existing.sourceTemplateId) === data.sourceTemplateId)) {
    return { content: null };
  }
  const definition = validId(data.sourceTemplateId)
    ? await checkinDao.getDefinitionById(req.auth.userId, data.sourceTemplateId)
    : null;
  return definition ? { content: scheduleContent(definition) } : { error: "Selecciona una plantilla disponible" };
}

module.exports = {
  scheduleContent,
  looseContent,
  hasQuestions,
  defaultTiming,

  // GET /trainer/clients/:clientId/checkin-agenda?from&to
  async agenda(req, res) {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 370 * 86400000) {
      return res.status(400).send({ message: "Elige un rango de hasta un año" });
    }
    const today = await todayForUser(req.params.clientId);
    const { schedules, entries } = await agenda.agendaFor(req.auth.userId, req.params.clientId, from, to, today);
    // Las respuestas viajan con la MISMA forma que las entradas de la agenda
    // (no el documento crudo): la pestaña "Por revisar" y la comparación
    // entre respuestas leen `responseId`/`date` igual que en el calendario,
    // y sin esto el botón de revisar no sabía a qué respuesta apuntaba.
    const responses = (await checkinDao.listResponses(req.auth.userId, req.params.clientId)).map((response) =>
      agenda.entryOfResponse(response)
    );
    const reviewCount = responses.filter((r) => r.status === "responded").length;
    return res.send({
      schedules: schedules.map((schedule) => ({ ...schedule, nextDate: agenda.nextDateOf(schedule, today) })),
      entries,
      responses,
      reviewCount,
    });
  },

  // GET /trainer/clients/:clientId/checkin-summary?days=N — de las ocurrencias
  // de los últimos N días (hoy incluido), cuántas siguen abiertas y cuántas
  // se cerraron sin respuesta. Calculado al vuelo, igual que la agenda.
  async summary(req, res) {
    const days = Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_SUMMARY_DAYS) {
      return res.status(400).send({ message: "Elige un rango de hasta 3 años" });
    }
    const today = await todayForUser(req.params.clientId);
    const { open, missed } = await agenda.summaryFor(req.auth.userId, req.params.clientId, days - 1, today);
    return res.send({ days, open, missed });
  },

  // GET /trainer/clients/:clientId/checkin-schedules
  // Las programaciones a secas, sin agenda: lo que necesita la ficha para
  // decir "2 check-ins" y abrir el panel. Pedir la agenda entera para esto
  // traería un año de ocurrencias calculadas que nadie va a pintar.
  async listSchedules(req, res) {
    return res.send(await Schedule.find(scope(req)).sort({ createdAt: 1 }).lean());
  },

  // GET /trainer/clients/:clientId/checkin-schedules/:scheduleId/history?before&limit
  // Todas las ocurrencias de UNA programación, de la más nueva a la más
  // vieja, respondidas o no. Sin tope de rango: pagina hacia atrás con
  // `before` (la fecha que devuelve `nextBefore`).
  async scheduleHistory(req, res) {
    const { before, limit } = req.query || {};
    if (!validId(req.params.scheduleId)) return notFound(res);
    if (before !== undefined && !validDate(before)) {
      return res.status(400).send({ message: "before inválida (YYYY-MM-DD)" });
    }
    const size = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(size) || size < 1 || size > 200) {
      return res.status(400).send({ message: "limit debe estar entre 1 y 200" });
    }

    const schedule = await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId }).lean();
    if (!schedule) return notFound(res);

    const history = await agenda.scheduleHistory(schedule, {
      before: before || null,
      limit: size,
      today: await todayForUser(req.params.clientId),
    });
    return res.send({ schedule, ...history });
  },

  // POST/PUT /trainer/clients/:clientId/checkin-schedules[/:scheduleId]
  async saveSchedule(req, res) {
    const data = req.body || {};
    const timingError = validateTiming(data);
    if (timingError) return res.status(400).send({ message: timingError });
    if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) {
      return res.status(400).send({ message: "Escribe un nombre de hasta 100 caracteres" });
    }

    const existing =
      req.params.scheduleId && validId(req.params.scheduleId)
        ? await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId }).lean()
        : null;
    if (req.params.scheduleId && !existing) return notFound(res);

    const timing = {
      startDate: data.startDate,
      time: data.time,
      frequency: data.frequency,
      interval: data.interval,
    };

    const { content, error } = await requestedContent(req, data, existing);
    if (error) return res.status(400).send({ message: error });
    if (content && !hasQuestions(content)) {
      return res.status(400).send({ message: "El check-in necesita al menos una pregunta activa" });
    }

    if (existing) {
      if (data.revision !== undefined && data.revision !== existing.revision) {
        return res.status(409).send({ message: "La programación ha cambiado. Recarga antes de guardarla" });
      }
      // Cambiar las preguntas no toca lo ya respondido: cada respuesta guarda
      // una copia de las suyas (checkin-response-schema.js).
      const updated = await Schedule.findOneAndUpdate(
        { ...scope(req), _id: existing._id, revision: existing.revision },
        { $set: { ...content, ...timing, name: data.name.trim() }, $inc: { revision: 1 } },
        { new: true }
      ).lean();
      if (!updated) return res.status(409).send({ message: "La programación está cambiando. Recarga y vuelve a intentarlo" });
      return res.send(updated);
    }

    const created = await Schedule.create({ ...scope(req), ...content, ...timing, name: data.name.trim() });
    return res.status(201).send(created);
  },

  // POST /trainer/clients/:clientId/checkin-schedules/:scheduleId/request —
  // "Enviarlo ahora". Sin solicitudes guardadas no se adelanta la ocurrencia:
  // se crea una programación "once" de hoy con las mismas preguntas (mismos
  // _id en las propias, para que sus respuestas se sigan leyendo igual). Si
  // hoy ya tiene una abierta sin responder, no se duplica.
  async requestNow(req, res) {
    if (!validId(req.params.scheduleId)) return notFound(res);
    const schedule = await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId }).lean();
    if (!schedule) return notFound(res);
    if (!schedule.active) return res.status(409).send({ message: "Reanuda la programación antes de enviarla" });

    const today = await todayForUser(req.params.clientId);
    if (await agenda.openUnanswered(schedule, today)) return res.send({ alreadyOpen: true });

    const created = await Schedule.create({
      ...scope(req),
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
    return res.status(201).send(created);
  },

  // PATCH /trainer/clients/:clientId/checkin-schedules/:scheduleId/active
  async setActive(req, res) {
    if (!validId(req.params.scheduleId) || typeof req.body?.active !== "boolean") {
      return res.status(400).send({ message: "Programación no válida" });
    }
    const updated = await Schedule.findOneAndUpdate(
      { ...scope(req), _id: req.params.scheduleId },
      { $set: { active: req.body.active }, $inc: { revision: 1 } },
      { new: true }
    ).lean();
    if (!updated) return notFound(res);
    return res.sendStatus(204);
  },

  // DELETE /trainer/clients/:clientId/checkin-schedules/:scheduleId — quita la
  // programación. Las respuestas ya dadas se quedan: son historial del
  // cliente, no de la programación.
  async deleteSchedule(req, res) {
    if (!validId(req.params.scheduleId)) return notFound(res);
    const deleted = await Schedule.findOneAndDelete({ ...scope(req), _id: req.params.scheduleId }).lean();
    if (!deleted) return notFound(res);
    return res.sendStatus(204);
  },

  // POST /trainer/clients/:clientId/checkin-responses/:responseId/review
  async review(req, res) {
    if (!validId(req.params.responseId)) return notFound(res);
    const comment = req.body?.comment ?? "";
    if (typeof comment !== "string" || comment.length > 2000) {
      return res.status(400).send({ message: "El comentario admite hasta 2000 caracteres" });
    }
    const reviewed = await checkinDao.review(
      req.auth.userId,
      req.params.clientId,
      req.params.responseId,
      comment.trim()
    );
    if (!reviewed) return notFound(res);

    // Aviso dentro de la app (no push): el cliente ve que su check-in ya
    // está revisado la próxima vez que la abre.
    await notificationDao.create(req.params.clientId, req.auth.userId, "checkin_reviewed", {
      name: reviewed.name,
      occurrenceDate: reviewed.occurrenceDate,
      hasComment: !!reviewed.reviewComment,
    });
    return res.send(reviewed);
  },
};
