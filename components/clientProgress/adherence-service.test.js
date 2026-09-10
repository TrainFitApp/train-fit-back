const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeAdherence,
  nutritionDimension,
  trainingDimension,
  habitsDimension,
  checkinsDimension,
} = require("./adherence-service");

// La adherencia global es el número que el coach mira primero. Que mienta
// —hacia arriba o hacia abajo— es peor que no tenerlo: le hace ignorar a un
// cliente que se está descolgando, o perseguir a uno que va bien.

test("nutritionDimension", async (t) => {
  await t.test("con datos suficientes reporta el porcentaje y sobre cuántos días", () => {
    const d = nutritionDimension({ percentage: 82, daysWithData: 20, periodDays: 28 });
    assert.equal(d.applicable, true);
    assert.equal(d.percentage, 82);
    assert.equal(d.detail, "20 de 28 días con plan");
  });

  await t.test("con menos de 3 días de datos no aplica (un % sobre 2 días es ruido)", () => {
    assert.equal(nutritionDimension({ percentage: 100, daysWithData: 2, periodDays: 28 }).applicable, false);
  });

  await t.test("sin plan de nutrición no aplica — no es un 0%", () => {
    assert.equal(nutritionDimension(null).applicable, false);
    assert.equal(nutritionDimension({ percentage: null, daysWithData: 0, periodDays: 28 }).applicable, false);
  });
});

test("trainingDimension", async (t) => {
  // Un microciclo se mide en SESIONES, no en días: Split no guarda duración.
  // Antes se cogía el último micro y se multiplicaba por las semanas del
  // periodo, así que 2 micros de 2 sesiones (4 en total) se anunciaban como
  // "8 esperadas" — el número no salía del plan, salía de la extrapolación.
  await t.test("sesiones hechas frente a las del plan entero", () => {
    const d = trainingDimension({ completedSessions: 3, plannedTotal: 4 });
    assert.equal(d.percentage, 75);
    assert.equal(d.detail, "3 de 4 sesiones del plan");
  });

  await t.test("dos microciclos de dos sesiones son 4, no 8", () => {
    const d = trainingDimension({ completedSessions: 4, plannedTotal: 4 });
    assert.equal(d.percentage, 100);
    assert.equal(d.plannedTotal, 4);
  });

  await t.test("entrenar de más se topa en 100, no da 160%", () => {
    assert.equal(trainingDimension({ completedSessions: 20, plannedTotal: 12 }).percentage, 100);
  });

  await t.test("sin rutina asignada no aplica — el caso normal de un cliente solo de nutrición", () => {
    const d = trainingDimension({ completedSessions: 0, plannedTotal: 0 });
    assert.equal(d.applicable, false);
    assert.equal(d.reason, "sin_plan");
  });

  await t.test("cero sesiones con rutina asignada SÍ aplica, y es un 0% real", () => {
    const d = trainingDimension({ completedSessions: 0, plannedTotal: 12 });
    assert.equal(d.applicable, true);
    assert.equal(d.percentage, 0);
  });
});

test("habitsDimension", async (t) => {
  await t.test("cada hábito contra SUS días activos, no contra una ventana fija", () => {
    // Pasos lleva 28 días y cumplió 14 (50%); Agua lleva 4 y cumplió 3 (75%).
    // Media 63. Con el agregado viejo habría salido 17/(2×28) = 30%, hundido
    // por los 24 días en que Agua ni existía.
    const d = habitsDimension({
      habits: [
        { id: "1", label: "Pasos diarios", completions: 14, activeDays: 28 },
        { id: "2", label: "Agua", completions: 3, activeDays: 4 },
      ],
    });
    assert.equal(d.percentage, 63);
    assert.equal(d.breakdown.length, 2);
    assert.equal(d.breakdown[0].percentage, 50);
    assert.equal(d.breakdown[1].percentage, 75);
    assert.equal(d.breakdown[1].detail, "3 de 4 días");
  });

  await t.test("un hábito solo: el detalle es el suyo, no un recuento", () => {
    const d = habitsDimension({ habits: [{ id: "1", label: "Pasos", completions: 5, activeDays: 10 }] });
    assert.equal(d.percentage, 50);
    assert.equal(d.detail, "5 de 10 días");
  });

  await t.test("cumplir de más se topa en 100 por hábito", () => {
    const d = habitsDimension({ habits: [{ id: "1", label: "Agua", completions: 12, activeDays: 10 }] });
    assert.equal(d.breakdown[0].percentage, 100);
  });

  await t.test("sin hábitos asignados no aplica", () => {
    assert.equal(habitsDimension({ habits: [] }).applicable, false);
    assert.equal(habitsDimension({}).applicable, false);
  });

  await t.test("un hábito creado hoy (0 días activos) no cuenta todavía", () => {
    const d = habitsDimension({ habits: [{ id: "1", label: "Sueño", completions: 0, activeDays: 0 }] });
    assert.equal(d.applicable, false);
    assert.equal(d.reason, "sin_tareas");
  });
});

