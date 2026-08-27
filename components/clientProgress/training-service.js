const { buildWeekWindows, isoDate } = require("./progress-service");

// Fase 6 Coach Pro — volumen, PRs y evolución de cargas (§17).
//
// Puro: entra la lista de series completadas (tableDao.listCompletedSetsForUser)
// y salen los agregados. Sin BD, sin await.
//
// Todo lo de aquí se calcula sobre series REALMENTE hechas (`doned`), nunca
// sobre lo planificado: "ha levantado 12.000 kg esta semana" tiene que ser un
// hecho, no una intención.

// Cuántos ejercicios se siguen en la evolución de cargas. Un cliente toca 30
// ejercicios distintos en un trimestre y una tabla de 30 filas no se lee: se
// muestran los que más ha entrenado, que son los que sostienen su progreso.
const TOP_EXERCISES = 5;

// Series por debajo de este peso no cuentan para PR ni para volumen de
// fuerza: son ejercicios de peso corporal o de movilidad registrados sin
// carga, y colarlos daría "PR: 0 kg" y volúmenes de 0.
const MIN_TRACKED_WEIGHT = 0.5;

function volumeOf(set) {
  const reps = Number(set.reps) || 0;
  const weight = Number(set.weight) || 0;
  return reps * weight;
}

/**
 * Volumen (kg levantados) y nº de series por semana.
 *
 * El volumen es reps × peso sumado: la definición estándar de volumen de
 * carga, y la única que se puede calcular con lo que el modelo guarda.
 */
function buildWeeklyTraining(sets, weeks, now) {
  return buildWeekWindows(weeks, now).map((window) => {
    const inWeek = (sets || []).filter((set) => {
      const day = isoDate(set.date);
      return day >= window.start && day <= window.end;
    });

    const volume = inWeek.reduce((acc, set) => acc + volumeOf(set), 0);
    const sessions = new Set(inWeek.map((set) => isoDate(set.date))).size;

    return {
      start: window.start,
      end: window.end,
      // null y no 0 cuando no entrenó nada: 0 kg de volumen en una semana
      // sin sesiones se pintaría como "entrenó y no levantó nada".
      volume: inWeek.length ? Math.round(volume) : null,
      sets: inWeek.length,
      sessions,
    };
  });
}

/**
 * Récord por ejercicio: la serie de más peso, y con más repeticiones a
 * igualdad de peso.
 *
 * Se compara por PESO primero y no por volumen de la serie porque es como
 * un entrenador lee un récord ("ha subido a 100 kg"), y porque 10×60 no es
 * un récord frente a 3×100 aunque su producto sea mayor.
 */
