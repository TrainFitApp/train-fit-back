const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MIN_TRACKED_WEIGHT,
  TOP_EXERCISES,
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
} = require("./training-service");

const NOW = new Date("2026-08-23T10:00:00.000Z");

test('dos sesiones el mismo día cuentan por workout, no por fecha', () => {
  const base = { splitId: 'a', date: NOW, reps: 10, weight: 50 };
  const [block] = buildBlockTraining([{ ...base, workoutId: 'one' }, { ...base, workoutId: 'one' }, { ...base, workoutId: 'two' }]);
  assert.equal(block.sessions, 2);
  assert.equal(block.volumePerSession, 750);
});

test('carga, reps y RIR conservan la misma serie; cero es un RIR válido', () => {
  const base = { splitId: 'a', date: NOW, exerciseName: 'Press' };
  const [block] = buildBlockExerciseProgress([
    { ...base, weight: 80, reps: 12, rir: [3] },
    { ...base, weight: 90, reps: 5, rir: [2] },
    { ...base, weight: 90, reps: 6, rir: [0] },
    { ...base, weight: 100, reps: 0, rir: [1] },
  ], 'Press');
  assert.deepEqual(block.bestSet, { weight: 90, reps: 6, rir: [0] });
  assert.equal(block.totalReps, 23);
  assert.equal(block.sets, 3);
});

test('RIR ausente no se convierte en cero ni en el esperado', () => {
  const [block] = buildBlockExerciseProgress([{ splitId: 'a', date: NOW, exerciseName: 'Press', weight: 80, reps: 8, expectedRir: [2] }], 'Press');
  assert.deepEqual(block.bestSet.rir, []);
});

test('series por grupo no duplican etiquetas repetidas ni excluyen peso corporal', () => {
  const [block] = buildBlockMuscleGroups([{ splitId: 'a', date: NOW, weight: 0, reps: 10, muscleGroups1: ['core', 'core'] }]);
  assert.equal(block.muscleGroups[0].sets, 1);
});

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000);
}

function set(daysAgoValue, exerciseName, reps, weight) {
  return { date: daysAgo(daysAgoValue), exerciseName, reps, weight };
}

// El volumen y los PRs son números que un coach usa para decidir si sube la
// carga. Contar series no hechas, o dar un PR de 0 kg, le hace decidir mal.

test("buildWeeklyTraining", async (t) => {
  await t.test("volumen = repeticiones × peso, sumado", () => {
    const weekly = buildWeeklyTraining([set(1, "Press banca", 10, 60), set(2, "Press banca", 8, 70)], 4, NOW);
    // 10×60 + 8×70 = 600 + 560 = 1160
    assert.equal(weekly[3].volume, 1160);
    assert.equal(weekly[3].sets, 2);
  });

  await t.test("cuenta sesiones por DÍA distinto, no por serie", () => {
    const weekly = buildWeeklyTraining(
      [set(1, "A", 10, 50), set(1, "B", 10, 50), set(3, "A", 10, 50)],
      4,
      NOW
    );
    assert.equal(weekly[3].sets, 3);
    assert.equal(weekly[3].sessions, 2, "dos días distintos");
  });

  await t.test("una semana sin entrenar da volumen null, no 0", () => {
    // 0 kg se pintaría como "entrenó y no levantó nada".
    const weekly = buildWeeklyTraining([set(1, "A", 10, 50)], 4, NOW);
    assert.equal(weekly[3].volume, 500);
    assert.equal(weekly[0].volume, null);
    assert.equal(weekly[0].sessions, 0);
  });

  await t.test("reparte las series en su semana correcta", () => {
    const weekly = buildWeeklyTraining([set(1, "A", 10, 50), set(20, "A", 10, 100)], 4, NOW);
    assert.equal(weekly[3].volume, 500);
    assert.equal(weekly[1].volume, 1000);
  });

  await t.test("una serie sin peso no revienta el cálculo", () => {
    const weekly = buildWeeklyTraining([{ date: daysAgo(1), exerciseName: "Dominadas", reps: 10 }], 4, NOW);
    assert.equal(weekly[3].volume, 0, "sin peso el volumen de esa serie es 0, pero la serie existe");
    assert.equal(weekly[3].sets, 1);
  });
});