test("checkinsDimension", async (t) => {
  const NOW = new Date("2026-08-27T12:00:00.000Z");
  const haceDias = (n) => new Date(NOW.getTime() - n * 86400000);

  // Una ocurrencia = una solicitud real (CheckinRequest), no una semana
  // teórica sacada de una cadencia declarada. Ese cálculo teórico solo
  // entendía el sistema legacy y dejaba a los check-ins del calendario
  // fuera de la adherencia entera.
  const respondida = (dias) => ({
    scheduledAt: haceDias(dias),
    closesAt: haceDias(dias - 7),
    status: "responded",
  });
  const cerradaSinResponder = (dias) => ({
    scheduledAt: haceDias(dias),
    closesAt: haceDias(dias - 7),
    status: "pending",
  });

  await t.test("cuenta respondidas frente a las que se cerraron", () => {
    const d = checkinsDimension({
      requests: [respondida(1), respondida(8), respondida(15), cerradaSinResponder(22)],
      periodDays: 28,
      now: NOW,
    });
    assert.equal(d.percentage, 75);
    assert.equal(d.detail, "3 de 4 check-ins respondidos");
    assert.equal(d.missed, 1);
  });

  // La que sigue abierta no puede contar como fallo: el cliente está a
  // tiempo de responderla hoy mismo.
  await t.test("una solicitud todavía abierta no entra en el denominador", () => {
    const abierta = { scheduledAt: haceDias(1), closesAt: haceDias(-6), status: "pending" };
    const d = checkinsDimension({
      requests: [abierta, respondida(8)],
      periodDays: 28,
      now: NOW,
    });
    assert.equal(d.expectedCycles, 1);
    assert.equal(d.percentage, 100);
  });

  // La cancela el entrenador, no el cliente: no es un incumplimiento suyo.
  await t.test("una cancelada no cuenta ni a favor ni en contra", () => {
    const cancelada = { scheduledAt: haceDias(8), closesAt: haceDias(1), status: "cancelled" };
    const d = checkinsDimension({
      requests: [cancelada, respondida(15)],
      periodDays: 28,
      now: NOW,
    });
    assert.equal(d.expectedCycles, 1);
    assert.equal(d.percentage, 100);
  });

  await t.test("una revisada cuenta igual que una respondida", () => {
    const revisada = { scheduledAt: haceDias(8), closesAt: haceDias(1), status: "reviewed" };
    const d = checkinsDimension({ requests: [revisada], periodDays: 28, now: NOW });
    assert.equal(d.percentage, 100);
  });

  await t.test("marcada 'unanswered' cuenta como perdida aunque no tenga cierre", () => {
    const perdida = { scheduledAt: haceDias(8), closesAt: null, status: "unanswered" };
    const d = checkinsDimension({ requests: [perdida], periodDays: 28, now: NOW });
    assert.equal(d.percentage, 0);
    assert.equal(d.missed, 1);
  });

  await t.test("sin check-in programado no aplica", () => {
    assert.equal(checkinsDimension({ requests: [], periodDays: 28, now: NOW }).applicable, false);
    assert.equal(checkinsDimension({ requests: [], periodDays: 28, now: NOW }).reason, "sin_cadencia");
  });

  await t.test("programado pero sin ninguna ocurrencia cerrada todavía", () => {
    const abierta = { scheduledAt: haceDias(1), closesAt: haceDias(-6), status: "pending" };
    const d = checkinsDimension({ requests: [abierta], periodDays: 28, now: NOW });
    assert.equal(d.applicable, false);
    assert.equal(d.reason, "periodo_corto");
  });

  await t.test("una ocurrencia futura no se le debe a nadie todavía", () => {
    const futura = { scheduledAt: haceDias(-3), closesAt: haceDias(-10), status: "pending" };
    const d = checkinsDimension({ requests: [futura], periodDays: 28, now: NOW });
    assert.equal(d.applicable, false);
  });
});

