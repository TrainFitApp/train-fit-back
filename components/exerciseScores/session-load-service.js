const { SCORE_MUSCLES, SCORE_JOINTS } = require("./exercise-score-catalog");

/**
 * Movimiento 6 Coach Pro — qué carga tiene la sesión que el entrenador está
 * montando, mientras la monta.
 *
 * PURO: entran los ejercicios de un workout y las puntuaciones del
 * entrenador, y sale el reparto por músculo y por articulación. Sin BD, sin
 * await — se recalcula en cada cambio del planificador, así que no puede
 * costar una petición.
 *
 * La carga de un músculo se cuenta como PUNTUACIÓN × SERIES, no como
 * puntuación a secas: cuatro series de press banca cargan el pectoral el
 * doble que dos, y sumar solo el 3 del ejercicio diría que da igual. Es la
 * misma idea que "series efectivas por grupo", que es como cuenta el volumen
 * un entrenador.
 */

// Segundos por serie cuando el entrenador no lo ha puntuado. 40 s cubre una
// serie normal de 8-12 repeticiones con su entrada y salida de la máquina;
// no pretende ser exacto, pretende que el total no sea absurdo.
const DEFAULT_SECONDS_PER_SET = 40;

// Descanso por defecto cuando la serie no lo lleva escrito. 90 s es lo más
// habitual en trabajo de hipertrofia — el mismo criterio que el valor de
// arriba: mejor una estimación razonable que ninguna.
const DEFAULT_REST_SECONDS = 90;

function countSets(customExercise) {
  // Las series de descanso-pausa y las drop no son series aparte a efectos
  // de carga: van dentro de la serie que las contiene.
  return (customExercise?.sets || []).length;
}

/**
 * Reparto de la sesión por músculo y por articulación.
 *
 * @param customExercises ejercicios del workout, ya poblados.
 * @param scoresByExerciseId Map de exerciseId -> ExerciseScore del entrenador.
 */
function buildSessionLoad(customExercises, scoresByExerciseId) {
  const muscleTotals = new Map();
  const jointTotals = new Map();

  // Ejercicios que el entrenador todavía no ha puntuado. Se cuentan y se
  // dicen: un reparto que ignora en silencio la mitad de la sesión es peor
  // que no dar ninguno, porque parece completo.
  let unscored = 0;
  let totalExercises = 0;

  for (const customExercise of customExercises || []) {
    const exerciseId = customExercise?.exercise?._id || customExercise?.exercise;
    if (!exerciseId) continue;

    totalExercises += 1;
    const score = scoresByExerciseId.get(String(exerciseId));
    if (!score) {
      unscored += 1;
      continue;
    }

    const sets = countSets(customExercise);
    if (!sets) continue;

    for (const entry of score.muscleScores || []) {
      muscleTotals.set(entry.name, (muscleTotals.get(entry.name) || 0) + entry.score * sets);
    }
    for (const entry of score.jointScores || []) {
      jointTotals.set(entry.name, (jointTotals.get(entry.name) || 0) + entry.score * sets);
    }
  }

  return {
    // Ordenados de más a menos carga: lo que domina la sesión encabeza la
    // lista, que es lo que el entrenador quiere ver sin leerla entera.
    muscles: toSortedList(muscleTotals, SCORE_MUSCLES),
    joints: toSortedList(jointTotals, SCORE_JOINTS),
    unscoredExercises: unscored,
    totalExercises,
  };
}

function toSortedList(totals, catalogOrder) {
  return [...totals.entries()]
    .map(([name, load]) => ({ name, load }))
    .sort(
      (a, b) => b.load - a.load || catalogOrder.indexOf(a.name) - catalogOrder.indexOf(b.name)
    );
}

/**
 * Cuánto va a durar la sesión, en segundos.
 *
 * Suma, por serie: el tiempo de ejecución (el que el entrenador haya
 * puntuado para ese ejercicio, o el valor por defecto) más su descanso. El
 * descanso de la ÚLTIMA serie del último ejercicio no cuenta: nadie descansa
 * después de terminar de entrenar.
 *
 * Es una ESTIMACIÓN y se llama así en la interfaz. Sirve para ver que una
 * sesión de 25 series no cabe en la hora que tiene el cliente, no para
 * cronometrar nada.
 */
function estimateSessionSeconds(customExercises, scoresByExerciseId) {
  let seconds = 0;
  let lastRest = 0;
  let anySet = false;

  for (const customExercise of customExercises || []) {
    const exerciseId = customExercise?.exercise?._id || customExercise?.exercise;
    const score = exerciseId ? scoresByExerciseId.get(String(exerciseId)) : null;
    const perSet = score?.secondsPerSet ?? DEFAULT_SECONDS_PER_SET;

    for (const set of customExercise?.sets || []) {
      anySet = true;
      const rest = Number.isFinite(Number(set?.restSeconds))
        ? Number(set.restSeconds)
        : DEFAULT_REST_SECONDS;
      seconds += perSet + rest;
      lastRest = rest;
    }
  }

  if (!anySet) return 0;
  return Math.max(0, seconds - lastRest);
}

module.exports = {
  DEFAULT_SECONDS_PER_SET,
  DEFAULT_REST_SECONDS,
  buildSessionLoad,
  estimateSessionSeconds,
};
