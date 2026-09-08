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
    block.sessionDates.add(set.workoutId ? String(set.workoutId) : day);
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

/**
 * 2026-09 — readiness pre-entreno y esfuerzo post-entreno (1-5), promediados
 * por microciclo, para comparar bloque contra bloque igual que el resto de
 * métricas de este archivo. Ambos son un pulso OPCIONAL de la sesión (el
 * cliente puede saltárselo): una sesión sin ninguno de los dos no cuenta ni
 * suma ni resta al promedio, no se trata como 0.
 *
 * Igual que buildBlockTraining, entra `sets` (con readinessPre/
 * perceivedEffortPost proyectados por sesión en tableDao
 * .listCompletedSetsForUser) — el valor se repite en cada set de la misma
 * sesión a propósito, así que hay que deduplicar por fecha ANTES de
 * promediar, o una sesión con 40 series pesaría 40 veces más que una de 4.
 */
function buildBlockReadiness(sets) {
  const blocks = new Map();

  for (const set of sets || []) {
    if (!set.splitId) continue;
    if (set.readinessPre == null && set.perceivedEffortPost == null) continue;

    const key = String(set.splitId);
    if (!blocks.has(key)) {
      blocks.set(key, {
        splitId: key,
        name: set.splitName || "Microciclo",
        start: null,
        sessions: new Map(), // fecha -> {readinessPre, perceivedEffortPost}
      });
    }

    const block = blocks.get(key);
    const day = isoDate(set.date);
    if (!block.start || day < block.start) block.start = day;
    if (!block.sessions.has(day)) {
      block.sessions.set(day, {
        readinessPre: set.readinessPre ?? null,
        perceivedEffortPost: set.perceivedEffortPost ?? null,
      });
    }
  }

  const average = (values) => {
    const present = values.filter((v) => v != null);
    if (!present.length) return null;
    return Math.round((present.reduce((sum, v) => sum + v, 0) / present.length) * 10) / 10;
  };

  return [...blocks.values()]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((block) => {
      const sessions = [...block.sessions.values()];
      return {
        splitId: block.splitId,
        name: block.name,
        start: block.start,
        avgReadinessPre: average(sessions.map((s) => s.readinessPre)),
        avgPerceivedEffortPost: average(sessions.map((s) => s.perceivedEffortPost)),
        sessionsWithPulse: sessions.length,
      };
    });
}

/**
 * Tarea 4 (2026-09) — carga por grupo muscular, por microciclo: qué está
 * trabajando más un cliente y qué se le está quedando corto, mirando los
 * ejercicios que de verdad ha hecho (no la ficha teórica de la rutina).
 *
 * El grupo muscular no está en el Set, está en el Exercise del catálogo
 * (muscleGroups1/2, ver exercise-schema.js) — listCompletedSetsForUser ya lo
 * proyecta. Un ejercicio propio del cliente sin ficha en el catálogo no
 * aporta grupo: se ignora en vez de inventarle uno.
 *
 * Reparto: el volumen COMPLETO de la serie se suma a CADA grupo implicado
 * (primario, o secundario si el ejercicio no tiene primario). Dividir el
 * volumen entre grupos fingiría una precisión biomecánica ("este ejercicio
 * trabaja 60% pecho, 40% tríceps") que ningún dato del sistema respalda.
 */
function buildBlockMuscleGroups(sets) {
  const blocks = new Map();

  for (const set of sets || []) {
    if (!set.splitId) continue;
    const groups = set.muscleGroups1?.length ? set.muscleGroups1 : set.muscleGroups2 || [];
    if (!groups.length) continue;

    const key = String(set.splitId);
    if (!blocks.has(key)) {
      blocks.set(key, {
        splitId: key,
        name: set.splitName || "Microciclo",
        start: null,
        end: null,
        muscleGroups: new Map(),
      });
    }

    const block = blocks.get(key);
    const day = isoDate(set.date);
    if (!block.start || day < block.start) block.start = day;
    if (!block.end || day > block.end) block.end = day;

    const volume = volumeOf(set);
    for (const group of new Set(groups)) {
      const current = block.muscleGroups.get(group) || { volume: 0, sets: 0 };
      block.muscleGroups.set(group, { volume: current.volume + volume, sets: current.sets + 1 });
    }
  }

  return [...blocks.values()]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((block) => ({
      splitId: block.splitId,
      name: block.name,
      start: block.start,
      end: block.end,
      muscleGroups: [...block.muscleGroups.entries()]
        .map(([group, data]) => ({ group, volume: Math.round(data.volume), sets: data.sets }))
        .sort((a, b) => b.volume - a.volume),
    }));
}

/**
 * Comparar por ejercicio (2026-09) — "ejercicios por micros": el mismo
 * ejercicio, microciclo a microciclo, en vez del agregado ciego de
 * buildBlockTraining. Mismo recorte por splitId que ya usa
 * buildBlockTraining/buildBlockMuscleGroups — ninguna consulta nueva, es la
 * misma `sets` que ya trae exerciseName (ver listCompletedSetsForUser).
 *
 * Peso máximo es la cifra PRINCIPAL (mismo criterio que buildPersonalRecords:
 * "así es como un entrenador lee un récord"), con volumen y nº de series
 * como contexto — no se dividen en líneas propias para no repetir el
 * problema de escalas mezcladas que ya evita TrainingComparisonMetric al ser
 * un selector, no varias métricas activas a la vez.
 */
