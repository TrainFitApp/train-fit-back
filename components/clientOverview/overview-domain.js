const crypto = require("node:crypto");
const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

const MEASUREMENT_CATALOG = CHECKIN_FIELDS.filter((f) => f.key === "weight" || f.group === "perimetros")
  .map((f) => ({ key: f.anthropometryField, label: f.label, unit: f.unit, min: f.min, max: f.max, hint: f.hint }));
const CONTEXT_FIELDS = ["goals", "healthConditions", "experienceLevel", "availability", "equipment", "trainingLocation", "equipmentTags", "customAnswers"];
const PROFILE_FIELDS = ["name", "lastname", "birth", "sex", "height", "activity"];
// Mismos valores que ClientNutritionPreferences.dietaryFlags — filtro duro
// del cajon de sugerencias de dieta.
const DIETARY_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];
const NUTRITION_FIELDS = ["allergies", "favoriteFoods", "dislikedFoods", "cooksAtHome", "dietaryFlags"];
const LIVE_STATUSES = ["active", "en_revision", "cuestionario_pendiente"];
function fail(message, status = 400, code = "INVALID_OVERVIEW") { const e = new Error(message); e.status = status; e.code = code; throw e; }
function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function pick(value, fields) { return Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])); }
function validDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function requestId(value) { if (typeof value !== "string" || !/^[\w:\-]{8,95}$/.test(value)) fail("Falta un identificador de envío válido"); return value; }
function validateMeasurementFields(fields) {
  if (!Array.isArray(fields) || fields.some((key) => !MEASUREMENT_CATALOG.some((f) => f.key === key))) fail("Medida inicial no reconocida", 400, "INVALID_MEASUREMENT_FIELDS");
  return [...new Set(fields)];
}
function normalizeMeasurements(measurements, today) {
  if (!Array.isArray(measurements) || measurements.length > MEASUREMENT_CATALOG.length) fail("Medidas iniciales inválidas");
  const seen = new Set();
  return measurements.map((m) => {
    const definition = MEASUREMENT_CATALOG.find((f) => f.key === m?.field);
    if (!definition || seen.has(m.field)) fail("Medida inicial desconocida o duplicada");
    seen.add(m.field);
    if (typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < definition.min || m.value > definition.max) fail(`${definition.label}: valor fuera del intervalo admitido`);
    if (!validDate(m.date) || m.date > today) fail(`${definition.label}: fecha de medición inválida`);
    if (m.expectedValue !== undefined && m.expectedValue !== null && !Number.isFinite(m.expectedValue)) fail("Valor previo inválido");
    return { field: m.field, value: m.value, date: m.date, confirmedExisting: m.confirmedExisting === true, ...(m.expectedValue !== undefined ? { expectedValue: m.expectedValue } : {}) };
  });
}
function normalizeContext(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((key) => !CONTEXT_FIELDS.includes(key))) fail("Campo de contexto no permitido");
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (["experienceLevel", "trainingLocation"].includes(key)) {
      const allowed = key === "experienceLevel" ? [null, "none", "beginner", "intermediate", "advanced"] : [null, "gym", "home", "outdoor", "mixed"];
      if (!allowed.includes(value)) fail("Opción de contexto inválida");
    } else if (key === "equipmentTags") {
      const allowed = ["dumbbells", "barbell", "machines", "bands", "kettlebells", "bench", "pullup_bar", "none"];
      if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) fail("Equipamiento inválido");
    } else if (key === "customAnswers") {
      if (!Array.isArray(value) || value.length > 20 || value.some((v) => !v || typeof v.questionId !== "string" || typeof v.label !== "string" || v.label.length > 200 || typeof v.value !== "string" || v.value.length > 1000)) fail("Respuestas personalizadas inválidas");
    } else if (typeof value !== "string" || value.length > (["availability", "equipment"].includes(key) ? 500 : 1000)) fail("Texto de contexto demasiado largo o inválido");
    result[key] = typeof value === "string" ? value.trim() : value;
  }
  return result;
}
// Las etapas unen intervalos de relación solapados, no cada revocación de ámbito.
function groupRelations(relations) {
  const sorted = relations.filter((r) => r.clientId && r.status !== "declined" && r.status !== "pending")
    .map((r) => ({ ...r, start: new Date(r.respondedAt || r.invitedAt), end: LIVE_STATUSES.includes(r.status) ? Infinity : (r.revokedAt ? new Date(r.revokedAt).getTime() : new Date(r.respondedAt || r.invitedAt).getTime()) }))
    .sort((a, b) => a.start - b.start || String(a._id).localeCompare(String(b._id)));
  const groups = [];
  for (const r of sorted) {
    let group = groups[groups.length - 1];
    if (!group || r.start.getTime() > group.end) { group = { key: String(r._id), relations: [], start: r.start, end: r.end, estimated: !r.respondedAt || (!LIVE_STATUSES.includes(r.status) && !r.revokedAt) }; groups.push(group); }
    group.relations.push(r); group.end = Math.max(group.end, r.end);
  }
  return groups;
}
module.exports = { MEASUREMENT_CATALOG, CONTEXT_FIELDS, PROFILE_FIELDS, NUTRITION_FIELDS, DIETARY_FLAGS, LIVE_STATUSES, fail, fingerprint, pick, validDate, requestId, validateMeasurementFields, normalizeMeasurements, normalizeContext, groupRelations };