function buildPersonalRecords(sets) {
  const byExercise = new Map();

  for (const set of sets || []) {
    const name = set.exerciseName;
    const weight = Number(set.weight) || 0;
    const reps = Number(set.reps) || 0;
    if (!name || weight < MIN_TRACKED_WEIGHT || !reps) continue;

    const current = byExercise.get(name);
    const isBetter =
      !current || weight > current.weight || (weight === current.weight && reps > current.reps);

    if (isBetter) {
      byExercise.set(name, { exerciseName: name, weight, reps, date: set.date });
    }
  }

  return [...byExercise.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Evolución de cargas de los ejercicios más entrenados: peso máximo por
 * semana, para ver si las cargas suben o se han quedado planas.
 */
function buildLoadEvolution(sets, weeks, now) {
  const countByExercise = new Map();
  for (const set of sets || []) {
    if (!set.exerciseName || (Number(set.weight) || 0) < MIN_TRACKED_WEIGHT) continue;
    countByExercise.set(set.exerciseName, (countByExercise.get(set.exerciseName) || 0) + 1);
  }

  const topExercises = [...countByExercise.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_EXERCISES)
    .map(([name]) => name);

  const windows = buildWeekWindows(weeks, now);

  return topExercises.map((exerciseName) => ({
    exerciseName,
    weeks: windows.map((window) => {
      const inWeek = (sets || []).filter((set) => {
        if (set.exerciseName !== exerciseName) return false;
        const day = isoDate(set.date);
        return day >= window.start && day <= window.end;
      });
      return {
        start: window.start,
        maxWeight: inWeek.length ? Math.max(...inWeek.map((s) => Number(s.weight) || 0)) : null,
      };
    }),
  }));
}

/**
 * Comparativa de volumen: última semana contra la anterior. Solo cuando hay
 * dato en las dos — comparar contra una semana sin entrenar diría "ha
 * subido un infinito por ciento".
 */
function buildVolumeComparison(weeklyTraining) {
  if (weeklyTraining.length < 2) return null;
  const current = weeklyTraining[weeklyTraining.length - 1];
  const previous = weeklyTraining[weeklyTraining.length - 2];
  if (current.volume === null || previous.volume === null || !previous.volume) return null;

  const absolute = current.volume - previous.volume;
  return {
    current: current.volume,
    previous: previous.volume,
    absolute,
    percentage: Math.round((absolute / previous.volume) * 1000) / 10,
  };
}

/**
 * Movimiento 3 Coach Pro — el mismo trabajo agrupado por MICROCICLO en vez
 * de por semana.
 *
 * Por qué hace falta además de la semanal: un microciclo no dura siete días
 * (el modelo deja que dure lo que el entrenador decida, ver el glosario), así
 * que las semanas naturales lo parten por la mitad. Comparar la semana 3
 * contra la 2 puede estar comparando el final de un bloque contra el
 * principio del siguiente — dos cosas que no se parecen en nada. El bloque es
 * la unidad en la que el entrenador PIENSA, y por tanto en la que decide.
 *
 * Los bloques salen ordenados por su primera sesión: el orden dentro de
 * Table.splits es el de planificación, y un microciclo insertado a posteriori
 * aparecería fuera de sitio en la comparación.
 */
function buildBlockTraining(sets) {
  const blocks = new Map();

  for (const set of sets || []) {
    // Una serie sin microciclo no puede compararse contra nada; es un dato
    // viejo de antes de que la agregación proyectara el split.
    if (!set.splitId) continue;

    const key = String(set.splitId);
    if (!blocks.has(key)) {
      blocks.set(key, {
        splitId: key,
        name: set.splitName || "Microciclo",
        start: null,
        end: null,
        volume: 0,
        sets: 0,
        sessionDates: new Set(),
      });
    }

    const block = blocks.get(key);
    const day = isoDate(set.date);
    if (!block.start || day < block.start) block.start = day;
    if (!block.end || day > block.end) block.end = day;
    block.volume += volumeOf(set);
    block.sets += 1;
    block.sessionDates.add(day);
  }

  return [...blocks.values()]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((block) => ({
      splitId: block.splitId,
      name: block.name,
      start: block.start,
      end: block.end,
      volume: Math.round(block.volume),
      sets: block.sets,
      sessions: block.sessionDates.size,
      // Volumen POR SESIÓN además del total: dos bloques de distinta
      // duración no se comparan por el total (el más largo gana siempre por
      // ser más largo, no por trabajar más).
      volumePerSession: block.sessionDates.size
        ? Math.round(block.volume / block.sessionDates.size)
        : null,
    }));
}

/**
 * Último bloque contra el anterior. Mismo criterio que la comparativa
 * semanal: solo cuando hay dato en los dos, porque comparar contra un bloque
 * sin volumen diría "ha subido un infinito por ciento".
 *
 * Compara el volumen POR SESIÓN, no el total: es lo que responde "¿está
 * trabajando más?" cuando los dos bloques no tienen las mismas sesiones.
 */
function buildBlockComparison(blockTraining) {
  if (blockTraining.length < 2) return null;
  const current = blockTraining[blockTraining.length - 1];
  const previous = blockTraining[blockTraining.length - 2];
  if (!current.volumePerSession || !previous.volumePerSession) return null;

  const absolute = current.volumePerSession - previous.volumePerSession;
  return {
    current: { name: current.name, start: current.start, end: current.end, volumePerSession: current.volumePerSession, sessions: current.sessions },
    previous: { name: previous.name, start: previous.start, end: previous.end, volumePerSession: previous.volumePerSession, sessions: previous.sessions },
    absolute,
    percentage: Math.round((absolute / previous.volumePerSession) * 1000) / 10,
  };
}

module.exports = {
  TOP_EXERCISES,
  MIN_TRACKED_WEIGHT,
  buildWeeklyTraining,
  buildPersonalRecords,
  buildLoadEvolution,
  buildVolumeComparison,
  buildBlockTraining,
  buildBlockComparison,
};
