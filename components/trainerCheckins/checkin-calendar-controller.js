const Schedule = require("./checkin-schedule-schema");
const Request = require("./checkin-request-schema");
const Legacy = require("./trainer-checkin-template-schema");
const dao = require("./checkin-dao");
const relations = require("../trainerClients/trainer-client-dao");
const { validateTiming, validDate, calendarDate, occurrenceAt, occurrencesBetween, nextOccurrence } = require("./checkin-schedule-dates");
const service = require("./checkin-calendar-service");
const scope = req => ({ trainerId: req.auth.userId, clientId: req.params.clientId });
const validId = id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const notFound = res => res.status(404).send({ message: "Check-in no encontrado" });

module.exports = {
  async calendar(req, res) {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to) || from > to || (new Date(to) - new Date(from)) > 370 * 86400000) return res.status(400).send({ message: "Elige un rango de hasta un año" });
    const schedules = await Schedule.find(scope(req)).sort({ createdAt: 1 }).lean();
    const [requests, legacyConfig, legacyResponses] = await Promise.all([
      Request.find({ ...scope(req), scheduledAt: { $gte: new Date(new Date(from).getTime() - 86400000), $lte: new Date(new Date(to).getTime() + 2 * 86400000) } }).sort({ scheduledAt: -1 }).lean(),
      Legacy.findOne(scope(req)).lean(),
      dao.listResponses(req.auth.userId, req.params.clientId),
    ]);
    const now = new Date();
    const scheduled = schedules.filter(s => s.active).flatMap(s => occurrencesBetween(s, now, new Date(new Date(to).getTime() + 2 * 86400000)).map(({ at, next }) => ({
      _id: `planned:${s._id}:${at.toISOString()}`, scheduleId: s._id, name: s.name,
      scheduledAt: at, closesAt: next, timeZone: s.timeZone, status: "scheduled",
    }))).filter(r => new Date(r.scheduledAt) >= new Date(new Date(from).getTime() - 86400000));
    const actualKeys = new Set(requests.map(r => `${r.scheduleId}:${new Date(r.scheduledAt).toISOString()}`));
    const entries = [...requests.map(r => ({ ...r, status: service.visibleStatus(r, now) })), ...scheduled.filter(r => !actualKeys.has(`${r.scheduleId}:${new Date(r.scheduledAt).toISOString()}`))];
    const [reviewCount, pendingReviews] = await Promise.all([
      Request.countDocuments({ ...scope(req), status: "responded" }),
      Request.find({ ...scope(req), status: "responded" }).sort({ respondedAt: 1 }).limit(200).lean(),
    ]);
    const historic = legacyResponses.filter(r => !r.scheduleId);
    const historicEntries = historic.filter(r => new Date(r.respondedAt) >= new Date(from) && new Date(r.respondedAt) <= new Date(`${to}T23:59:59.999Z`)).map(r => ({
      ...r, scheduleId: "legacy", name: "Check-in anterior", scheduledAt: r.respondedAt, timeZone: "UTC", status: "legacy", customQuestions: legacyConfig?.customQuestions || [],
    }));
    const responses = legacyResponses.filter(r => r.scheduleId).slice(0, 200);
    return res.send({ schedules, entries: [...entries, ...historicEntries], responses: [...responses, ...historic.map(r => ({ ...r, scheduleId: "legacy", customQuestions: legacyConfig?.customQuestions || [] }))], pendingReviews, reviewCount, legacyConfig: legacyConfig?.calendarManaged ? null : legacyConfig, legacyResponses: historic });
  },

  async saveSchedule(req, res) {
    const data = req.body || {};
    const error = validateTiming(data);
    if (error) return res.status(400).send({ message: error });
    if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) return res.status(400).send({ message: "Escribe un nombre de hasta 100 caracteres" });
    const existing = req.params.scheduleId && validId(req.params.scheduleId) ? await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId }).lean() : null;
    if (req.params.scheduleId && !existing) return notFound(res);
    let content = existing;
    if (!existing) {
      if (data.legacyConfigId) content = validId(data.legacyConfigId) ? await Legacy.findOne({ ...scope(req), _id: data.legacyConfigId, calendarManaged: { $ne: true } }).lean() : null;
      else content = validId(data.sourceTemplateId) ? await dao.getDefinitionById(req.auth.userId, data.sourceTemplateId) : null;
      if (!content) return res.status(400).send({ message: "Selecciona una plantilla disponible" });
    }
    if (!content.enabledFields?.length && !content.customQuestions?.some(q => q.enabled !== false)) return res.status(400).send({ message: "El check-in necesita al menos una pregunta activa" });
    const timing = { startDate: data.startDate, time: data.time, timeZone: data.timeZone, frequency: data.frequency, interval: data.interval };
    const now = new Date();
    // Se puede programar hoy; no se inventan solicitudes anteriores a hoy.
    if ((!existing || data.startDate !== existing.startDate) && data.startDate < calendarDate(now, data.timeZone)) return res.status(400).send({ message: "El inicio debe ser hoy o una fecha futura" });
    let schedule;
    if (existing) {
      if (data.revision !== existing.revision) return res.status(409).send({ message: "La programación ha cambiado. Recarga antes de guardarla" });
      schedule = await service.withScheduleLock(existing._id, async current => {
        if (current.revision !== data.revision) return { conflict: true };
        const timingChanged = Object.keys(timing).some(key => timing[key] !== current[key]);
        const updated = await Schedule.findOneAndUpdate({ ...scope(req), _id: current._id, revision: data.revision }, { $set: {
          ...timing, name: data.name.trim(),
          nextRunAt: timingChanged ? nextOccurrence(timing, now) : current.nextRunAt,
        }, $inc: { revision: 1 } }, { new: true }).lean();
        if (timingChanged) await Request.updateMany({ scheduleId: current._id, status: "pending" }, { $set: { closesAt: nextOccurrence(timing, now) } });
        return updated;
      });
      if (!schedule || schedule.conflict) return res.status(409).send({ message: "La programación está cambiando. Recarga y vuelve a intentarlo" });
    } else {
      schedule = await Schedule.create({ ...scope(req), ...timing, name: data.name.trim(), nextRunAt: occurrenceAt(timing, 0),
        sourceTemplateId: data.sourceTemplateId || content.sourceTemplateId || null, legacyConfigId: data.legacyConfigId || null,
        enabledFields: content.enabledFields, requiredFields: content.requiredFields || [], customQuestions: content.customQuestions || [],
      });
      if (data.legacyConfigId) await Legacy.updateOne({ ...scope(req), _id: data.legacyConfigId }, { $set: { calendarManaged: true } });
    }
    await service.materialize(schedule.toObject ? schedule.toObject() : schedule, now);
    return res.status(existing ? 200 : 201).send(schedule);
  },

  async setActive(req, res) {
    if (!validId(req.params.scheduleId) || typeof req.body?.active !== "boolean") return res.status(400).send({ message: "Programación no válida" });
    const schedule = await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId }).lean();
    if (!schedule) return notFound(res);
    const active = req.body.active;
    const result = await service.withScheduleLock(schedule._id, async current => {
      if (current.active === active) return {};
      await Schedule.updateOne({ ...scope(req), _id: current._id }, { $set: { active, nextRunAt: active ? nextOccurrence(current, new Date()) : null }, $inc: { revision: 1 } });
      if (!active) await Request.updateMany({ scheduleId: current._id, status: "pending" }, { $set: { status: "cancelled" } });
      return {};
    });
    if (result.conflict) return res.status(409).send({ message: "La programación está cambiando. Inténtalo de nuevo" });
    return res.sendStatus(204);
  },

  async requestNow(req, res) {
    if (!validId(req.params.scheduleId) || !/^[\w-]{16,80}$/.test(req.body?.requestKey || "")) return res.status(400).send({ message: "Solicitud no válida" });
    const schedule = await Schedule.findOne({ ...scope(req), _id: req.params.scheduleId, active: true }).lean();
    if (!schedule) return notFound(res);
    const result = await service.requestNow(schedule, req.body.requestKey);
    if (result.conflict) return res.status(409).send({ message: "La programación está cambiando. Inténtalo de nuevo" });
    return res.send(result);
  },

  async review(req, res) {
    if (!validId(req.params.requestId)) return notFound(res);
    const comment = req.body?.comment ?? "";
    if (typeof comment !== "string" || comment.length > 2000) return res.status(400).send({ message: "El comentario admite hasta 2000 caracteres" });
    let request = await Request.findOneAndUpdate({ ...scope(req), _id: req.params.requestId, status: "responded" }, {
      $set: { status: "reviewed", reviewedAt: new Date(), reviewComment: comment.trim(), seenByTrainer: true, projectedAt: null },
    }, { new: true }).lean();
    if (!request) request = await Request.findOne({ ...scope(req), _id: req.params.requestId, status: "reviewed", reviewComment: comment.trim() }).lean();
    if (!request) return res.status(409).send({ message: "Esta respuesta ya está revisada o no está disponible" });
    await service.projectAnswer(request);
    return res.send(request);
  },

  async respond(req, res) {
    if (!validId(req.params.requestId)) return notFound(res);
    const filter = { _id: req.params.requestId, clientId: req.auth.userId };
    const request = await Request.findOne(filter).lean();
    if (!request) return notFound(res);
    if (!await relations.findActiveByTrainerAndClient(request.trainerId, req.auth.userId)) return res.status(403).send({ message: "La relación con este profesional ya no está activa" });
    const result = service.validateAnswers(request, req.body?.values);
    if (result.error) return res.status(400).send({ message: result.error });
    if (["responded", "reviewed"].includes(request.status)) {
      if (!require("node:util").isDeepStrictEqual(request.values, result.values)) return res.status(409).send({ message: "Este check-in ya fue enviado" });
      await service.projectAnswer(request);
      return res.send(request);
    }
    const now = new Date();
    const saved = await Request.findOneAndUpdate({ ...filter, status: "pending", scheduledAt: { $lte: now }, $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }, {
      $set: { values: result.values, status: "responded", respondedAt: now },
    }, { new: true }).lean();
    if (!saved) return res.status(409).send({ message: "Este check-in ha cerrado. Abre el siguiente disponible" });
    await service.projectAnswer(saved);
    return res.status(201).send(saved);
  },
};