test("buildPersonalRecords", async (t) => {
  await t.test("el récord es la serie de más PESO", () => {
    const records = buildPersonalRecords([
      set(10, "Press banca", 10, 60),
      set(3, "Press banca", 3, 100),
      set(1, "Press banca", 8, 80),
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0].weight, 100);
    assert.equal(records[0].reps, 3);
  });

  await t.test("a igual peso gana la de más repeticiones", () => {
    const records = buildPersonalRecords([set(10, "Sentadilla", 5, 100), set(1, "Sentadilla", 8, 100)]);
    assert.equal(records[0].reps, 8);
  });

  await t.test("10×60 no supera a 3×100 aunque su volumen sea mayor", () => {
    // Un entrenador lee un récord por la carga, no por el producto.
    const records = buildPersonalRecords([set(10, "Press", 3, 100), set(1, "Press", 10, 60)]);
    assert.equal(records[0].weight, 100);
  });

  await t.test("las series sin carga quedan fuera (no hay PR de 0 kg)", () => {
    assert.deepEqual(buildPersonalRecords([set(1, "Dominadas", 10, 0)]), []);
    assert.deepEqual(buildPersonalRecords([set(1, "Plancha", 1, undefined)]), []);
  });

  await t.test("las series sin repeticiones tampoco cuentan", () => {
    assert.deepEqual(buildPersonalRecords([set(1, "Press", 0, 100)]), []);
  });

  await t.test("un récord por ejercicio, ordenados de más a menos peso", () => {
    const records = buildPersonalRecords([
      set(1, "Press banca", 5, 80),
      set(1, "Sentadilla", 5, 120),
      set(1, "Remo", 5, 60),
    ]);
    assert.deepEqual(
      records.map((r) => r.exerciseName),
      ["Sentadilla", "Press banca", "Remo"]
    );
  });

  await t.test("sin series, sin récords", () => {
    assert.deepEqual(buildPersonalRecords([]), []);
    assert.deepEqual(buildPersonalRecords(null), []);
  });
});

test("buildLoadEvolution", async (t) => {
  await t.test("sigue los ejercicios MÁS entrenados, con su peso máximo semanal", () => {
    const sets = [
      ...Array.from({ length: 6 }, () => set(1, "Press banca", 8, 70)),
      set(1, "Curl", 10, 15),
    ];
    const evolution = buildLoadEvolution(sets, 4, NOW);
    assert.equal(evolution[0].exerciseName, "Press banca");
    assert.equal(evolution[0].weeks[3].maxWeight, 70);
    assert.equal(evolution[0].weeks[0].maxWeight, null, "sin series esa semana");
  });

  await t.test("nunca sigue más de TOP_EXERCISES ejercicios", () => {
    const sets = [];
    for (let i = 0; i < TOP_EXERCISES + 4; i++) sets.push(set(1, `Ejercicio ${i}`, 10, 50 + i));
    assert.equal(buildLoadEvolution(sets, 4, NOW).length, TOP_EXERCISES);
  });

  await t.test("los ejercicios sin carga no entran en la evolución", () => {
    const evolution = buildLoadEvolution([set(1, "Plancha", 1, 0)], 4, NOW);
    assert.deepEqual(evolution, []);
  });
});

test("buildVolumeComparison", async (t) => {
  await t.test("compara la última semana contra la anterior", () => {
    const weekly = buildWeeklyTraining([set(1, "A", 10, 60), set(9, "A", 10, 50)], 4, NOW);
    const comparison = buildVolumeComparison(weekly);
    assert.equal(comparison.previous, 500);
    assert.equal(comparison.current, 600);
    assert.equal(comparison.absolute, 100);
    assert.equal(comparison.percentage, 20);
  });

  await t.test("no compara contra una semana sin entrenar", () => {
    // Si no, saldría un porcentaje infinito.
    const weekly = buildWeeklyTraining([set(1, "A", 10, 60)], 4, NOW);
    assert.equal(buildVolumeComparison(weekly), null);
  });

  await t.test("con una sola semana no hay comparación", () => {
    assert.equal(buildVolumeComparison(buildWeeklyTraining([], 1, NOW)), null);
  });
});

