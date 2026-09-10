const mongoose = require("mongoose");
const User = require("../users/schema");
const Relation = require("../trainerClients/trainer-client-schema");
const Note = require("../trainerNotes/trainer-note-schema");
const Task = require("../coachTasks/coach-task-schema");
const Request = require("../trainerCheckins/checkin-request-schema");
const Preferences = require("../nutritionPreferences/nutrition-preferences-schema");
const Anthropometry = require("../anthropometry/anthropometry-dao");
const { CoachingStage, OverviewReview, OverviewAudit } = require("./overview-schema");
const { resolveStage, stageFilter, recheckAccess } = require("./stage-service");
const { MEASUREMENT_CATALOG, PROFILE_FIELDS, NUTRITION_FIELDS, fail, fingerprint, pick, validDate, requestId, normalizeContext } = require("./overview-domain");
const { buildBodyMetrics, civilToday } = require("./body-metrics");
const { getTimeZone } = require("./measurement-profile");
const { missingFields } = require("./intake-service");
const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

const publicStage = (s) => ({ id: String(s._id), startedAt: s.startedAt, endedAt: s.endedAt, startEstimated: s.startEstimated, legacy: s.legacy });
const publicItem = (i) => ({ ...i, id: String(i._id), version: i.version || 0 });
function latestWellbeing(checkins) {
  const ordered = checkins.filter((c) => c.respondedAt && ["responded", "reviewed"].includes(c.status)).sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));
  const priority = ["comment", "general_fatigue", "sleep_quality", "recovery_between_sessions", "sleep_hours"];
  return priority.map((key) => {
    const definition = CHECKIN_FIELDS.find((f) => f.key === key);
    const request = ordered.find((r) => r.values?.[key] !== undefined && r.values[key] !== null && r.values[key] !== "");
    if (!definition || !request) return null;
    const value = request.values[key];
    const anchor = definition.type === "scale_1_5" && Number.isInteger(value) ? definition.anchors?.[value - 1] : null;
    return { key, label: definition.label, value, displayValue: anchor || `${value}${definition.unit ? ` ${definition.unit}` : ""}`, recordedAt: request.respondedAt, requestId: String(request._id) };
  }).filter(Boolean);
}
function ownerFilter(trainerId, clientId, stage) { return { trainerId, clientId, ...stageFilter(stage) }; }
function versionFilter(version) { return version === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version }; }
function requireVersion(actual, expected) { if (!Number.isInteger(expected) || actual !== expected) fail("La información ha cambiado. Conserva tu borrador y actualiza antes de guardar.", 409, "VERSION_CONFLICT"); }
function taskOrder(a, b) {
  if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
  if (a.dueDate !== b.dueDate) { if (!a.dueDate) return 1; if (!b.dueDate) return -1; return a.dueDate.localeCompare(b.dueDate); }
  return new Date(b.createdAt) - new Date(a.createdAt) || String(a._id).localeCompare(String(b._id));
}
async function listNotes(trainerId, clientId, stage, limit = 100, offset = 0) {
  const filter = ownerFilter(trainerId, clientId, stage);
  const [items, total] = await Promise.all([Note.find(filter).sort({ pinned: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(), Note.countDocuments(filter)]);
  return { items: items.map(publicItem), total, nextOffset: offset + items.length < total ? offset + items.length : null };
}
async function listTasks(trainerId, clientId, stage, { status, limit = 100, offset = 0 } = {}) {
  const filter = ownerFilter(trainerId, clientId, stage);
  if (status) filter.status = status;
  // Derivar claves antes de LIMIT mantiene la misma prioridad incluso con más de 100 tareas.
  const castFilter = { ...filter, trainerId: new mongoose.Types.ObjectId(trainerId), clientId: new mongoose.Types.ObjectId(clientId) };
  const [items, total] = await Promise.all([Task.aggregate([
    { $match: castFilter }, { $addFields: { _doneOrder: { $cond: [{ $eq: ["$status", "pending"] }, 0, 1] }, _missingDate: { $cond: [{ $ifNull: ["$dueDate", false] }, 0, 1] } } },
    { $sort: { _doneOrder: 1, _missingDate: 1, dueDate: 1, createdAt: -1, _id: -1 } }, { $skip: offset }, { $limit: limit }, { $project: { _doneOrder: 0, _missingDate: 0 } },
  ]), Task.countDocuments(filter)]);
  return { items: items.map(publicItem), total, nextOffset: offset + items.length < total ? offset + items.length : null };
}
async function listReviews(trainerId, clientId, stage, limit = 50, offset = 0) {
  const filter = { trainerId, clientId, stageId: stage._id };
  const [items, total] = await Promise.all([OverviewReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(), OverviewReview.countDocuments(filter)]);
  return { items: items.map(publicItem), total, nextOffset: offset + items.length < total ? offset + items.length : null };
}
async function observations(trainerId, clientId, stage, timeZone) {
  const clientTimeZone = timeZone || await getTimeZone(clientId);
  const lastMeasurementDate = stage.endedAt ? civilToday(clientTimeZone, new Date(stage.endedAt)) : null;
  const filter = { trainerId, clientId, scheduledAt: { $gte: stage.startedAt, ...(stage.endedAt ? { $lte: stage.endedAt } : {}) } };
  const [bodyResult, checkinResult] = await Promise.allSettled([Anthropometry.getAllAnthropometriesByUserId(clientId), Request.find(filter).sort({ scheduledAt: -1, _id: -1 }).select("status values respondedAt updatedAt scheduledAt closesAt reviewedAt name").lean()]);
  const allEntries = bodyResult.status === "fulfilled" ? bodyResult.value : null;
  const checkins = checkinResult.status === "fulfilled" ? checkinResult.value : null;
  const entries = allEntries && lastMeasurementDate ? allEntries.filter((e) => e.date <= lastMeasurementDate) : allEntries;
  const fields = MEASUREMENT_CATALOG.map((m) => m.key);
  const digest = entries && checkins ? fingerprint({ entries: entries.map((e) => ({ id: String(e._id), date: e.date, ...pick(e, fields) })), checkins: checkins.map((c) => ({ id: String(c._id), status: c.status, values: c.values, respondedAt: c.respondedAt, updatedAt: c.updatedAt })), version: stage.version }) : null;
  return { entries, checkins, digest, errors: { ...(!entries ? { body: "No se pudieron cargar las mediciones" } : {}), ...(!checkins ? { checkins: "No se pudieron cargar los check-ins" } : {}) } };
}
async function getOverview(trainerId, clientId, stageId) {
  const { stage, stages, current, relations } = await resolveStage(trainerId, clientId, stageId);
  const user = await User.findById(clientId).select([...PROFILE_FIELDS, "email"].join(" ")).lean();
  if (!user) fail("Cliente no encontrado", 404);
  const timeZone = await getTimeZone(clientId);
  const today = stage.endedAt ? civilToday(timeZone, new Date(stage.endedAt)) : civilToday(timeZone);
  const names = ["body", "notes", "tasks", "reviews", "nutrition"];
  const hasNutrition = relations.some((r) => r.scope === "nutrition" && r.status === "active");
  const settled = await Promise.allSettled([observations(trainerId, clientId, stage, timeZone), listNotes(trainerId, clientId, stage), listTasks(trainerId, clientId, stage, { status: "pending", limit: 8 }), listReviews(trainerId, clientId, stage, 1), hasNutrition ? Preferences.findOne({ clientId }).lean() : Promise.resolve(null)]);
  const sectionsErrors = {}; const sections = {};
  settled.forEach((result, index) => { if (result.status === "fulfilled") sections[names[index]] = result.value; else { sectionsErrors[names[index]] = "No se pudo cargar esta sección"; console.error(`Overview ${names[index]}:`, result.reason?.message); } });
  Object.assign(sectionsErrors, sections.body?.errors || {});
  let age = null;
  if (user.birth) { const birthday = new Date(user.birth).toISOString().slice(0, 10); age = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0); if (age < 0 || age > 130) age = null; }
  const latest = sections.reviews?.items[0] || null;
  const observedFingerprint = sections.body?.digest && !sectionsErrors.nutrition ? fingerprint({ data: sections.body.digest, identity: pick(user, PROFILE_FIELDS), nutrition: sections.nutrition ? pick(sections.nutrition, NUTRITION_FIELDS) : null }) : null;
  const checkins = sections.body?.checkins;
  return {
    identity: { ...pick(user, PROFILE_FIELDS), heightCm: user.height ?? null, age, email: user.email, scopes: relations.filter((r) => r.status === "active").map((r) => r.scope), trainingGoalType: relations.find((r) => r.scope === "training" && String(r.stageId) === String(stage._id))?.trainingGoalType || null, profileVersion: fingerprint(pick(user, PROFILE_FIELDS)) },
    stage: publicStage(stage), stages: stages.map(publicStage).reverse(), readOnly: String(stage._id) !== String(current?._id),
    context: { values: stage.currentContext || {}, version: stage.version, updatedAt: stage.updatedAt, updatedBy: stage.updatedBy || null },
    intake: { available: Boolean(stage.intakeSnapshot), legacy: stage.intakeSnapshot?.legacy || false, submittedAt: stage.intakeSnapshot?.submittedAt || null, missingMeasurements: missingFields(stage) },
    settings: { highlightedPerimeters: stage.highlightedPerimeters, version: stage.version },
    body: sections.body?.entries ? buildBodyMetrics(sections.body.entries, stage.baselines, { timeZone, highlightedPerimeters: stage.highlightedPerimeters, today, weeks: 8 }) : null,
    pinnedNotes: sections.notes?.items.filter((n) => n.pinned) || [], notes: sections.notes || null, tasks: sections.tasks || null,
    review: { latest, hasNewData: Boolean(latest && observedFingerprint && latest.observedFingerprint !== observedFingerprint), observedFingerprint, observedAt: new Date(), coverage: ["context", "profile", "measurements", "checkins", ...(sections.nutrition ? ["nutritionPreferences"] : [])] },
    checkins: checkins ? { pendingReviewCount: checkins.filter((c) => c.status === "responded").length, waitingResponseCount: checkins.filter((c) => c.status === "pending" && new Date(c.scheduledAt) <= new Date() && (!c.closesAt || new Date(c.closesAt) > new Date())).length, overdueResponseCount: checkins.filter((c) => c.status === "unanswered" || (c.status === "pending" && c.closesAt && new Date(c.closesAt) <= new Date())).length, lastResponseAt: checkins.filter((c) => c.respondedAt).map((c) => c.respondedAt).sort((a, b) => new Date(b) - new Date(a))[0] || null } : null,
    wellbeing: checkins ? latestWellbeing(checkins) : [],
    nutrition: hasNutrition && !sectionsErrors.nutrition ? { values: pick(sections.nutrition || {}, NUTRITION_FIELDS), version: fingerprint(pick(sections.nutrition || {}, NUTRITION_FIELDS)) } : null,
    timeZone, sectionsErrors,
  };
}
function intakeDetail(stage) {
  const snapshot = stage.intakeSnapshot;
  if (!snapshot) return null;
  const answers = { ...snapshot.answers, ...snapshot.nutrition };
  const responses = (snapshot.questions || []).map((q) => {
    const measurement = (snapshot.measurements || []).find((m) => m.field === q.key);
    const custom = (snapshot.answers?.customAnswers || []).find((a) => a.questionId === q.key);
    let value = measurement?.value ?? custom?.value ?? answers[q.key] ?? null;
    if (q.key === "equipment") value = [snapshot.answers.trainingLocation, ...(snapshot.answers.equipmentTags || []), snapshot.answers.equipment].filter(Boolean).join(" · ") || null;
    return { key: q.key, label: q.label, value, ...(q.unit ? { unit: q.unit } : {}), ...(measurement ? { date: measurement.date } : {}) };
  });
  if (!responses.length) Object.entries(answers).filter(([key]) => key !== "customAnswers").forEach(([key, value]) => responses.push({ key, label: key, value }));
  for (const answer of snapshot.answers?.customAnswers || []) if (!responses.some((r) => r.key === answer.questionId)) responses.push({ key: answer.questionId, label: answer.label, value: answer.value });
  const originalMeasurementFields = new Set((snapshot.measurements || []).map((m) => m.field));
  const laterBaselineFields = new Set((stage.changes || []).filter((change) => change.kind === "baselines")
    .flatMap((change) => (change.after || []).map((baseline) => baseline.key)));
  // "existing" describe la medición reutilizada, no cuándo se confirmó como
  // referencia: puede pertenecer al envío original o a un complemento posterior.
  const complements = (stage.baselines || []).filter((baseline) => baseline.source === "completion" || baseline.source === "professional"
    || (baseline.source === "existing" && (!originalMeasurementFields.has(baseline.key) || laterBaselineFields.has(baseline.key))));
  return { ...snapshot, missingFields: missingFields(stage), responses, complements };
}
async function updateContext(trainerId, clientId, data) {
  const { stage, relations } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  requireVersion(stage.version, data.expectedVersion);
  const patch = normalizeContext(data.patch);
  const environmentChanged = Object.keys(patch).some((key) => ["trainingLocation", "equipmentTags", "equipment"].includes(key));
  if (environmentChanged && !relations.some((r) => r.scope === "training" && r.status === "active")) fail("Necesitas un ámbito de entrenamiento activo para cambiar el lugar o equipo", 403, "NO_TRAINING_SCOPE");
  const next = { ...stage.currentContext, ...patch };
  await recheckAccess(trainerId, clientId, stage._id, false, environmentChanged ? "training" : undefined);
  const updated = await CoachingStage.findOneAndUpdate({ _id: stage._id, version: stage.version }, { $set: { currentContext: next, updatedBy: trainerId }, $inc: { version: 1 }, $push: { changes: { kind: "context", before: pick(stage.currentContext, Object.keys(patch)), after: patch, actorId: trainerId, at: new Date() } } }, { new: true }).lean();
  if (!updated) fail("Otra edición cambió el contexto. Tu borrador no se ha sobrescrito.", 409, "VERSION_CONFLICT");
  return { values: updated.currentContext, version: updated.version, updatedAt: updated.updatedAt, updatedBy: updated.updatedBy };
}
async function updateSettings(trainerId, clientId, data) {
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  requireVersion(stage.version, data.expectedVersion);
  const fields = data.highlightedPerimeters;
  if (!Array.isArray(fields) || fields.length > 3 || new Set(fields).size !== fields.length || fields.some((key) => !MEASUREMENT_CATALOG.some((m) => m.key === key && m.unit === "cm"))) fail("Selecciona como máximo tres perímetros del catálogo");
  await recheckAccess(trainerId, clientId, stage._id);
  const updated = await CoachingStage.findOneAndUpdate({ _id: stage._id, version: stage.version }, { $set: { highlightedPerimeters: fields, updatedBy: trainerId }, $inc: { version: 1 } }, { new: true }).lean();
  if (!updated) fail("La ficha cambió antes de guardar", 409, "VERSION_CONFLICT");
  return { highlightedPerimeters: fields, version: updated.version };
}
async function updateShared(trainerId, clientId, data, nutrition = false) {
  const { stage, relations } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  if (nutrition && !relations.some((r) => r.scope === "nutrition" && r.status === "active")) fail("Necesitas un ámbito de nutrición activo", 403, "NO_NUTRITION_SCOPE");
  const fields = nutrition ? NUTRITION_FIELDS : PROFILE_FIELDS;
  const patch = data.patch;
  if (!patch || typeof patch !== "object" || !Object.keys(patch).length || Object.keys(patch).some((k) => !fields.includes(k))) fail("Campo de perfil no permitido");
  for (const [key, value] of Object.entries(patch)) {
    if (["name", "lastname", "allergies", "favoriteFoods", "dislikedFoods"].includes(key) && (typeof value !== "string" || value.length > (key === "name" ? 100 : key === "lastname" ? 200 : 1000))) fail("Texto de perfil inválido");
    if (key === "birth" && value !== null && (!validDate(value) || value > civilToday(await getTimeZone(clientId)) || Number(value.slice(0, 4)) < new Date().getFullYear() - 130)) fail("Fecha de nacimiento inválida");
    if (key === "height" && (typeof value !== "number" || !Number.isFinite(value) || value < 70 || value > 300)) fail("Altura inválida");
    if (key === "sex" && ![0, 1, 2, null].includes(value)) fail("Sexo inválido");
    if (key === "activity" && (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 2.5)) fail("Actividad inválida");
    if (key === "cooksAtHome" && !["yes", "no", "sometimes", null].includes(value)) fail("Preferencia inválida");
  }
  const Model = nutrition ? Preferences : User;
  const owner = nutrition ? { clientId } : { _id: clientId };
  const existing = await Model.findOne(owner).lean();
  const before = pick(existing || {}, fields);
  if (data.expectedVersion !== fingerprint(before)) fail("El perfil cambió desde que lo abriste. Revisa los valores actuales.", 409, "VERSION_CONFLICT");
  const filter = { ...owner, ...Object.fromEntries(fields.map((k) => [k, existing?.[k] === undefined ? { $exists: false } : existing[k]])) };
  const audit = await OverviewAudit.create({ trainerId, clientId, stageId: stage._id, kind: nutrition ? "nutrition" : "profile", before: pick(before, Object.keys(patch)), after: patch });
  let updated;
  try {
    await recheckAccess(trainerId, clientId, stage._id, false, nutrition ? "nutrition" : undefined);
    updated = await Model.findOneAndUpdate(filter, { $set: { ...patch, ...(nutrition ? { updatedAt: new Date() } : {}) } }, { new: true, runValidators: true, upsert: nutrition && !existing }).lean();
  }
  catch (e) { await OverviewAudit.deleteOne({ _id: audit._id }); throw e; }
  if (!updated) { await OverviewAudit.deleteOne({ _id: audit._id }); fail("Otra edición cambió el perfil", 409, "VERSION_CONFLICT"); }
  return { values: pick(updated, fields), version: fingerprint(pick(updated, fields)) };
}
async function saveNote(trainerId, clientId, data, noteId) {
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  if (data.text !== undefined && (typeof data.text !== "string" || !data.text.trim() || data.text.length > 2000)) fail("La nota debe tener entre 1 y 2000 caracteres");
  if (data.pinned !== undefined && typeof data.pinned !== "boolean") fail("Estado de nota inválido");
  if (!noteId) {
    const id = requestId(data.requestId); if (!data.text) fail("Escribe una nota");
    const filter = { trainerId, clientId, requestId: id };
    await recheckAccess(trainerId, clientId, stage._id);
    const note = await Note.findOneAndUpdate(filter, { $setOnInsert: { text: data.text.trim(), pinned: data.pinned === true, stageId: stage._id } }, { new: true, upsert: true, runValidators: true }).lean();
    if (String(note.stageId) !== String(stage._id) || note.text !== data.text.trim() || note.pinned !== (data.pinned === true)) fail("Identificador de envío reutilizado con otro contenido", 409, "IDEMPOTENCY_CONFLICT");
    return publicItem(note);
  }
  const filter = { _id: noteId, ...ownerFilter(trainerId, clientId, stage) };
  const current = await Note.findOne(filter).lean(); if (!current) fail("Nota no encontrada", 404);
  requireVersion(current.version || 0, data.expectedVersion);
  await recheckAccess(trainerId, clientId, stage._id);
  const updated = await Note.findOneAndUpdate({ $and: [filter, versionFilter(data.expectedVersion)] }, { $set: { ...(data.text !== undefined ? { text: data.text.trim() } : {}), ...(data.pinned !== undefined ? { pinned: data.pinned } : {}), updatedAt: new Date(), stageId: stage._id }, $inc: { version: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail("Otra edición cambió la nota", 409, "VERSION_CONFLICT");
  return publicItem(updated);
}
async function saveTask(trainerId, clientId, data, taskId) {
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  if (data.title !== undefined && (typeof data.title !== "string" || !data.title.trim() || data.title.length > 200)) fail("La tarea debe tener entre 1 y 200 caracteres");
  if (data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 1000)) fail("Texto de tarea inválido");
  if (data.dueDate !== undefined && data.dueDate !== null && !validDate(data.dueDate)) fail("Fecha de tarea inválida");
  if (data.status !== undefined && !["pending", "done"].includes(data.status)) fail("Estado de tarea inválido");
  if (!taskId) {
    const id = requestId(data.requestId); if (!data.title) fail("Escribe una tarea");
    await recheckAccess(trainerId, clientId, stage._id);
    const task = await Task.findOneAndUpdate({ trainerId, requestId: id }, { $setOnInsert: { clientId, stageId: stage._id, title: data.title.trim(), notes: data.notes || "", dueDate: data.dueDate || null } }, { new: true, upsert: true, runValidators: true }).lean();
    if (String(task.stageId) !== String(stage._id) || String(task.clientId) !== String(clientId) || task.title !== data.title.trim() || task.notes !== (data.notes || "") || task.dueDate !== (data.dueDate || null)) fail("Identificador de envío reutilizado con otro contenido", 409, "IDEMPOTENCY_CONFLICT");
    return publicItem(task);
  }
  const filter = { _id: taskId, ...ownerFilter(trainerId, clientId, stage) };
  const current = await Task.findOne(filter).lean(); if (!current) fail("Tarea no encontrada", 404);
  requireVersion(current.version || 0, data.expectedVersion);
  const patch = pick(data, ["title", "notes", "dueDate", "status"]);
  await recheckAccess(trainerId, clientId, stage._id);
  if (data.status) patch.completedAt = data.status === "done" ? new Date() : null;
  const updated = await Task.findOneAndUpdate({ $and: [filter, versionFilter(data.expectedVersion)] }, { $set: { ...patch, updatedAt: new Date(), stageId: stage._id }, $inc: { version: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) fail("Otra edición cambió la tarea", 409, "VERSION_CONFLICT");
  return publicItem(updated);
}
async function createReview(trainerId, clientId, data) {
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { write: true });
  const id = requestId(data.requestId);
  if (typeof data.conclusion !== "string" || !data.conclusion.trim() || data.conclusion.length > 4000 || (data.nextStep !== undefined && (typeof data.nextStep !== "string" || data.nextStep.length > 2000))) fail("Conclusión o siguiente paso inválido");
  if (typeof data.observedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.observedFingerprint)) fail("Recarga la ficha antes de registrar la revisión", 409, "OBSERVATIONS_MISSING");
  if (data.linkedTaskId && !await Task.exists({ _id: data.linkedTaskId, ...ownerFilter(trainerId, clientId, stage) })) fail("La tarea vinculada no pertenece a esta etapa", 400);
  if (data.correctsReviewId && !await OverviewReview.exists({ _id: data.correctsReviewId, trainerId, clientId, stageId: stage._id })) fail("La revisión a rectificar no pertenece a esta etapa", 400);
  const values = { conclusion: data.conclusion.trim(), nextStep: data.nextStep || "", observedFingerprint: data.observedFingerprint, observedAt: data.observedAt && !Number.isNaN(Date.parse(data.observedAt)) ? new Date(data.observedAt) : new Date(), linkedTaskId: data.linkedTaskId || null, correctsReviewId: data.correctsReviewId || null };
  await recheckAccess(trainerId, clientId, stage._id);
  const review = await OverviewReview.findOneAndUpdate({ trainerId, clientId, stageId: stage._id, requestId: id }, { $setOnInsert: values }, { new: true, upsert: true, runValidators: true }).lean();
  if (review.conclusion !== values.conclusion || review.nextStep !== values.nextStep || review.observedFingerprint !== values.observedFingerprint || String(review.linkedTaskId || "") !== String(values.linkedTaskId || "") || String(review.correctsReviewId || "") !== String(values.correctsReviewId || "")) fail("Identificador de envío reutilizado con otra revisión", 409, "IDEMPOTENCY_CONFLICT");
  return publicItem(review);
}
module.exports = { getOverview, intakeDetail, updateContext, updateSettings, updateShared, listNotes, listTasks, listReviews, saveNote, saveTask, createReview, observations, publicStage, taskOrder, versionFilter, latestWellbeing };
