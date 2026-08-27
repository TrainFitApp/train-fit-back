const { SORENESS_MUSCLES } = require("../workouts/soreness-catalog");

// Movimiento 6 Coach Pro — el método del entrenador, en números.
//
// Espejo EXACTO de packages/shared-core/src/app/core/constants/exercise-score.ts
// (frontend) — comprobado por exercise-score-catalog.test.js.
//
// QUÉ ES ESTO
// Cuánto estimula cada ejercicio a cada músculo (IEM) y cuánto castiga a
// cada articulación (IEA). Lo puntúa EL ENTRENADOR, no la app: dos
// profesionales con la misma sentadilla le dan valores distintos según su
// escuela, y una puntuación "oficial" sería inventarse un criterio que nadie
// le ha pedido a la aplicación.
//
// POR QUÉ NO VA EN Exercise
// El catálogo de ejercicios es COMPARTIDO por toda la plataforma. Poner ahí
// la puntuación haría que el criterio de un entrenador se le apareciera a
// todos los demás. Vive en una colección propia, indexada por
// (trainerId, exerciseId), que es exactamente lo que significa: la opinión
// de ESE profesional sobre ESE ejercicio.

// Los mismos 16 grupos que el registro de agujetas. Reutilizados a
// propósito: es el mismo mapa del cuerpo, y dos listas distintas harían
// imposible cruzar "qué le estimulo" con "qué le duele".
const SCORE_MUSCLES = SORENESS_MUSCLES;

// Articulaciones que un entrenador vigila al programar. Lista cerrada por el
// mismo motivo que las zonas de dolor: una serie temporal necesita que el
// eje no cambie.
const SCORE_JOINTS = [
  "Hombro",
  "Codo",
  "Muñeca",
  "Columna cervical",
  "Columna lumbar",
  "Cadera",
  "Rodilla",
  "Tobillo",
];

// Escala 0-3 y no 0-10: puntuar 200 ejercicios × 16 músculos es un trabajo
// enorme, y cuantos más niveles haya menos consistente será el criterio del
// propio entrenador entre el ejercicio nº 3 y el nº 180. Con cuatro niveles
// bien descritos la decisión es rápida y se mantiene.
const SCORE_MIN = 0;
const SCORE_MAX = 3;

const MUSCLE_SCORE_ANCHORS = [
  "No lo trabaja",
  "Lo trabaja de forma secundaria",
  "Lo trabaja de forma importante",
  "Es el objetivo principal del ejercicio",
];

const JOINT_SCORE_ANCHORS = [
  "No la compromete",
  "Carga baja, tolerable a diario",
  "Carga alta: hay que dosificarla",
  "Muy exigente: no encadenar sesiones",
];

const MUSCLE_SET = new Set(SCORE_MUSCLES);
const JOINT_SET = new Set(SCORE_JOINTS);

function isValidScore(value) {
  return Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

/**
 * Convierte a puntuación, o devuelve null.
 *
 * El descarte de "sin valor" va ANTES de convertir: Number(null) y
 * Number("") son 0, y 0 es una puntuación VÁLIDA aquí ("no lo trabaja"). Sin
 * esto, una puntuación que no llegó se guardaría como un 0 explícito — que
 * dice algo distinto de "no lo he puntuado". Mismo cuidado que en el
 * registro de dolor.
 */
function toScoreOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return isValidScore(score) ? score : null;
}

/**
 * Deja un mapa {nombre: puntuación} en la forma que guarda el esquema.
 *
 * Se descarta el 0: "no trabaja el gemelo" es el estado por defecto de casi
 * todos los ejercicios, y guardar dieciséis ceros por ejercicio multiplicaría
 * por cinco el tamaño de la colección para no decir nada. La ausencia ya
 * significa cero cuando se suma (ver buildSessionLoad).
 */
function sanitizeScores(entries, validNames) {
  const clean = [];
  const seen = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = entry?.name;
    if (!validNames.has(name) || seen.has(name)) continue;

    const score = toScoreOrNull(entry?.score);
    if (score === null || score === 0) continue;

    seen.add(name);
    clean.push({ name, score });
  }

  // En el orden del catálogo, no en el de llegada: el entrenador lee siempre
  // los grupos en el mismo sitio.
  const order = [...validNames];
  return clean.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

function sanitizeMuscleScores(entries) {
  return sanitizeScores(entries, MUSCLE_SET);
}

function sanitizeJointScores(entries) {
  return sanitizeScores(entries, JOINT_SET);
}

module.exports = {
  SCORE_MUSCLES,
  SCORE_JOINTS,
  SCORE_MIN,
  SCORE_MAX,
  MUSCLE_SCORE_ANCHORS,
  JOINT_SCORE_ANCHORS,
  isValidScore,
  toScoreOrNull,
  sanitizeMuscleScores,
  sanitizeJointScores,
};
