// Pasos + entrenamiento → factor de gasto energético.
//
// PORT de shared-ui/constants/steps.ts + training.ts (calculateTrainingValues).
// `User.steps` guarda el `.value` del rango elegido (1 = no cuenta pasos,
// 1.2 … 1.86) y `User.training` guarda el factor COMBINADO de esa tabla
// (pasos × entrenamiento), no los días de entrenamiento. Por eso para
// recalcular con otros pasos hay que recuperar primero los días por búsqueda
// inversa en la fila del rango actual (trainingDaysFromFactors) y luego leer
// la fila del rango nuevo (trainingFactor).
//
// PURO: entran números, salen números. Se replica aquí porque backend y
// front son paquetes distintos (mismo caso que nutrition-target.js).

// Orden = id del enum STEPS_TYPES del front. `upTo` es el tope de la media
// diaria real que cae en ese rango: los huecos de la tabla (1000–2000,
// 6000–7000, 9000–10000, 15000–16000, 18000–19000) se reparten por el punto
// medio.
const STEPS_RANGES = [
  { id: 0, key: "notCounted", value: 1, label: "No cuenta pasos", upTo: null },
  { id: 1, key: "lessThan1000", value: 1.2, label: "Menos de 1000 pasos", upTo: 1499 },
  { id: 2, key: "between2000And6000", value: 1.37, label: "2000–6000 pasos", upTo: 6499 },
  { id: 3, key: "between7000And9000", value: 1.46, label: "7000–9000 pasos", upTo: 9499 },
  { id: 4, key: "betweenThan10000And15000", value: 1.55, label: "10000–15000 pasos", upTo: 15499 },
  { id: 5, key: "betweenThan16000And18000", value: 1.71, label: "16000–18000 pasos", upTo: 18499 },
  { id: 6, key: "moreThan19000", value: 1.86, label: "Más de 19000 pasos", upTo: Infinity },
];

// Orden = id del enum TRAINING_TYPES del front (1..4).
const TRAINING_DAYS = [
  { id: 1, key: "none", label: "No entrena" },
  { id: 2, key: "oneOrTwo", label: "1–2 días/semana" },
  { id: 3, key: "threeOrFour", label: "3–4 días/semana" },
  { id: 4, key: "fiveOrSix", label: "5–6 días/semana" },
];

// Fila por `.value` del rango de pasos; columnas en el orden de TRAINING_DAYS.
const TRAINING_FACTORS = {
  1: [1, 1.02, 1.05, 1.07],
  1.2: [1.0862, 1.107, 1.14, 1.162],
  1.37: [1.24, 1.264, 1.301, 1.326],
  1.46: [1.321, 1.348, 1.387, 1.413],
  1.55: [1.402, 1.431, 1.472, 1.5],
  1.71: [1.547, 1.578, 1.625, 1.655],
  1.86: [1.683, 1.717, 1.767, 1.801],
};

const EPSILON = 1e-6;

// Number(null) es 0 y Number("") también: un dato ausente no es un número.
function toNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

function stepsRangeFromValue(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return null;
  return STEPS_RANGES.find((r) => Math.abs(r.value - n) < EPSILON) || null;
}

/** Rango por su clave ("between7000And9000"), como lo declara un check-in. */
function stepsRangeFromKey(key) {
  if (!key) return null;
  return STEPS_RANGES.find((r) => r.key === key) || null;
}

/** Rango de pasos en el que cae una media diaria real. null si no es un número ≥ 0. */
function stepsRangeFromAverage(avg) {
  const n = toNumber(avg);
  if (!Number.isFinite(n) || n < 0) return null;
  return STEPS_RANGES.find((r) => r.upTo !== null && n <= r.upTo) || null;
}

/**
 * Días de entrenamiento que, con el rango de pasos `stepsValue`, dan el factor
 * combinado `trainingValue`. `exact: false` = no casa ninguna columna al
 * milímetro (dato viejo o rango cambiado a mano): se toma la más cercana.
 * null si el rango no existe o el factor no es un número.
 */
function trainingDaysFromFactors(stepsValue, trainingValue) {
  const row = TRAINING_FACTORS[toNumber(stepsValue)];
  const t = toNumber(trainingValue);
  if (!row || !Number.isFinite(t)) return null;
  let best = 0;
  for (let i = 1; i < row.length; i++) {
    if (Math.abs(row[i] - t) < Math.abs(row[best] - t)) best = i;
  }
  return { ...TRAINING_DAYS[best], exact: Math.abs(row[best] - t) < EPSILON };
}

/** Factor combinado para un rango de pasos y unos días de entrenamiento. */
function trainingFactor(stepsValue, trainingDaysId) {
  const row = TRAINING_FACTORS[toNumber(stepsValue)];
  const column = TRAINING_DAYS.findIndex((d) => d.id === toNumber(trainingDaysId));
  if (!row || column < 0) return null;
  return row[column];
}

module.exports = {
  STEPS_RANGES,
  TRAINING_DAYS,
  TRAINING_FACTORS,
  stepsRangeFromValue,
  stepsRangeFromKey,
  stepsRangeFromAverage,
  trainingDaysFromFactors,
  trainingFactor,
};