test("umbrales", async (t) => {
  await t.test("el peso mínimo seguido es positivo pero pequeño", () => {
    assert.ok(MIN_TRACKED_WEIGHT > 0);
    assert.ok(MIN_TRACKED_WEIGHT <= 1, "un umbral alto dejaría fuera cargas reales ligeras");
  });
});

// --- Movimiento 3 Coach Pro: comparación bloque a bloque ---
// Un microciclo no dura siete días, así que las semanas naturales lo parten.
// Comparar bloques mal agrupados u ordenados le haría creer al entrenador
// que su cliente ha subido cuando solo ha entrenado más días.

function blockSet(daysAgoValue, splitId, splitName, reps, weight) {
  return {
    date: daysAgo(daysAgoValue),
    splitId,
    splitName,
    exerciseName: "Sentadilla",
    reps,
    weight,
  };
}

test("buildBlockTraining", async (t) => {
  await t.test("agrupa por microciclo y calcula volumen, series y sesiones", () => {
    const blocks = buildBlockTraining([
      blockSet(10, "a", "Semana 1", 10, 100),
      blockSet(9, "a", "Semana 1", 10, 100),
      blockSet(3, "b", "Semana 2", 10, 110),
    ]);

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].name, "Semana 1");
    assert.equal(blocks[0].volume, 2000);
    assert.equal(blocks[0].sets, 2);
    assert.equal(blocks[0].sessions, 2);
    assert.equal(blocks[1].volume, 1100);
    assert.equal(blocks[1].sessions, 1);
  });

  await t.test("ordena por primera sesión, no por el orden de llegada", () => {
    // Un microciclo insertado después aparecería fuera de sitio si se
    // respetara el orden de Table.splits.
    const blocks = buildBlockTraining([
      blockSet(2, "b", "Segundo", 10, 100),
      blockSet(20, "a", "Primero", 10, 100),
    ]);
    assert.deepEqual(
      blocks.map((block) => block.name),
      ["Primero", "Segundo"]
    );
  });

  await t.test("volumen POR SESIÓN además del total", () => {
    const [block] = buildBlockTraining([
      blockSet(5, "a", "Semana 1", 10, 100),
      blockSet(4, "a", "Semana 1", 10, 100),
      blockSet(4, "a", "Semana 1", 10, 100),
    ]);
    assert.equal(block.volume, 3000);
    assert.equal(block.sessions, 2); // dos días distintos
    assert.equal(block.volumePerSession, 1500);
  });

  await t.test("una serie sin microciclo se ignora en vez de crear un bloque fantasma", () => {
    const blocks = buildBlockTraining([
      { date: daysAgo(2), exerciseName: "A", reps: 10, weight: 60 },
    ]);
    assert.deepEqual(blocks, []);
  });

  await t.test("sin series no hay bloques", () => {
    assert.deepEqual(buildBlockTraining([]), []);
    assert.deepEqual(buildBlockTraining(null), []);
  });
});