function buildBlockExerciseProgress(sets, exerciseName) {
  const blocks = new Map();

  for (const set of sets || []) {
    if (!set.splitId || set.exerciseName !== exerciseName) continue;
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    if (!Number.isFinite(weight) || weight < MIN_TRACKED_WEIGHT || !Number.isFinite(reps) || reps <= 0) continue;

    const key = String(set.splitId);
    if (!blocks.has(key)) {
      blocks.set(key, {
        splitId: key,
        name: set.splitName || "Microciclo",
        start: null,
        end: null,
        maxWeight: 0,
        volume: 0,
        sets: 0,
        totalReps: 0,
        bestSet: null,
      });
    }

    const block = blocks.get(key);
    const day = isoDate(set.date);
    if (!block.start || day < block.start) block.start = day;
    if (!block.end || day > block.end) block.end = day;
    block.maxWeight = Math.max(block.maxWeight, weight);
    // Carga, repeticiones y RIR pertenecen a la MISMA serie realizada.
    // No combinar máximos de series diferentes ni usar el RIR pautado.
    if (!block.bestSet || weight > block.bestSet.weight ||
        (weight === block.bestSet.weight && reps > block.bestSet.reps)) {
      const rir = (Array.isArray(set.rir) ? set.rir : [set.rir])
        .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 20);
      block.bestSet = { weight, reps, rir };
    }
    block.volume += volumeOf(set);
    block.sets += 1;
    block.totalReps += reps;
  }

  return [...blocks.values()]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((block) => ({ ...block, volume: Math.round(block.volume) }));
}

/**
 * 2026-09 — los mismos agregados de buildBlockTraining/buildBlockMuscleGroups/
 * buildBlockReadiness/buildBlockExerciseProgress, pero por SESIÓN individual
 * en vez de por microciclo. No es una consulta nueva: es la misma `sets`
 * (tableDao.listCompletedSetsForUser) agrupada por fecha en vez de por
 * splitId. Sirve al selector de granularidad "Por sesión" del comparador:
 * un microciclo promedia y por tanto esconde la sesión suelta en la que el
 * cliente entrenó mal o llegó muy cansado — verlo sesión a sesión es lo que
 * responde "¿qué día concreto se torció esto?".
 *
 * splitId/splitName se llevan de contexto (para la etiqueta "12 ene ·
 * Semana 2" en el frontend), no para agrupar.
 */
function buildSessionTraining(sets) {
  const sessions = new Map();

  for (const set of sets || []) {
    const day = isoDate(set.date);
    if (!day) continue;

    if (!sessions.has(day)) {
      sessions.set(day, {
        date: day,
        splitId: set.splitId ? String(set.splitId) : null,
        splitName: set.splitName || null,
        volume: 0,
        sets: 0,
      });
    }

    const session = sessions.get(day);
    session.volume += volumeOf(set);
    session.sets += 1;
  }

  return [...sessions.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => ({ ...session, volume: Math.round(session.volume) }));
}

/** Igual que buildSessionTraining, pero por grupo muscular — espejo de buildBlockMuscleGroups. */
function buildSessionMuscleGroups(sets) {
  const sessions = new Map();

  for (const set of sets || []) {
    const groups = set.muscleGroups1?.length ? set.muscleGroups1 : set.muscleGroups2 || [];
    if (!groups.length) continue;

    const day = isoDate(set.date);
    if (!day) continue;

    if (!sessions.has(day)) {
      sessions.set(day, {
        date: day,
        splitId: set.splitId ? String(set.splitId) : null,
        splitName: set.splitName || null,
        muscleGroups: new Map(),
      });
    }

    const session = sessions.get(day);
    const volume = volumeOf(set);
    for (const group of groups) {
      session.muscleGroups.set(group, (session.muscleGroups.get(group) || 0) + volume);
    }
  }

  return [...sessions.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => ({
      date: session.date,
      splitId: session.splitId,
      splitName: session.splitName,
      muscleGroups: [...session.muscleGroups.entries()]
        .map(([group, volume]) => ({ group, volume: Math.round(volume) }))
        .sort((a, b) => b.volume - a.volume),
    }));
}

/**
 * Igual que buildBlockReadiness pero sin promediar: el pulso YA es un dato
 * por sesión (se repite en cada set de la misma sesión a propósito, ver
 * tableDao.listCompletedSetsForUser), así que aquí basta con el primero que
 * se encuentre por fecha — no hay nada que promediar dentro de una sesión.
 */
