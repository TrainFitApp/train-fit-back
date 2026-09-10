const { CoachingStage } = require("./overview-schema");
const { resolveStage, recheckAccess } = require("./stage-service");
const { MEASUREMENT_CATALOG, CONTEXT_FIELDS, NUTRITION_FIELDS, fail, fingerprint, pick, normalizeMeasurements, normalizeContext, requestId } = require("./overview-domain");
const Intake = require("../clientIntake/client-intake-schema");
const Config = require("../trainerIntakeConfig/trainer-intake-config-service");
const Preferences = require("../nutritionPreferences/nutrition-preferences-schema");
const Anthropometry = require("../anthropometry/anthropometry-dao");
const { civilToday } = require("./body-metrics");
const { getTimeZone, setTimeZone } = require("./measurement-profile");
const { upsertMeasurement } = require("./measurement-write");

const LABELS = { goals: "Objetivo personal", healthConditions: "Salud y limitaciones declaradas", experienceLevel: "Experiencia", availability: "Disponibilidad", equipment: "Lugar y equipamiento", allergies: "Alergias", favoriteFoods: "Alimentos favoritos", dislikedFoods: "Alimentos que evita", cooksAtHome: "Cocina en casa" };
async function configFor(trainerId) { return Config.getMyConfig(trainerId); }
function missingFields(stage) { return (stage.measurementFields || []).filter((key) => !(stage.baselines || []).some((b) => b.key === key)); }
async function writeMeasurements({ trainerId, clientId, stageId, measurements, id, actorId, source, today }) {
  const normalized = normalizeMeasurements(measurements, today);
  const baselines = [];
  for (const m of normalized) {
    const currentStage = await resolveStage(trainerId, clientId, stageId, { onboarding: source !== "professional", write: true });
    await recheckAccess(trainerId, clientId, currentStage.stage._id, source !== "professional");
    let record;
    if (m.confirmedExisting) {
      record = await Anthropometry.getAnthropometryByUserIdAndDate(clientId, m.date);
      if (!record || record[m.field] !== m.value) {
        const error = new Error("La medición que ibas a reutilizar ha cambiado. Revísala antes de confirmar.");
        Object.assign(error, { status: 409, code: "MEASUREMENT_CONFLICT", currentValues: { [m.field]: record?.[m.field] ?? null } }); throw error;
      }
    } else {
      record = await upsertMeasurement({ clientId, trainerId: source === "professional" ? trainerId : undefined, date: m.date,
        fields: { [m.field]: m.value }, ...(m.expectedValue !== undefined ? { expectedValues: { [m.field]: m.expectedValue } } : {}),
        requestId: `${id}:${m.field}`, source });
    }
    baselines.push({ key: m.field, value: m.value, date: m.date, sourceId: String(record._id), source: m.confirmedExisting ? "existing" : source, recordedAt: new Date(), recordedBy: actorId });
  }
  return baselines;
}
async function prepareIntake(trainerId, clientId, data) {
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { onboarding: true, write: true });
  const config = await configFor(trainerId);
  const modern = Array.isArray(data.measurements);
  if (modern && data.intakeConfigVersion && data.intakeConfigVersion !== config.version && (!stage.submission || stage.submission.status === "failed")) fail("El cuestionario ha cambiado. Actualiza las preguntas conservando tu borrador.", 409, "INTAKE_CONFIG_CHANGED");
  const id = modern ? requestId(data.requestId) : `legacy:${stage._id}`;
  const digest = fingerprint(data);
  if (stage.submission && stage.submission.status !== "failed") {
    if (stage.submission.requestId !== id || stage.submission.hash !== digest) fail("Ya se recibió un cuestionario para esta etapa. Recupera su estado antes de volver a enviarlo.", 409, "INTAKE_ALREADY_SUBMITTED");
    if (stage.submission.status === "complete") return { stage, alreadyComplete: true };
  }
  let timeZone = await getTimeZone(clientId);
  if (data.timeZone) timeZone = await setTimeZone(clientId, data.timeZone, clientId, "client");
  const measurements = normalizeMeasurements(data.measurements || [], civilToday(timeZone));
  if (measurements.some((m) => !config.measurementFields.includes(m.field))) fail("Una de las medidas no forma parte del cuestionario solicitado");
  const missing = config.measurementFields.filter((key) => !measurements.some((m) => m.field === key));
  if (modern && missing.length && data.missingMeasurementsAcknowledged !== true) { const error = new Error("Confirma el envío con medidas iniciales pendientes"); Object.assign(error, { status: 422, code: "MISSING_MEASUREMENTS", missingFields: missing }); throw error; }
  const answers = normalizeContext(pick(data, CONTEXT_FIELDS.filter((f) => f !== "equipment")));
  answers.customAnswers = (answers.customAnswers || []).map((answer) => {
    const question = config.customQuestions.find((q) => q.id === answer.questionId && q.enabled);
    if (!question) fail("El cuestionario ha cambiado. Recupera las preguntas vigentes.", 409, "INTAKE_CONFIG_CHANGED");
    return { questionId: answer.questionId, label: question.label, value: answer.value };
  });
  const nutrition = pick(data, NUTRITION_FIELDS);
  for (const [key, value] of Object.entries(nutrition)) {
    if (key === "cooksAtHome" ? ![null, "yes", "no", "sometimes"].includes(value) : typeof value !== "string" || value.length > 1000) fail("Preferencia nutricional inválida");
  }
  const snapshot = { legacy: !modern, submittedAt: new Date(), configVersion: config.version,
    questions: [...config.enabledFields.map((key) => ({ key, label: LABELS[key] || key })), ...config.customQuestions.filter((q) => q.enabled).map((q) => ({ key: q.id, label: q.label, custom: true })), ...MEASUREMENT_CATALOG.filter((m) => config.measurementFields.includes(m.key))],
    answers, nutrition, measurements, requestedMeasurements: config.measurementFields, missingFields: missing,
    missingMeasurementsAcknowledged: data.missingMeasurementsAcknowledged === true, timeZone };
  let prepared = stage;
  if (!stage.submission || stage.submission.status === "failed") {
    prepared = await CoachingStage.findOneAndUpdate({ _id: stage._id, version: stage.version, ...(stage.submission ? { "submission.status": "failed" } : { submission: null }) }, {
      $set: { submission: { requestId: id, hash: digest, status: "prepared", snapshot }, measurementFields: config.measurementFields },
      $inc: { version: 1 },
    }, { new: true }).lean();
    if (!prepared) return prepareIntake(trainerId, clientId, data);
  }
  return { stage: prepared, alreadyComplete: false, id, snapshot: prepared.submission.snapshot, timeZone };
}
async function persistPreparedIntake(trainerId, clientId, prepared) {
  if (prepared.alreadyComplete) return Intake.findOne({ trainerId, clientId }).lean();
  const { stage, id, snapshot, timeZone } = prepared;
  await resolveStage(trainerId, clientId, stage._id, { onboarding: true, write: true });
  try {
  const baselines = await writeMeasurements({ trainerId, clientId, stageId: stage._id, measurements: snapshot.measurements, id, actorId: clientId, source: "intake", today: civilToday(timeZone) });
  await resolveStage(trainerId, clientId, stage._id, { onboarding: true, write: true });
  const intake = await Intake.findOneAndUpdate({ trainerId, clientId }, { $set: { ...snapshot.answers, submittedAt: snapshot.submittedAt } }, { new: true, upsert: true, runValidators: true }).lean();
  // Guardado parcial: no vacía preferencias o etiquetas de comidas omitidas.
  if (Object.keys(snapshot.nutrition).length) await Preferences.findOneAndUpdate({ clientId }, { $set: { ...snapshot.nutrition, respondedAt: snapshot.submittedAt, updatedAt: new Date() } }, { upsert: true, runValidators: true });
  await CoachingStage.updateOne({ _id: stage._id, "submission.requestId": id, "submission.status": "prepared" }, {
    $set: { intakeSnapshot: snapshot, currentContext: snapshot.answers, baselines, legacy: false, "submission.status": "complete", updatedBy: clientId }, $inc: { version: 1 },
  });
  return intake;
  } catch (error) {
    await CoachingStage.updateOne({ _id: stage._id, "submission.requestId": id, "submission.status": "prepared" }, { $set: { "submission.status": "failed" }, $inc: { version: 1 } });
    throw error;
  }
}
async function initialMeasurements(trainerId, clientId) {
  const { stage } = await resolveStage(trainerId, clientId, null, { onboarding: true });
  const config = await configFor(trainerId);
  const requestedFields = stage.intakeSnapshot ? stage.measurementFields : config.measurementFields;
  const entries = await Anthropometry.getAllAnthropometriesByUserId(clientId);
  const recent = requestedFields.map((field) => {
    const entry = entries.find((e) => typeof e[field] === "number" && Number.isFinite(e[field]) && e[field] > 0);
    return entry ? { field, value: entry[field], date: entry.date } : null;
  }).filter(Boolean);
  return { stageId: String(stage._id), version: stage.version, configVersion: config.version, requestedFields, catalog: MEASUREMENT_CATALOG.filter((m) => requestedFields.includes(m.key)), missingFields: requestedFields.filter((key) => !stage.baselines.some((b) => b.key === key)), baselines: stage.baselines, recent, timeZone: await getTimeZone(clientId), submitted: Boolean(stage.intakeSnapshot) };
}
async function completeBaselines(trainerId, clientId, data, { professional = false } = {}) {
  const id = requestId(data.requestId);
  const { stage } = await resolveStage(trainerId, clientId, data.stageId, { onboarding: !professional, write: true });
  const payloadHash = fingerprint(data);
  if (stage.completedRequests.includes(id)) {
    const previous = stage.changes.find((change) => change.requestId === id);
    if (previous?.payloadHash && previous.payloadHash !== payloadHash) fail("Este envío ya se utilizó con otras referencias", 409, "IDEMPOTENCY_CONFLICT");
    return initialMeasurements(trainerId, clientId);
  }
  if (!professional && !stage.intakeSnapshot) fail("Envía primero tu cuestionario inicial");
  if (professional && data.expectedVersion !== stage.version) fail("La ficha cambió. Conserva el borrador y actualiza antes de guardar.", 409, "VERSION_CONFLICT");
  let timeZone = await getTimeZone(clientId);
  if (data.timeZone && !professional) timeZone = await setTimeZone(clientId, data.timeZone, clientId, "client");
  const values = normalizeMeasurements(data.measurements, civilToday(timeZone));
  if (!values.length) fail("Añade al menos una medida inicial");
  if (!professional && values.some((m) => !stage.measurementFields.includes(m.field) || stage.baselines.some((b) => b.key === m.field))) fail("Solo puedes completar las medidas iniciales que están pendientes", 409, "BASELINE_ALREADY_SET");
  const incoming = await writeMeasurements({ trainerId, clientId, stageId: stage._id, measurements: values, id, actorId: professional ? trainerId : clientId, source: professional ? "professional" : "completion", today: civilToday(timeZone) });
  await resolveStage(trainerId, clientId, stage._id, { onboarding: !professional, write: true });
  const baselines = [...stage.baselines.filter((b) => !incoming.some((i) => i.key === b.key)), ...incoming];
  const updated = await CoachingStage.findOneAndUpdate({ _id: stage._id, version: stage.version }, {
    $set: { baselines, updatedBy: professional ? trainerId : clientId }, $inc: { version: 1 }, $addToSet: { completedRequests: id },
    $push: { changes: { kind: "baselines", requestId: id, payloadHash, before: stage.baselines, after: incoming, actorId: professional ? trainerId : clientId, at: new Date() } },
  }, { new: true }).lean();
  if (!updated) fail("La referencia inicial ha cambiado; tus mediciones quedaron guardadas en el historial. Revisa antes de confirmar la referencia.", 409, "VERSION_CONFLICT");
  return initialMeasurements(trainerId, clientId);
}
module.exports = { configFor, missingFields, prepareIntake, persistPreparedIntake, initialMeasurements, completeBaselines, writeMeasurements };