test("buildBlockComparison", async (t) => {
  await t.test("compara el volumen POR SESIÓN, no el total", () => {
    // El bloque nuevo tiene MENOS volumen total (2000 vs 3000) pero MÁS por
    // sesión (2000 vs 1500): ha trabajado más, solo que en menos días. El
    // total diría lo contrario.
    const blocks = buildBlockTraining([
      blockSet(20, "a", "Bloque 1", 10, 100),
      blockSet(19, "a", "Bloque 1", 10, 100),
      blockSet(18, "a", "Bloque 1", 10, 100),
      blockSet(3, "b", "Bloque 2", 20, 100),
    ]);
    const comparison = buildBlockComparison(blocks);

    assert.equal(comparison.previous.volumePerSession, 1000);
    assert.equal(comparison.current.volumePerSession, 2000);
    assert.equal(comparison.absolute, 1000);
    assert.equal(comparison.percentage, 100);
  });

  await t.test("con un solo bloque no hay comparación", () => {
    const blocks = buildBlockTraining([blockSet(2, "a", "Único", 10, 100)]);
    assert.equal(buildBlockComparison(blocks), null);
  });

  await t.test("sin bloques tampoco", () => {
    assert.equal(buildBlockComparison([]), null);
  });

  await t.test("un bloque anterior sin volumen no genera un porcentaje infinito", () => {
    const blocks = [
      { name: "A", volumePerSession: 0, sessions: 1, start: "2026-08-01", end: "2026-08-01" },
      { name: "B", volumePerSession: 1500, sessions: 1, start: "2026-08-10", end: "2026-08-10" },
    ];
    assert.equal(buildBlockComparison(blocks), null);
  });
});

// --- 2026-09: readiness/esfuerzo promediado por microciclo ---
// El pulso es opcional (el cliente puede saltárselo): una sesión sin
// ninguno de los dos no debe contar como un cero que hunda el promedio.

function pulseSet(daysAgoValue, splitId, splitName, readinessPre, perceivedEffortPost) {
  return {
    date: daysAgo(daysAgoValue),
    splitId,
    splitName,
    exerciseName: "Sentadilla",
    reps: 5,
    weight: 100,
    readinessPre,
    perceivedEffortPost,
  };
}

test("buildBlockReadiness", async (t) => {
  await t.test("promedia por SESIÓN, no por serie (varias series del mismo día no pesan de más)", () => {
    const blocks = buildBlockReadiness([
      pulseSet(5, "a", "Bloque 1", 4, 3),
      pulseSet(5, "a", "Bloque 1", 4, 3), // misma sesión (mismo día), no debe duplicar
      pulseSet(3, "a", "Bloque 1", 2, 5),
    ]);
    // (4 + 2) / 2 = 3, no (4+4+2)/3
    assert.equal(blocks[0].avgReadinessPre, 3);
    assert.equal(blocks[0].avgPerceivedEffortPost, (3 + 5) / 2);
    assert.equal(blocks[0].sessionsWithPulse, 2);
  });

  await t.test("una sesión sin ninguno de los dos valores no cuenta ni resta", () => {
    const blocks = buildBlockReadiness([
      pulseSet(5, "a", "Bloque 1", 5, 5),
      { date: daysAgo(4), splitId: "a", splitName: "Bloque 1", readinessPre: null, perceivedEffortPost: null },
    ]);
    // La sesión sin pulso ni se cuela en el bloque (se descarta antes de agrupar).
    assert.equal(blocks[0].avgReadinessPre, 5);
    assert.equal(blocks[0].sessionsWithPulse, 1);
  });

  await t.test("readinessPre y perceivedEffortPost se promedian de forma independiente", () => {
    // Una sesión trae solo readiness, otra solo esfuerzo: cada métrica
    // promedia únicamente sobre las sesiones que SÍ la trajeron.
    const blocks = buildBlockReadiness([
      pulseSet(5, "a", "Bloque 1", 4, null),
      pulseSet(3, "a", "Bloque 1", null, 2),
    ]);
    assert.equal(blocks[0].avgReadinessPre, 4);
    assert.equal(blocks[0].avgPerceivedEffortPost, 2);
  });

  await t.test("varios microciclos, ordenados por primera sesión", () => {
    const blocks = buildBlockReadiness([
      pulseSet(3, "b", "Bloque 2", 5, 5),
      pulseSet(20, "a", "Bloque 1", 1, 1),
    ]);
    assert.equal(blocks[0].name, "Bloque 1");
    assert.equal(blocks[1].name, "Bloque 2");
  });

  await t.test("series sin splitId no cuentan (dato viejo, no comparable)", () => {
    assert.deepEqual(buildBlockReadiness([{ date: daysAgo(1), readinessPre: 5, perceivedEffortPost: 5 }]), []);
  });

  await t.test("sin sets tampoco", () => {
    assert.deepEqual(buildBlockReadiness([]), []);
    assert.deepEqual(buildBlockReadiness(null), []);
  });
});