function buildSessionReadiness(sets) {
  const sessions = new Map();

  for (const set of sets || []) {
    if (set.readinessPre == null && set.perceivedEffortPost == null) continue;

    const day = isoDate(set.date);
    if (!day || sessions.has(day)) continue;

    sessions.set(day, {
      date: day,
      splitId: set.splitId ? String(set.splitId) : null,
      splitName: set.splitName || null,
      readinessPre: set.readinessPre ?? null,
      perceivedEffortPost: set.perceivedEffortPost ?? null,
    });
  }

  return [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Igual que buildBlockExerciseProgress pero por sesión — espejo de buildSessionTraining. */
function buildSessionExerciseProgress(sets, exerciseName) {
  const sessions = new Map();

  for (const set of sets || []) {
    if (set.exerciseName !== exerciseName) continue;
    const weight = Number(set.weight) || 0;
    if (weight < MIN_TRACKED_WEIGHT) continue;

    const day = isoDate(set.date);
    if (!day) continue;

    if (!sessions.has(day)) {
      sessions.set(day, {
        date: day,
        splitId: set.splitId ? String(set.splitId) : null,
        splitName: set.splitName || null,
        maxWeight: 0,
        volume: 0,
        sets: 0,
      });
    }

    const session = sessions.get(day);
    session.maxWeight = Math.max(session.maxWeight, weight);
    session.volume += volumeOf(set);
    session.sets += 1;
  }

  return [...sessions.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => ({ ...session, volume: Math.round(session.volume) }));
}

/**
 * 2026-09 — adherencia de sesión: series realmente hechas frente a las
 * pautadas EN ESA SESIÓN concreta. Distinto de "adherencia por microciclo"
 * (nunca implementada porque no hay calendario planificado, ver
 * tableDao.countPlannedSessionsPerMicrocycle): aquí sí hay un denominador
 * honesto, porque la sesión ya existe con sus series reales desde que se le
 * asignó al cliente — terminarla (finishWorkout) no exige tenerlas todas
 * hechas, así que "cuántas de las pautadas se hicieron" es un hecho, no una
 * estimación.
 *
 * Entra el resultado crudo de tableDao.listSessionAdherenceForUser (una fila
 * por Workout, no por set — esa consulta no filtra `doned`, a diferencia de
 * listCompletedSetsForUser).
 */
function buildSessionAdherence(sessions) {
  return (sessions || [])
    .map((session) => ({
      date: isoDate(session.date),
      splitId: session.splitId ? String(session.splitId) : null,
      splitName: session.splitName || null,
      totalSets: session.totalSets,
      donedSets: session.donedSets,
      adherence: session.totalSets ? Math.round((session.donedSets / session.totalSets) * 100) : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * La misma adherencia agregada por microciclo — SUMANDO series hechas y
 * pautadas de todas las sesiones del bloque antes de dividir, no
 * promediando los porcentajes de cada sesión: una media de porcentajes
 * pesaría igual una sesión de 4 series que una de 40.
 */
function buildBlockAdherence(sessionAdherence) {
  const blocks = new Map();

  for (const session of sessionAdherence || []) {
    if (!session.splitId) continue;

    if (!blocks.has(session.splitId)) {
      blocks.set(session.splitId, {
        splitId: session.splitId,
        name: session.splitName || "Microciclo",
        start: null,
        totalSets: 0,
        donedSets: 0,
        sessions: 0,
      });
    }

    const block = blocks.get(session.splitId);
    if (!block.start || session.date < block.start) block.start = session.date;
    block.totalSets += session.totalSets;
    block.donedSets += session.donedSets;
    block.sessions += 1;
  }

  return [...blocks.values()]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((block) => ({
      splitId: block.splitId,
      name: block.name,
      start: block.start,
      adherence: block.totalSets ? Math.round((block.donedSets / block.totalSets) * 100) : null,
      sessions: block.sessions,
    }));
}

// Nombres de ejercicio con carga real (mismo filtro MIN_TRACKED_WEIGHT que
// buildPersonalRecords) disponibles en el rango pedido — alimenta el
// selector de "comparar por ejercicio" sin que el frontend tenga que
// adivinar qué hay que ofrecer.
function listTrackedExerciseNames(sets) {
  const names = new Set();
  for (const set of sets || []) {
    if (!set.exerciseName) continue;
    if (!Number.isFinite(Number(set.weight)) || Number(set.weight) < MIN_TRACKED_WEIGHT ||
        !Number.isFinite(Number(set.reps)) || Number(set.reps) <= 0 || !set.splitId) continue;
    names.add(set.exerciseName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * 2026-09 — "elegir el workout a ver": nombres de entrenamiento (p.ej. "Día
 * de pierna") con al menos una sesión completada en el rango, para alimentar
 * ese selector. Sin filtro de carga (a diferencia de listTrackedExerciseNames
 * con MIN_TRACKED_WEIGHT): aquí no se trata de peso, un día de cardio o
 * movilidad es un workout tan elegible como cualquier otro.
 */
function listTrackedWorkoutNames(sets) {
  const names = new Set();
  for (const set of sets || []) {
    if (set.workoutName) names.add(set.workoutName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
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
  buildBlockReadiness,
  buildBlockMuscleGroups,
  buildBlockExerciseProgress,
  buildSessionTraining,
  buildSessionMuscleGroups,
  buildSessionReadiness,
  buildSessionExerciseProgress,
  buildSessionAdherence,
  buildBlockAdherence,
  listTrackedExerciseNames,
  listTrackedWorkoutNames,
};
