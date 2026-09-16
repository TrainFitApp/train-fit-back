const Schedule = require("./checkin-schedule-schema");
const Request = require("./checkin-request-schema");
const Notification = require("../notifications/notification-schema");
const relations = require("../trainerClients/trainer-client-dao");
const { occurrencesBetween, nextOccurrence } = require("./checkin-schedule-dates");
const { CHECKIN_FIELDS_BY_KEY, isPlausibleValue, scaleLevelsFor } = require("./checkin-field-catalog");
const { validateCustomAnswer, normalizeCustomAnswer } = require("./checkin-custom-question");
const { randomUUID } = require("node:crypto");
const { calendarDate } = require("./checkin-schedule-dates");

// La misma exclusión cubre cron, cambios de fechas y solicitudes manuales.
// Un proceso que caiga libera el bloqueo por caducidad.
async function withScheduleLock(id, action) {
  const token = randomUUID();
  const now = new Date();
  const schedule = await Schedule.findOneAndUpdate({ _id: id, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, {
    $set: { leaseUntil: new Date(now.getTime() + 5 * 60000), leaseToken: token },
  }, { new: true }).lean();
  if (!schedule) return { conflict: true };
  try { return await action(schedule); }
  finally { await Schedule.updateOne({ _id: id, leaseToken: token }, { $set: { leaseUntil: null, leaseToken: null } }); }
}

function requestIsOpen(request, now = new Date()) {
  return request.status === "pending" && new Date(request.scheduledAt) <= now &&
    (!request.closesAt || new Date(request.closesAt) > now);
}

function visibleStatus(request, now = new Date()) {
  return request.status === "pending" && request.closesAt && new Date(request.closesAt) <= now ? "unanswered" : request.status;
}

function validateAnswers(request, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Responde al menos una pregunta" };
  const values = {};
  const questions = new Map((request.customQuestions || []).filter(q => q.enabled !== false).map(q => [`custom:${q._id}`, q]));
  for (const key of request.requiredFields || []) {
    if (input[key] == null || input[key] === "") return { error: `Falta responder: ${CHECKIN_FIELDS_BY_KEY.get(key)?.label || key}` };
  }
  for (const [key, question] of questions) {
    if (question.required && (input[key] == null || input[key] === "")) return { error: `Falta responder: ${question.label}` };
  }
  for (const [key, value] of Object.entries(input)) {
    if (questions.has(key)) {
      const question = questions.get(key);
      const error = validateCustomAnswer(question, value);
      if (error) return { error };
      values[key] = normalizeCustomAnswer(question, value);
      continue;
    }
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (!field || !request.enabledFields.includes(key)) return { error: "Esa pregunta no pertenece a este check-in" };
    if (field.type === "number" && !isPlausibleValue(field, value)) return { error: `Revisa el valor de ${field.label}` };
    if (field.type === "scale_1_5" && (!Number.isInteger(value) || value < 1 || value > scaleLevelsFor(field))) return { error: `Revisa la escala de ${field.label}` };
    if (field.type === "text" && (typeof value !== "string" || !value.trim() || value.length > 1000)) return { error: "El comentario debe tener entre 1 y 1000 caracteres" };
    values[key] = typeof value === "string" ? value.trim() : value;
  }
  return Object.keys(values).length ? { values } : { error: "Responde al menos una pregunta" };
}

async function queueNotice(request, type = "checkin_requested", recipient = "client") {
  const dedupeKey = `${type}:${request._id}`;
  const notice = await Notification.findOneAndUpdate({ dedupeKey }, { $setOnInsert: {
    dedupeKey, clientId: request.clientId, trainerId: request.trainerId, recipient, type,
    payload: { requestId: String(request._id), templateName: request.name, route: "/my-checkins" },
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (type === "checkin_requested") await Request.updateOne({ _id: request._id }, { $set: { notificationQueuedAt: new Date() } });
  return notice;
}

function snapshot(schedule) {
  return { trainerId: schedule.trainerId, clientId: schedule.clientId, scheduleId: schedule._id,
    name: schedule.name, enabledFields: schedule.enabledFields, requiredFields: schedule.requiredFields || [], customQuestions: schedule.customQuestions,
    timeZone: schedule.timeZone };
}

async function materialize(schedule, now = new Date()) {
  return withScheduleLock(schedule._id, current => materializeLocked(current, now));
}

async function materializeLocked(schedule, now) {
  if (!schedule.active || !schedule.nextRunAt || new Date(schedule.nextRunAt) > now) return;
  if (!await relations.findActiveByTrainerAndClient(schedule.trainerId, schedule.clientId)) {
    await Schedule.updateOne({ _id: schedule._id }, { $set: { active: false } });
    await Request.updateMany({ scheduleId: schedule._id, status: "pending" }, { $set: { status: "cancelled" } });
    return;
  }
  const occurrences = occurrencesBetween(schedule, schedule.nextRunAt, now);
  for (const { at, next } of occurrences) {
    const occurrenceKey = `${schedule._id}:${at.toISOString()}`;
    const status = next && next <= now ? "unanswered" : "pending";
    await Request.updateOne({ occurrenceKey }, { $setOnInsert: {
      ...snapshot(schedule), occurrenceKey, scheduledAt: at, closesAt: next, status,
    } }, { upsert: true, setDefaultsOnInsert: true });
  }
  await Request.updateMany({ scheduleId: schedule._id, status: "pending", closesAt: { $ne: null, $lte: now } }, { $set: { status: "unanswered" } });
  if (occurrences.length) {
    await Schedule.updateOne({ _id: schedule._id, revision: schedule.revision, nextRunAt: schedule.nextRunAt }, {
      $set: { nextRunAt: occurrences[occurrences.length - 1].next },
    });
  }
}

async function processCalendar(now = new Date()) {
  const due = await Schedule.find({ active: true, nextRunAt: { $ne: null, $lte: now } }).limit(500).lean();
  let failed = 0;
  for (const schedule of due) {
    try { await materialize(schedule, now); }
    catch (error) { if (error.code !== 11000) { failed++; console.error("[checkin-calendar] No se pudo preparar una solicitud", schedule._id); } }
  }
  // También repara una caída entre crear la solicitud y encolar el aviso.
  const open = await Request.find({ notificationQueuedAt: null, status: "pending", scheduledAt: { $lte: now }, $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }).limit(1000).lean();
  for (const request of open) {
    if (await relations.findActiveByTrainerAndClient(request.trainerId, request.clientId)) await queueNotice(request);
  }
  const unprojected = await Request.find({ projectedAt: null, status: { $in: ["responded", "reviewed"] } }).limit(200).lean();
  for (const request of unprojected) {
    try { await projectAnswer(request); }
    catch { failed++; }
  }
  return { processed: due.length, failed };
}

async function requestNow(schedule, key, now = new Date()) {
  return withScheduleLock(schedule._id, async current => {
    if (!current.active) return { conflict: true };
    await materializeLocked(current, now);
    return requestNowLocked(current, key, now);
  });
}

async function requestNowLocked(schedule, key, now) {
  const existing = await Request.findOne({ scheduleId: schedule._id, status: "pending", scheduledAt: { $lte: now }, $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }).lean();
  if (existing) return existing;
  const occurrenceKey = `${schedule._id}:manual:${key}`;
  const request = await Request.findOneAndUpdate({ occurrenceKey }, { $setOnInsert: {
    ...snapshot(schedule), occurrenceKey, scheduledAt: now, closesAt: nextOccurrence(schedule, now), manual: true,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  await queueNotice(request);
  return request;
}

async function projectAnswer(request) {
  // El registro canónico es la solicitud. Esta proyección idempotente mantiene
  // compatibles informes, adherencia y reglas que leen CheckinResponse.
  const Response = require("./checkin-response-schema");
  try {
    await Response.updateOne({ _id: request._id, $or: [{ projectedVersionAt: { $exists: false } }, { projectedVersionAt: { $lte: request.updatedAt } }] }, { $set: {
      trainerId: request.trainerId, clientId: request.clientId, scheduleId: request.scheduleId, name: request.name,
      values: request.values, respondedAt: request.respondedAt, customQuestions: request.customQuestions,
      status: request.status, reviewedAt: request.reviewedAt, reviewComment: request.reviewComment,
      ...(request.status === "reviewed" ? { seenByTrainer: true } : {}), projectedVersionAt: request.updatedAt,
    } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const fields = {};
  for (const [key, value] of Object.entries(request.values)) {
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (field?.storage === "anthropometry") fields[field.anthropometryField] = value;
  }
  if (Object.keys(fields).length && !request.anthropometryProjectedAt) {
    await require("../anthropometry/anthropometry-dao").mergeCheckinFields(request.clientId,
      calendarDate(new Date(request.respondedAt), request.timeZone), fields, request._id);
    await Request.updateOne({ _id: request._id }, { $set: { anthropometryProjectedAt: new Date() } });
  }
  await queueNotice(request, "checkin_responded", "trainer");
  if (request.status === "reviewed") await queueNotice(request, "checkin_reviewed");
  await Request.updateOne({ _id: request._id, status: request.status, reviewedAt: request.reviewedAt || null }, { $set: { projectedAt: new Date() } });
}

module.exports = { requestIsOpen, visibleStatus, validateAnswers, queueNotice, materialize, processCalendar, requestNow, projectAnswer, withScheduleLock };