// --- Tarea 4 (2026-09): carga por grupo muscular, por microciclo ---
// Comparar entrenamiento no es solo "cuánto peso", es "qué está trabajando":
// un cliente puede subir el volumen total a base de piernas mientras
// abandona empuje sin que ningún número de arriba lo diga.

function muscleGroupSet(daysAgoValue, splitId, splitName, reps, weight, muscleGroups1, muscleGroups2) {
  return {
    date: daysAgo(daysAgoValue),
    splitId,
    splitName,
    exerciseName: "Ejercicio",
    reps,
    weight,
    muscleGroups1,
    muscleGroups2,
  };
}

test("buildBlockMuscleGroups", async (t) => {
  await t.test("suma el volumen de la serie a cada grupo primario implicado", () => {
    const blocks = buildBlockMuscleGroups([
      muscleGroupSet(2, "a", "Semana 1", 10, 100, ["pecho", "triceps"]),
    ]);
    assert.equal(blocks.length, 1);
    assert.deepEqual(
      blocks[0].muscleGroups.map((g) => g.group).sort(),
      ["pecho", "triceps"]
    );
    // 10x100 = 1000, completo en los dos grupos, no repartido a 500 cada uno.
    assert.ok(blocks[0].muscleGroups.every((g) => g.volume === 1000));
  });

  await t.test("sin grupo primario, cae al secundario", () => {
    const blocks = buildBlockMuscleGroups([
      muscleGroupSet(1, "a", "Semana 1", 10, 50, [], ["core"]),
    ]);
    assert.deepEqual(
      blocks[0].muscleGroups.map((g) => g.group),
      ["core"]
    );
  });

  await t.test("un ejercicio sin ficha en el catálogo (sin grupos) no aporta nada", () => {
    const blocks = buildBlockMuscleGroups([muscleGroupSet(1, "a", "Semana 1", 10, 50, [], [])]);
    assert.deepEqual(blocks, []);
  });

  await t.test("agrega varias series del mismo grupo dentro del microciclo", () => {
    const blocks = buildBlockMuscleGroups([
      muscleGroupSet(3, "a", "Semana 1", 10, 100, ["pierna"]),
      muscleGroupSet(1, "a", "Semana 1", 8, 100, ["pierna"]),
    ]);
    assert.equal(blocks[0].muscleGroups[0].volume, 1000 + 800);
  });

  await t.test("ordena los grupos de más a menos volumen", () => {
    const blocks = buildBlockMuscleGroups([
      muscleGroupSet(1, "a", "Semana 1", 10, 100, ["espalda"]),
      muscleGroupSet(1, "a", "Semana 1", 10, 20, ["biceps"]),
    ]);
    assert.deepEqual(
      blocks[0].muscleGroups.map((g) => g.group),
      ["espalda", "biceps"]
    );
  });

  await t.test("ordena los bloques por primera sesión, igual que buildBlockTraining", () => {
    const blocks = buildBlockMuscleGroups([
      muscleGroupSet(2, "b", "Segundo", 10, 100, ["pecho"]),
      muscleGroupSet(20, "a", "Primero", 10, 100, ["pecho"]),
    ]);
    assert.deepEqual(
      blocks.map((b) => b.name),
      ["Primero", "Segundo"]
    );
  });

  await t.test("una serie sin microciclo se ignora", () => {
    const blocks = buildBlockMuscleGroups([
      { date: daysAgo(1), exerciseName: "A", reps: 10, weight: 50, muscleGroups1: ["pecho"] },
    ]);
    assert.deepEqual(blocks, []);
  });

  await t.test("sin series no hay bloques", () => {
    assert.deepEqual(buildBlockMuscleGroups([]), []);
    assert.deepEqual(buildBlockMuscleGroups(null), []);
  });
});

