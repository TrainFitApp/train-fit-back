const Schedule = require("./checkin-schedule-schema");
const checkinDao = require("./checkin-dao");
const agenda = require("./checkin-agenda-service");
const notificationDao = require("../notifications/notification-dao");
const { validateTiming, validDate } = require("./checkin-schedule-dates");
const { isoDate } = require("../util/date-util");

const scope = (req) => ({ trainerId: req.auth.userId, clientId: req.params.clientId });
const validId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const notFound = (res) => res.status(404).send({ message: "Check-in no encontrado" });

// Timing por defecto al aplicar una plantilla desde la biblioteca: empieza
// hoy, semanal. El entrenador lo afina después en la ficha del cliente —
// aplicar no debería obligar a rellenar un formulario de fechas.
function defaultTiming() {
  return { startDate: isoDate(new Date()), time: "09:00", frequency: "weekly", interval: 1 };
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

function hasQuestions(content) {
  return !!content.enabledFields?.length || !!content.customQuestions?.some((q) => q.enabled !== false);
}

module.exports = {
  scheduleContent,
  hasQuestions,
  defaultTiming,

  // GET /trainer/clients/:clientId/checkin-agenda?from&to
  async agenda(req, res) {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 370 * 86400000) {
      return res.status(400).send({ message: "Elige un rango de hasta un año" });
    }
    const { schedules, entries } = await agenda.agendaFor(req.auth.userId, req.params.clientId, from, to);
    // Las respuestas viajan con la MISMA forma que las entradas de la agenda
    // (no el documento crudo): la pestaña "Por revisar" y la comparación
    // entre respuestas leen `responseId`/`date` igual que en el calendario,
    // y sin esto el botón de revisar no sabía a qué respuesta apuntaba.
    const responses = (await checkinDao.listResponses(req.auth.userId, req.params.clientId)).map((response) =>
      agenda.entryOfResponse(response)
    );
    const reviewCount = responses.filter((r) => r.status === "responded").length;
    return res.send({ schedules, entries, responses, reviewCount });
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

    if (existing) {
      if (data.revision !== undefined && data.revision !== existing.revision) {
        return res.status(409).send({ message: "La programación ha cambiado. Recarga antes de guardarla" });
      }
      const updated = await Schedule.findOneAndUpdate(
        { ...scope(req), _id: existing._id, revision: existing.revision },
        { $set: { ...timing, name: data.name.trim() }, $inc: { revision: 1 } },
        { new: true }
      ).lean();
      if (!updated) return res.status(409).send({ message: "La programación está cambiando. Recarga y vuelve a intentarlo" });
      return res.send(updated);
    }

    const definition = validId(data.sourceTemplateId)
      ? await checkinDao.getDefinitionById(req.auth.userId, data.sourceTemplateId)
      : null;
    if (!definition) return res.status(400).send({ message: "Selecciona una plantilla disponible" });
    const content = scheduleContent(definition);
    if (!hasQuestions(content)) return res.status(400).send({ message: "El check-in necesita al menos una pregunta activa" });

    const created = await Schedule.create({ ...scope(req), ...content, ...timing, name: data.name.trim() });
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
