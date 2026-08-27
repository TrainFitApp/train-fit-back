const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WELLBEING_NUMERIC_KEYS,
  PERIMETER_FIELDS,
  buildWeekWindows,
  buildWeeklySeries,
  buildComparison,
  buildWeightTrend,
} = require("./progress-service");

const NOW = new Date("2026-08-23T10:00:00.000Z");

function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

test("buildWeekWindows", async (t) => {
  await t.test("devuelve N ventanas de 7 días, de la más antigua a la más reciente", () => {
    const w = buildWeekWindows(4, NOW);
    assert.equal(w.length, 4);
    assert.equal(w[3].end, isoDaysAgo(0), "la última termina hoy");
    assert.equal(w[3].start, isoDaysAgo(6));
    assert.equal(w[0].start, isoDaysAgo(27), "la primera empieza 4 semanas atrás");
  });

  await t.test("las ventanas no se solapan ni dejan huecos", () => {
    const w = buildWeekWindows(8, NOW);
    for (let i = 1; i < w.length; i++) {
      const prevEnd = new Date(`${w[i - 1].end}T00:00:00.000Z`).getTime();
      const thisStart = new Date(`${w[i].start}T00:00:00.000Z`).getTime();
      assert.equal(thisStart - prevEnd, 86400000, "cada semana empieza justo al día siguiente");
    }
  });
});

test("catálogos derivados", async (t) => {
  await t.test("los campos de bienestar salen del catálogo y excluyen el texto libre", () => {
    assert.ok(WELLBEING_NUMERIC_KEYS.includes("sleep_hours"));
    assert.ok(WELLBEING_NUMERIC_KEYS.includes("stress_level"));
    assert.ok(WELLBEING_NUMERIC_KEYS.includes("daily_steps"));
    assert.ok(!WELLBEING_NUMERIC_KEYS.includes("comment"), "comment es texto, no se promedia");
    assert.ok(!WELLBEING_NUMERIC_KEYS.includes("weight"), "el peso viene de Anthropometry");
  });

  await t.test("los perímetros salen del catálogo con su etiqueta legible", () => {
    const waist = PERIMETER_FIELDS.find((f) => f.key === "waist");
    assert.ok(waist);
    assert.equal(waist.label, "Cintura");
  });
});

test("buildWeeklySeries", async (t) => {
  const base = { weeks: 4, now: NOW };

  await t.test("sin datos, cada semana viene en null — nunca en 0", () => {
    const series = buildWeeklySeries(base);
    assert.equal(series.length, 4);
    for (const week of series) {
      assert.equal(week.weight, null);
      assert.equal(week.nutritionAdherence, null, "null = no reportó, 0 = incumplió");
      assert.equal(week.wellbeing, null);
      assert.equal(week.sessions, 0, "sesiones sí es un conteo real: 0 significa 0");
    }
  });

  await t.test("el peso se promedia dentro de la semana y reparte por ventana", () => {
    const series = buildWeeklySeries({
      ...base,
      anthropometryEntries: [
        { date: isoDaysAgo(20), weight: 84 },
        { date: isoDaysAgo(5), weight: 80 },
        { date: isoDaysAgo(2), weight: 81 },
      ],
    });
    assert.equal(series[3].weight.average, 80.5, "80 y 81 en la última semana");
    assert.equal(series[3].weight.count, 2);
    assert.equal(series[3].weight.last, 81);
    assert.equal(series[1].weight.average, 84, "el de hace 20 días cae en la segunda ventana");
    assert.equal(series[0].weight, null);
  });

  await t.test("los perímetros toman el ÚLTIMO valor de la semana, no la media", () => {
    const series = buildWeeklySeries({
      ...base,
      anthropometryEntries: [
        { date: isoDaysAgo(5), waist: 90 },
        { date: isoDaysAgo(1), waist: 88 },
      ],
    });
    assert.equal(series[3].measurements.waist, 88);
  });

  await t.test("un perímetro ausente en el último registro cae al anterior de esa semana", () => {
    const series = buildWeeklySeries({
      ...base,
      anthropometryEntries: [
        { date: isoDaysAgo(5), waist: 90, chest: 100 },
        { date: isoDaysAgo(1), waist: 88 }, // sin chest
      ],
    });
    assert.equal(series[3].measurements.waist, 88);
    assert.equal(series[3].measurements.chest, 100);
  });

  await t.test("el bienestar promedia solo los campos realmente reportados", () => {
    const series = buildWeeklySeries({
      ...base,
      checkinResponses: [
        { respondedAt: new Date(NOW.getTime() - 5 * 86400000), values: { stress_level: 4, sleep_hours: 6 } },
        { respondedAt: new Date(NOW.getTime() - 2 * 86400000), values: { stress_level: 2 } },
      ],
    });
    assert.equal(series[3].wellbeing.stress_level, 3, "(4+2)/2");
    assert.equal(series[3].wellbeing.sleep_hours, 6, "solo un dato, no se cuenta como 0 el otro");
    assert.equal(series[3].wellbeing.daily_steps, undefined, "campo no reportado: ausente");
  });

  // La serie da sesiones ABSOLUTAS y ya no un porcentaje: convertirlo en %
  // exigía saber cuántas sesiones tocaban por semana, dato que el modelo no
  // tiene (`Split` no guarda duración). Antes se dividía entre las sesiones
  // del último microciclo dando por hecho que duraba 7 días.
  await t.test("cuenta las sesiones de cada semana, sin convertirlas en porcentaje", () => {
    const series = buildWeeklySeries({
      ...base,
      workoutDates: [
        new Date(NOW.getTime() - 1 * 86400000),
        new Date(NOW.getTime() - 3 * 86400000),
      ],
    });
    assert.equal(series[3].sessions, 2);
    assert.equal(series[3].trainingAdherence, undefined);
  });

  await t.test("una semana sin entrenar es 0 sesiones, no un hueco", () => {
    const series = buildWeeklySeries({ ...base, workoutDates: [] });
    assert.equal(series[3].sessions, 0);
  });
});