// Comparar por ejercicio (2026-09) — "ejercicios por micros": el mismo
// ejercicio, microciclo a microciclo. Un entrenador decide si sube la carga
// mirando estos números; un PR de 0 kg o mezclar dos ejercicios distintos en
// el mismo bloque le haría decidir mal, igual que ya vigilan los tests de
// buildPersonalRecords/buildBlockTraining de arriba.

function exerciseSet(daysAgoValue, splitId, splitName, exerciseName, weight) {
  return { date: daysAgo(daysAgoValue), splitId, splitName, exerciseName, weight, reps: 5 };
}

test("buildBlockExerciseProgress", async (t) => {
  await t.test("filtra por ejercicio y calcula peso máximo, volumen y series por bloque", () => {
    const sets = [
      exerciseSet(10, "a", "Semana 1", "Press banca", 80),
      exerciseSet(9, "a", "Semana 1", "Press banca", 82.5),
      exerciseSet(9, "a", "Semana 1", "Sentadilla", 100), // otro ejercicio, no cuenta
      exerciseSet(3, "b", "Semana 2", "Press banca", 85),
    ];

    const blocks = buildBlockExerciseProgress(sets, "Press banca");

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].name, "Semana 1");
    assert.equal(blocks[0].maxWeight, 82.5);
    assert.equal(blocks[0].sets, 2);
    // 5×80 + 5×82.5 = 812.5, redondeado a 813 (Math.round, igual que
    // buildBlockTraining con el volumen total).
    assert.equal(blocks[0].volume, 813);
    assert.equal(blocks[1].maxWeight, 85);
  });

  await t.test("ordena los bloques por primera sesión, igual que buildBlockTraining", () => {
    const blocks = buildBlockExerciseProgress(
      [
        exerciseSet(2, "b", "Segundo", "Sentadilla", 100),
        exerciseSet(20, "a", "Primero", "Sentadilla", 90),
      ],
      "Sentadilla"
    );
    assert.deepEqual(
      blocks.map((b) => b.name),
      ["Primero", "Segundo"]
    );
  });

  await t.test("respeta MIN_TRACKED_WEIGHT igual que buildPersonalRecords", () => {
    const blocks = buildBlockExerciseProgress(
      [exerciseSet(1, "a", "Semana 1", "Peso corporal", MIN_TRACKED_WEIGHT - 0.1)],
      "Peso corporal"
    );
    assert.deepEqual(blocks, []);
  });

  await t.test("una serie sin microciclo se ignora en vez de crear un bloque fantasma", () => {
    const blocks = buildBlockExerciseProgress(
      [{ date: daysAgo(1), exerciseName: "Press banca", weight: 80, reps: 5 }],
      "Press banca"
    );
    assert.deepEqual(blocks, []);
  });

  await t.test("sin series no hay bloques", () => {
    assert.deepEqual(buildBlockExerciseProgress([], "Press banca"), []);
    assert.deepEqual(buildBlockExerciseProgress(null, "Press banca"), []);
  });
});

test("listTrackedExerciseNames", async (t) => {
  await t.test("nombres únicos, sin repetidos, ordenados alfabéticamente", () => {
    const names = listTrackedExerciseNames([
      exerciseSet(1, "a", "Semana 1", "Sentadilla", 100),
      exerciseSet(1, "a", "Semana 1", "Press banca", 80),
      exerciseSet(2, "a", "Semana 1", "Sentadilla", 105),
    ]);
    assert.deepEqual(names, ["Press banca", "Sentadilla"]);
  });

  await t.test("un ejercicio por debajo de MIN_TRACKED_WEIGHT no se ofrece", () => {
    const names = listTrackedExerciseNames([
      exerciseSet(1, "a", "Semana 1", "Zancadas sin peso", MIN_TRACKED_WEIGHT - 0.1),
    ]);
    assert.deepEqual(names, []);
  });

  await t.test("sin series no hay nombres", () => {
    assert.deepEqual(listTrackedExerciseNames([]), []);
    assert.deepEqual(listTrackedExerciseNames(null), []);
  });
});

