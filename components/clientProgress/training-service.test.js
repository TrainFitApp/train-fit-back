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
} = require("./training-service");

const NOW = new Date("2026-08-23T10:00:00.000Z");

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