test("buildComparison", async (t) => {
  await t.test("con menos de dos semanas no hay nada que comparar", () => {
    assert.equal(buildComparison(buildWeeklySeries({ weeks: 1, now: NOW })), null);
  });

  await t.test("compara la última semana contra la anterior con absoluto y porcentaje", () => {
    const series = buildWeeklySeries({
      weeks: 4,
      now: NOW,
      anthropometryEntries: [
        { date: isoDaysAgo(10), weight: 80 },
        { date: isoDaysAgo(3), weight: 78 },
      ],
    });
    const cmp = buildComparison(series);
    assert.equal(cmp.weightAverage.previous, 80);
    assert.equal(cmp.weightAverage.current, 78);
    assert.equal(cmp.weightAverage.absolute, -2);
    assert.equal(cmp.weightAverage.percentage, -2.5);
  });

  await t.test("una métrica que falta en una de las dos semanas NO se compara", () => {
    // Sin esto saldría "ha bajado 78 kg" contra una semana sin pesaje.
    const series = buildWeeklySeries({
      weeks: 4,
      now: NOW,
      anthropometryEntries: [{ date: isoDaysAgo(3), weight: 78 }],
    });
    assert.equal(buildComparison(series).weightAverage, null);
  });

  await t.test("los perímetros comparados llevan su etiqueta legible", () => {
    const series = buildWeeklySeries({
      weeks: 4,
      now: NOW,
      anthropometryEntries: [
        { date: isoDaysAgo(10), waist: 92 },
        { date: isoDaysAgo(3), waist: 90 },
      ],
    });
    const cmp = buildComparison(series);
    assert.equal(cmp.measurements.waist.label, "Cintura");
    assert.equal(cmp.measurements.waist.absolute, -2);
  });

  await t.test("sin perímetros ni bienestar comunes, esos bloques van en null", () => {
    const cmp = buildComparison(buildWeeklySeries({ weeks: 4, now: NOW }));
    assert.equal(cmp.measurements, null);
    assert.equal(cmp.wellbeing, null);
  });
});

test("buildWeightTrend", async (t) => {
  await t.test("primera semana con datos contra la última", () => {
    const series = buildWeeklySeries({
      weeks: 12,
      now: NOW,
      anthropometryEntries: [
        { date: isoDaysAgo(80), weight: 90 },
        { date: isoDaysAgo(2), weight: 85.5 },
      ],
    });
    const trend = buildWeightTrend(series);
    assert.equal(trend.absolute, -4.5);
    assert.equal(trend.percentage, -5);
    assert.equal(trend.weeksCovered, 2, "solo las semanas que tienen pesaje");
  });

  await t.test("con un solo pesaje no hay tendencia", () => {
    const series = buildWeeklySeries({
      weeks: 4,
      now: NOW,
      anthropometryEntries: [{ date: isoDaysAgo(2), weight: 85 }],
    });
    assert.equal(buildWeightTrend(series), null);
  });

  await t.test("sin pesajes tampoco", () => {
    assert.equal(buildWeightTrend(buildWeeklySeries({ weeks: 4, now: NOW })), null);
  });
});
