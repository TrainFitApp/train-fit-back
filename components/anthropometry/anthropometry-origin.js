// De quién es cada medida de un día. Un documento de Anthropometry junta lo
// que apunta el cliente (peso diario, modal de medidas) y lo que responde en
// los check-ins que le pide su entrenador. El entrenador lo ve todo; el
// cliente, en weight-info y demás pantallas suyas, solo lo que apuntó él:
//   · Solo existen para él las CLIENT_FIELDS. El resto del catálogo (masas,
//     hombros, izq./der., tobillos…) es exclusivo de los check-ins.
//   · `checkinFields` lista los campos de ese día que vienen de un check-in
//     aunque sean de los suyos (peso, cintura…).
//
// PURO: entran documentos y cuerpos de petición, salen objetos. Sin Mongo.

// Todas las medidas del schema, deprecadas incluidas (se siguen leyendo).
const MEASUREMENT_FIELDS = [
  "weight",
  "muscleMass",
  "fatMass",
  "boneMass",
  "residualMass",
  "neck",
  "shoulders",
  "chest",
  "waist",
  "abdomen",
  "hip",
  "bicepsRelaxed",
  "bicepsContracted",
  "bicepsRelaxedL",
  "bicepsRelaxedR",
  "bicepsContractedL",
  "bicepsContractedR",
  "quadL",
  "quadR",
  "thighRelaxed",
  "thighContracted",
  "calf",
  "calfL",
  "calfR",
  "ankleL",
  "ankleR",
];

// Lo que el cliente apunta por su cuenta (modal de medidas y peso diario).
const CLIENT_FIELDS = [
  "weight",
  "neck",
  "chest",
  "waist",
  "abdomen",
  "hip",
  "bicepsRelaxed",
  "bicepsContracted",
  "thighRelaxed",
  "thighContracted",
  "calf",
];

/** Lo que el cliente puede escribir: solo sus medidas numéricas presentes. */
function pickMeasurements(body) {
  const fields = {};
  for (const key of CLIENT_FIELDS) {
    const raw = body?.[key];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
  }
  return fields;
}

/**
 * El documento tal y como lo ve el cliente: sin lo que vino de check-ins.
 * null si no le queda ninguna medida suya ese día.
 */
function ownView(doc) {
  if (!doc) return null;
  const { checkinFields, ...rest } = doc;
  const fromCheckin = new Set(checkinFields || []);
  for (const key of MEASUREMENT_FIELDS) {
    if (!CLIENT_FIELDS.includes(key) || fromCheckin.has(key)) delete rest[key];
  }
  return CLIENT_FIELDS.some((key) => rest[key] != null) ? rest : null;
}

function ownViews(docs) {
  return (docs || []).map(ownView).filter(Boolean);
}

/**
 * Qué campos de un check-in se escriben en el día: nunca se pisa lo que el
 * cliente ya apuntó él mismo ese día (seguiría viéndolo cambiado sin saber
 * por qué). La respuesta del check-in guarda su valor igualmente.
 */
function checkinWritableFields(existing, fields) {
  const fromCheckin = new Set(existing?.checkinFields || []);
  const writable = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (existing?.[key] != null && !fromCheckin.has(key)) continue;
    writable[key] = value;
  }
  return writable;
}

module.exports = { MEASUREMENT_FIELDS, CLIENT_FIELDS, pickMeasurements, ownView, ownViews, checkinWritableFields };