// 2026-09 — granularidad "Por sesión" del comparador: los mismos agregados
// de arriba pero sin colapsar por microciclo. Lo único que hay que vigilar
// aquí es que agrupen por FECHA (no por serie) y que dos sesiones del mismo
// microciclo salgan como dos filas distintas, no una.

test("buildSessionTraining", async (t) => {
  await t.test("agrupa por fecha, no por serie", () => {
    const sessions = buildSessionTraining([
      set(5, "Sentadilla", 5, 100),
      set(5, "Press banca", 8, 60),
      set(2, "Sentadilla", 5, 100),
    ]);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sets, 2);
    assert.equal(sessions[0].volume, 5 * 100 + 8 * 60);
    assert.equal(sessions[1].sets, 1);
  });

  await t.test("ordena por fecha ascendente", () => {
    const sessions = buildSessionTraining([exerciseSet(1, "a", "S1", "X", 50), exerciseSet(10, "a", "S1", "X", 50)]);
    assert.ok(sessions[0].date < sessions[1].date);
  });

  await t.test("sin series no hay sesiones", () => {
    assert.deepEqual(buildSessionTraining([]), []);
    assert.deepEqual(buildSessionTraining(null), []);
  });
});

test("buildSessionMuscleGroups", async (t) => {
  await t.test("agrupa por sesión, no por microciclo", () => {
    const sessions = buildSessionMuscleGroups([
      muscleGroupSet(5, "a", "Semana 1", 10, 100, ["pecho"]),
      muscleGroupSet(2, "a", "Semana 1", 10, 100, ["pierna"]),
    ]);
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions[0].muscleGroups.map((g) => g.group), ["pecho"]);
    assert.deepEqual(sessions[1].muscleGroups.map((g) => g.group), ["pierna"]);
  });

  await t.test("sin grupo muscular no aporta nada", () => {
    assert.deepEqual(buildSessionMuscleGroups([muscleGroupSet(1, "a", "S1", 10, 50, [], [])]), []);
  });
});

test("buildSessionReadiness", async (t) => {
  await t.test("no promedia: el pulso ya es un dato por sesión", () => {
    const sessions = buildSessionReadiness([
      pulseSet(5, "a", "Bloque 1", 4, 3),
      pulseSet(5, "a", "Bloque 1", 4, 3), // misma sesión, no duplica fila
      pulseSet(3, "a", "Bloque 1", 2, 5),
    ]);
    assert.equal(sessions.length, 2);
    // Orden ascendente por fecha: la sesión de hace 5 días va antes que la de hace 3.
    assert.equal(sessions[0].readinessPre, 4);
    assert.equal(sessions[1].readinessPre, 2);
  });

  await t.test("una sesión sin ningún pulso no aparece", () => {
    assert.deepEqual(
      buildSessionReadiness([{ date: daysAgo(1), splitId: "a", readinessPre: null, perceivedEffortPost: null }]),
      []
    );
  });
});

test("buildSessionExerciseProgress", async (t) => {
  await t.test("una fila por sesión con peso máximo de ESE día", () => {
    const sessions = buildSessionExerciseProgress(
      [
        exerciseSet(10, "a", "Semana 1", "Press banca", 80),
        exerciseSet(10, "a", "Semana 1", "Press banca", 82.5), // misma sesión, se queda el máximo
        exerciseSet(3, "b", "Semana 2", "Press banca", 85),
      ],
      "Press banca"
    );
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].maxWeight, 82.5);
    assert.equal(sessions[0].sets, 2);
    assert.equal(sessions[1].maxWeight, 85);
  });

  await t.test("filtra por ejercicio y respeta MIN_TRACKED_WEIGHT", () => {
    const sessions = buildSessionExerciseProgress(
      [exerciseSet(1, "a", "S1", "Peso corporal", MIN_TRACKED_WEIGHT - 0.1)],
      "Peso corporal"
    );
    assert.deepEqual(sessions, []);
  });
});