const NOW_TEST = new Date("2026-08-27T12:00:00.000Z");

test("computeAdherence", async (t) => {
  await t.test("promedia SOLO las dimensiones aplicables", () => {
    // Cliente solo de nutrición al 80%: sin entrenamiento, sin tareas, sin
    // check-in. Debe salir 80, no 20.
    const result = computeAdherence({
      nutrition: { percentage: 80, daysWithData: 20, periodDays: 28 },
      training: { completedSessions: 0, plannedTotal: 0 },
      habits: { habits: [] },
      checkins: { requests: [], periodDays: 28 },
    });
    assert.equal(result.overall, 80);
    assert.equal(result.applicableCount, 1);
  });

  await t.test("con cuatro dimensiones activas promedia las cuatro", () => {
    const result = computeAdherence({
      nutrition: { percentage: 100, daysWithData: 28, periodDays: 28 },
      training: { completedSessions: 12, plannedTotal: 12 }, // 100
      habits: { habits: [{ id: "1", label: "Pasos", completions: 28, activeDays: 28 }] }, // 100
      checkins: {
        requests: [{ scheduledAt: new Date(NOW_TEST.getTime() - 8 * 86400000), closesAt: new Date(NOW_TEST.getTime() - 1 * 86400000), status: "responded" }, { scheduledAt: new Date(NOW_TEST.getTime() - 15 * 86400000), closesAt: new Date(NOW_TEST.getTime() - 8 * 86400000), status: "responded" }, { scheduledAt: new Date(NOW_TEST.getTime() - 22 * 86400000), closesAt: new Date(NOW_TEST.getTime() - 15 * 86400000), status: "pending" }, { scheduledAt: new Date(NOW_TEST.getTime() - 29 * 86400000), closesAt: new Date(NOW_TEST.getTime() - 22 * 86400000), status: "pending" }],
        periodDays: 28,
        now: NOW_TEST,
      }, // 2 respondidas de 4 cerradas -> 50
    });
    assert.equal(result.overall, 88); // (100+100+100+50)/4 = 87,5 -> 88
    assert.equal(result.applicableCount, 4);
  });

  await t.test("señala DÓNDE falla, no solo la media", () => {
    const result = computeAdherence({
      nutrition: { percentage: 95, daysWithData: 28, periodDays: 28 },
      training: { completedSessions: 3, plannedTotal: 12 }, // 25
      habits: { habits: [] },
      checkins: {
        requests: [8, 16, 24].map((d) => ({
          scheduledAt: new Date(NOW_TEST.getTime() - d * 86400000),
          closesAt: new Date(NOW_TEST.getTime() - (d - 7) * 86400000),
          status: "responded",
        })),
        periodDays: 28,
        now: NOW_TEST,
      }, // 100
    });
    // La media (73%) parece aceptable; el problema real es el entrenamiento.
    assert.equal(result.weakest, "training");
    assert.equal(result.dimensions.training.percentage, 25);
  });

  await t.test("un cliente sin ningún dato da overall null, nunca 0", () => {
    const result = computeAdherence({
      nutrition: null,
      training: { completedSessions: 0, plannedTotal: 0 },
      habits: { habits: [] },
      checkins: { requests: [], periodDays: 28 },
    });
    assert.equal(result.overall, null);
    assert.equal(result.weakest, null);
    assert.equal(result.applicableCount, 0);
  });

  await t.test("siempre devuelve las 4 dimensiones, aplicables o no", () => {
    const result = computeAdherence({ nutrition: null });
    assert.deepEqual(Object.keys(result.dimensions), ["nutrition", "training", "habits", "checkins"]);
    for (const dim of Object.values(result.dimensions)) {
      assert.equal(typeof dim.applicable, "boolean");
      if (!dim.applicable) assert.equal(typeof dim.reason, "string");
    }
  });
});