// 2026-09 — adherencia de sesión: series hechas frente a las pautadas EN ESA
// SESIÓN. A diferencia del resto, entra ya agregado por Workout (una fila
// por sesión, como devuelve tableDao.listSessionAdherenceForUser), no una
// lista de series.
function adherenceRow(daysAgoValue, splitId, splitName, totalSets, donedSets) {
  return { date: daysAgo(daysAgoValue), splitId, splitName, totalSets, donedSets };
}

test("buildSessionAdherence", async (t) => {
  await t.test("calcula el porcentaje hechas/pautadas por sesión", () => {
    const sessions = buildSessionAdherence([adherenceRow(2, "a", "Semana 1", 20, 15)]);
    assert.equal(sessions[0].adherence, 75);
  });

  await t.test("una sesión sin series pautadas no da división por cero", () => {
    const sessions = buildSessionAdherence([adherenceRow(1, "a", "Semana 1", 0, 0)]);
    assert.equal(sessions[0].adherence, null);
  });

  await t.test("ordena por fecha ascendente", () => {
    const sessions = buildSessionAdherence([
      adherenceRow(1, "a", "S1", 10, 10),
      adherenceRow(10, "a", "S1", 10, 10),
    ]);
    assert.ok(sessions[0].date < sessions[1].date);
  });

  await t.test("sin filas no hay sesiones", () => {
    assert.deepEqual(buildSessionAdherence([]), []);
    assert.deepEqual(buildSessionAdherence(null), []);
  });
});

test("buildBlockAdherence", async (t) => {
  await t.test("suma series hechas/pautadas de todo el bloque antes de dividir (no promedia %)", () => {
    // Sesión de 40 series al 50% + sesión de 4 series al 100%: una media de
    // porcentajes daría 75%, pero sumando primero da (20+4)/(40+4) = 54.5%.
    const blocks = buildBlockAdherence(
      buildSessionAdherence([adherenceRow(5, "a", "Bloque 1", 40, 20), adherenceRow(2, "a", "Bloque 1", 4, 4)])
    );
    assert.equal(blocks[0].adherence, Math.round((24 / 44) * 100));
    assert.equal(blocks[0].sessions, 2);
  });

  await t.test("ordena por primera sesión, igual que el resto de buildBlock*", () => {
    const blocks = buildBlockAdherence(
      buildSessionAdherence([adherenceRow(2, "b", "Segundo", 10, 10), adherenceRow(20, "a", "Primero", 10, 10)])
    );
    assert.deepEqual(blocks.map((b) => b.name), ["Primero", "Segundo"]);
  });

  await t.test("una sesión sin microciclo se ignora", () => {
    const blocks = buildBlockAdherence(buildSessionAdherence([{ date: daysAgo(1), totalSets: 10, donedSets: 5 }]));
    assert.deepEqual(blocks, []);
  });

  await t.test("sin sesiones no hay bloques", () => {
    assert.deepEqual(buildBlockAdherence([]), []);
    assert.deepEqual(buildBlockAdherence(null), []);
  });
});

test("listTrackedWorkoutNames", async (t) => {
  await t.test("nombres únicos, ordenados alfabéticamente, sin filtro de carga", () => {
    const names = listTrackedWorkoutNames([
      { ...set(1, "Sentadilla", 5, 0), workoutName: "Pierna" },
      { ...set(1, "Press banca", 5, 80), workoutName: "Empuje" },
      { ...set(2, "Sentadilla", 5, 0), workoutName: "Pierna" },
    ]);
    // Sentadilla a 0 kg (día de movilidad, por ejemplo) cuenta igual: esto
    // no es listTrackedExerciseNames, no hay MIN_TRACKED_WEIGHT.
    assert.deepEqual(names, ["Empuje", "Pierna"]);
  });

  await t.test("sin nombre de workout no aporta nada", () => {
    assert.deepEqual(listTrackedWorkoutNames([set(1, "X", 5, 50)]), []);
  });

  await t.test("sin series no hay nombres", () => {
    assert.deepEqual(listTrackedWorkoutNames([]), []);
    assert.deepEqual(listTrackedWorkoutNames(null), []);
  });
});
