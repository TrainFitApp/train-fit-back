const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SIGNAL_THRESHOLDS,
  TRACKED_PERIMETERS,
  buildSignalsForClient,
  detectStagnation,
  detectSharpWeightChange,
  detectSharpMeasurementChange,
  detectLowAdherence,
  detectInactivity,
  detectNoTrainingActivity,
  detectCheckinOverdue,
  detectPendingReview,
} = require("./coach-signals-service");

const NOW = new Date("2026-08-23T05:00:00.000Z");

function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

// Dos formas distintas del mismo dato, y no son intercambiables:
//   - weightEntries: como sale de la BD (anthropometryDao.listForUsersSince),
//     con el nombre del campo real. Es lo que recibe buildSignalsForClient.
//   - weightSeries: ya normalizado a {date, value} por seriesFor(). Es lo que
//     reciben los detectores individuales.
// Confundirlas no revienta: los detectores leen `undefined` y siguen
// calculando, así que los porcentajes salen NaN sin que nada falle — de ahí
// la comprobación explícita de "sin NaN" más abajo.
function weightEntries(pairs) {
  return pairs.map(([daysAgo, weight]) => ({ date: isoDaysAgo(daysAgo), weight }));
}

function weightSeries(pairs) {
  return pairs.map(([daysAgo, value]) => ({ date: isoDaysAgo(daysAgo), value }));
}

function goodAdherence(percentage = 90, daysWithData = 20) {
  return { percentage, daysWithData, periodDays: 28 };
}

// Las señales deciden a qué clientes mira un profesional cada mañana. Un
// falso positivo le hace perder el tiempo; un falso negativo le esconde un
// cliente que se está descolgando. Los límites de cada umbral se prueban por
// los dos lados.

test("detectStagnation", async (t) => {
  const base = { clientName: "Juan", adherence: goodAdherence(91) };

  await t.test("3 semanas sin mover el peso con buena adherencia -> alerta", () => {
    const signal = detectStagnation({
      ...base,
      weightSeries: weightSeries([[21, 80], [0, 80.2]]),
    });
    assert.ok(signal);
    assert.equal(signal.type, "stagnation");
    assert.equal(signal.priority, "medium");
    assert.equal(signal.context.weeks, 3);
    assert.match(signal.reason, /Juan lleva 3 semanas sin cambios de peso/);
    assert.match(signal.reason, /91%/);
  });

  await t.test("menos de 3 semanas -> todavía no es estancamiento", () => {
    assert.equal(
      detectStagnation({ ...base, weightSeries: weightSeries([[13, 80], [0, 80.1]]) }),
      null
    );
  });

  await t.test("el peso SÍ se ha movido por encima del umbral -> sin alerta", () => {
    // 80 -> 81 = +1,25%, por encima del 0,5%
    assert.equal(
      detectStagnation({ ...base, weightSeries: weightSeries([[21, 80], [0, 81]]) }),
      null
    );
  });

  await t.test("baja adherencia -> NO es estancamiento (el problema es cumplir)", () => {
    assert.equal(
      detectStagnation({
        ...base,
        adherence: goodAdherence(40),
        weightSeries: weightSeries([[21, 80], [0, 80.1]]),
      }),
      null
    );
  });

  await t.test("adherencia con muy pocos días registrados -> no se afirma nada", () => {
    assert.equal(
      detectStagnation({
        ...base,
        adherence: goodAdherence(100, 3),
        weightSeries: weightSeries([[21, 80], [0, 80.1]]),
      }),
      null
    );
  });

  await t.test("sin adherencia disponible -> no se afirma nada", () => {
    assert.equal(
      detectStagnation({ ...base, adherence: null, weightSeries: weightSeries([[21, 80], [0, 80.1]]) }),
      null
    );
  });

  await t.test("un solo registro de peso -> no hay tendencia que calcular", () => {
    assert.equal(detectStagnation({ ...base, weightSeries: weightSeries([[0, 80]]) }), null);
  });

  await t.test("estancamiento hacia arriba también cuenta (sin dirección de objetivo)", () => {
    const signal = detectStagnation({
      ...base,
      weightSeries: weightSeries([[28, 80], [0, 79.8]]),
    });
    assert.ok(signal);
    assert.equal(signal.context.weeks, 4);
  });
});

test("detectSharpWeightChange", async (t) => {
  await t.test("bajada de más del 2% semanal -> alerta de prioridad alta", () => {
    // 80 -> 77,5 en 7 días = -3,1% semanal
    const signal = detectSharpWeightChange({
      clientName: "Ana",
      weightSeries: weightSeries([[7, 80], [0, 77.5]]),
    });
    assert.ok(signal);
    assert.equal(signal.type, "weight_change");
    assert.equal(signal.priority, "high");
    assert.match(signal.reason, /Ana ha bajado 2,5 kg en 7 días/);
  });

  await t.test("subida brusca también alerta, con el verbo correcto", () => {
    const signal = detectSharpWeightChange({
      clientName: "Ana",
      weightSeries: weightSeries([[7, 70], [0, 72.5]]),
    });
    assert.ok(signal);
    assert.match(signal.reason, /ha subido/);
  });

  await t.test("fluctuación normal (menos del 2% semanal) -> sin alerta", () => {
    assert.equal(
      detectSharpWeightChange({
        clientName: "Ana",
        weightSeries: weightSeries([[7, 80], [0, 79]]),
      }),
      null
    );
  });

  await t.test("normaliza a semana: 2% en 14 días NO es brusco", () => {
    // 80 -> 78,4 = -2% total, pero en 2 semanas = -1% semanal
    assert.equal(
      detectSharpWeightChange({
        clientName: "Ana",
        weightSeries: weightSeries([[14, 80], [0, 78.4]]),
      }),
      null
    );
  });

  await t.test("elige el registro más cercano a 7 días atrás, no el más antiguo", () => {
    // El de hace 28 días daría una variación semanal pequeña; el de hace 7
    // días es el que revela el cambio brusco.
    const signal = detectSharpWeightChange({
      clientName: "Ana",
      weightSeries: weightSeries([[28, 85], [7, 80], [0, 77.5]]),
    });
    assert.ok(signal);
    assert.equal(signal.context.periodDays, 7);
  });
});

test("detectSharpMeasurementChange", async (t) => {
  const entries = (pairs) => pairs.map(([daysAgo, waist]) => ({ date: isoDaysAgo(daysAgo), waist }));

  await t.test("cintura con más del 3% de variación -> alerta con la etiqueta del catálogo", () => {
    const signal = detectSharpMeasurementChange({
      clientName: "Luis",
      entries: entries([[14, 90], [0, 86]]),
    });
    assert.ok(signal);
    assert.equal(signal.type, "measurement_change");
    assert.equal(signal.context.metric, "waist");
    assert.equal(signal.context.metricLabel, "Cintura");
    assert.match(signal.reason, /Cintura de Luis ha bajado 4,0 cm/);
  });

  await t.test("variación pequeña (error de medición) -> sin alerta", () => {
    assert.equal(
      detectSharpMeasurementChange({ clientName: "Luis", entries: entries([[14, 90], [0, 89]]) }),
      null
    );
  });

  await t.test("varios perímetros desviados -> UNA sola alerta, la de mayor variación", () => {
    const signal = detectSharpMeasurementChange({
      clientName: "Luis",
      entries: [
        { date: isoDaysAgo(14), waist: 90, chest: 100 },
        { date: isoDaysAgo(0), waist: 86, chest: 94 }, // cintura -4,4%, pecho -6%
      ],
    });
    assert.ok(signal);
    assert.equal(signal.context.metric, "chest");
  });

  await t.test("el catálogo de perímetros vigilados no está vacío ni trae composición corporal", () => {
    assert.ok(TRACKED_PERIMETERS.length > 0);
    const keys = TRACKED_PERIMETERS.map((p) => p.key);
    assert.ok(keys.includes("waist"));
    assert.ok(!keys.includes("fatMass"));
  });
});

test("detectLowAdherence", async (t) => {
  await t.test("por debajo del 70% -> alerta media", () => {
    const signal = detectLowAdherence({ clientName: "Eva", adherence: goodAdherence(65) });
    assert.ok(signal);
    assert.equal(signal.priority, "medium");
    assert.match(signal.reason, /Eva está cumpliendo el 65%/);
  });

  await t.test("por debajo del 50% -> prioridad alta", () => {
    assert.equal(
      detectLowAdherence({ clientName: "Eva", adherence: goodAdherence(30) }).priority,
      "high"
    );
  });

  await t.test("justo en el umbral (70%) -> sin alerta", () => {
    assert.equal(detectLowAdherence({ clientName: "Eva", adherence: goodAdherence(70) }), null);
  });

  await t.test("pocos días registrados -> el porcentaje no es fiable todavía", () => {
    assert.equal(detectLowAdherence({ clientName: "Eva", adherence: goodAdherence(10, 2) }), null);
  });

  await t.test("sin datos de adherencia -> sin alerta", () => {
    assert.equal(detectLowAdherence({ clientName: "Eva", adherence: null }), null);
  });
});

test("detectInactivity", async (t) => {
  await t.test("14 días sin actividad -> alerta media", () => {
    const signal = detectInactivity({
      clientName: "Marc",
      now: NOW,
      lastActivityAt: new Date(NOW.getTime() - 14 * 86400000),
    });
    assert.ok(signal);
    assert.equal(signal.priority, "medium");
    assert.match(signal.reason, /Marc lleva 14 días sin registrar nada/);
  });

  await t.test("21 días o más -> prioridad alta", () => {
    assert.equal(
      detectInactivity({
        clientName: "Marc",
        now: NOW,
        lastActivityAt: new Date(NOW.getTime() - 25 * 86400000),
      }).priority,
      "high"
    );
  });

  await t.test("actividad reciente -> sin alerta", () => {
    assert.equal(
      detectInactivity({
        clientName: "Marc",
        now: NOW,
        lastActivityAt: new Date(NOW.getTime() - 3 * 86400000),
      }),
      null
    );
  });

  await t.test("sin ninguna actividad conocida -> sin alerta (no se inventa antigüedad)", () => {
    assert.equal(detectInactivity({ clientName: "Marc", now: NOW, lastActivityAt: null }), null);
  });
});

test("detectNoTrainingActivity", async (t) => {
  await t.test("sin rutina asignada -> sin alerta, aunque no haya sesiones", () => {
    assert.equal(
      detectNoTrainingActivity({
        clientName: "Marc",
        now: NOW,
        hasRoutine: false,
        workoutDates: [],
        lastActivityAt: new Date(NOW.getTime() - 30 * 86400000),
      }),
      null
    );
  });

  await t.test("rutina asignada, última sesión hace 14 días -> alerta media", () => {
    const signal = detectNoTrainingActivity({
      clientName: "Marc",
      now: NOW,
      hasRoutine: true,
      workoutDates: [isoDaysAgo(14), isoDaysAgo(20)],
      lastActivityAt: NOW,
    });
    assert.ok(signal);
    assert.equal(signal.priority, "medium");
    assert.match(signal.reason, /no ha completado ninguna sesión en 14 días/);
  });

  await t.test("21 días o más sin sesión -> prioridad alta", () => {
    assert.equal(
      detectNoTrainingActivity({
        clientName: "Marc",
        now: NOW,
        hasRoutine: true,
        workoutDates: [isoDaysAgo(25)],
        lastActivityAt: NOW,
      }).priority,
      "high"
    );
  });

  await t.test("sesión reciente -> sin alerta", () => {
    assert.equal(
      detectNoTrainingActivity({
        clientName: "Marc",
        now: NOW,
        hasRoutine: true,
        workoutDates: [isoDaysAgo(2)],
        lastActivityAt: NOW,
      }),
      null
    );
  });

  // Caso real que motivó esta prueba: rutina asignada hace minutos, cero
  // sesiones porque no ha habido tiempo de hacer ninguna todavía. Sin
  // lastActivityAt que respalde una antigüedad real, no se asume el peor
  // caso (mismo criterio que detectInactivity con lastActivityAt: null).
  await t.test("rutina recién asignada, sin sesiones ni otra actividad -> sin alerta", () => {
    assert.equal(
      detectNoTrainingActivity({
        clientName: "Marc",
        now: NOW,
        hasRoutine: true,
        workoutDates: [],
        lastActivityAt: null,
      }),
      null
    );
  });

  await t.test("nunca ha entrenado, pero SÍ hay actividad de sobra en otros lados -> alerta", () => {
    const signal = detectNoTrainingActivity({
      clientName: "Marc",
      now: NOW,
      hasRoutine: true,
      workoutDates: [],
      lastActivityAt: new Date(NOW.getTime() - 25 * 86400000),
    });
    assert.ok(signal);
    assert.equal(signal.priority, "high");
    assert.match(signal.reason, /no ha completado ninguna sesión registrada/);
  });
});

test("detectCheckinOverdue", async (t) => {
  // Una solicitud está vencida cuando su VENTANA se cerró vacía (la cuenta
  // checkin-agenda-service.js#missedOccurrences), no por días transcurridos
  // desde la última respuesta.
  await t.test("nunca respondido -> alerta con frase de primer check-in", () => {
    const signal = detectCheckinOverdue({
      clientName: "Sara",
      now: NOW,
      checkin: { missed: 1, lastResponseAt: null },
    });
    assert.ok(signal);
    assert.match(signal.reason, /todavía no ha respondido a ningún check-in/);
  });

  await t.test("una solicitud vencida -> prioridad media", () => {
    const signal = detectCheckinOverdue({
      clientName: "Sara",
      now: NOW,
      checkin: { missed: 1, lastResponseAt: new Date(NOW.getTime() - 8 * 86400000) },
    });
    assert.equal(signal.priority, "medium");
    assert.equal(signal.context.missed, 1);
  });

  await t.test("dos solicitudes o más vencidas -> prioridad alta", () => {
    const signal = detectCheckinOverdue({
      clientName: "Sara",
      now: NOW,
      checkin: { missed: 2, lastResponseAt: new Date(NOW.getTime() - 20 * 86400000) },
    });
    assert.equal(signal.priority, "high");
    assert.equal(signal.context.missed, 2);
  });

  await t.test("ninguna ventana cerrada vacía -> sin alerta", () => {
    assert.equal(
      detectCheckinOverdue({
        clientName: "Sara",
        now: NOW,
        checkin: { missed: 0, lastResponseAt: new Date(NOW.getTime() - 3 * 86400000) },
      }),
      null
    );
  });

  await t.test("sin check-in configurado -> sin alerta", () => {
    assert.equal(detectCheckinOverdue({ clientName: "Sara", now: NOW, checkin: null }), null);
  });
});

test("detectPendingReview", async (t) => {
  await t.test("cuestionario en revisión -> prioridad alta (bloquea al cliente)", () => {
    const signal = detectPendingReview({ clientName: "Nil", relationStatus: "en_revision" });
    assert.ok(signal);
    assert.equal(signal.priority, "high");
  });

  await t.test("relación activa -> nada que revisar", () => {
    assert.equal(detectPendingReview({ clientName: "Nil", relationStatus: "active" }), null);
  });
});

test("buildSignalsForClient", async (t) => {
  await t.test("cliente que va bien -> ninguna señal", () => {
    const signals = buildSignalsForClient({
      clientName: "Ok",
      relationStatus: "active",
      now: NOW,
      entries: weightEntries([[21, 80], [0, 78.5]]),
      adherence: goodAdherence(95),
      checkin: { missed: 0, lastResponseAt: new Date(NOW.getTime() - 86400000) },
      lastActivityAt: NOW,
    });
    assert.deepEqual(signals, []);
  });

  await t.test("cliente con varios problemas -> varias señales, sin duplicar tipo", () => {
    const signals = buildSignalsForClient({
      clientName: "Problemas",
      relationStatus: "active",
      now: NOW,
      entries: weightEntries([[21, 80], [0, 80.1]]),
      adherence: goodAdherence(85),
      checkin: { missed: 3, lastResponseAt: new Date(NOW.getTime() - 30 * 86400000) },
      lastActivityAt: new Date(NOW.getTime() - 30 * 86400000),
    });

    const types = signals.map((s) => s.type);
    assert.ok(types.includes("stagnation"));
    assert.ok(types.includes("checkin_overdue"));
    assert.ok(types.includes("inactive_client"));
    assert.equal(new Set(types).size, types.length, "ningún tipo repetido");
  });

  await t.test("cliente en revisión -> solo la señal de cuestionario", () => {
    const signals = buildSignalsForClient({
      clientName: "Nuevo",
      relationStatus: "en_revision",
      now: NOW,
      entries: [],
    });
    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, "pending_review");
  });

  await t.test("toda señal trae los campos que CoachAlert exige como obligatorios", () => {
    const signals = buildSignalsForClient({
      clientName: "Test",
      relationStatus: "active",
      now: NOW,
      entries: weightEntries([[21, 80], [7, 80], [0, 76]]),
      adherence: goodAdherence(30),
      checkin: { missed: 2, lastResponseAt: null },
      lastActivityAt: new Date(NOW.getTime() - 20 * 86400000),
    });

    assert.ok(signals.length > 0, "el caso de prueba debe generar señales");
    for (const signal of signals) {
      assert.equal(typeof signal.type, "string");
      assert.ok(["high", "medium", "low"].includes(signal.priority));
      assert.ok(signal.reason.length > 0 && signal.reason.length <= 300);
      assert.equal(typeof signal.context, "object");
      // Ninguna frase puede llegar al coach con un NaN dentro. Es el fallo
      // silencioso de esta clase de código: un campo mal nombrado no lanza,
      // solo produce aritmética con undefined y una frase sin sentido.
      assert.doesNotMatch(signal.reason, /NaN|undefined|null/);
      for (const value of Object.values(signal.context)) {
        assert.ok(!Number.isNaN(value), `context.${value} no puede ser NaN`);
      }
    }
  });
});

test("SIGNAL_THRESHOLDS es coherente consigo mismo", async (t) => {
  await t.test("el umbral crítico de adherencia es más bajo que el de aviso", () => {
    assert.ok(SIGNAL_THRESHOLDS.criticalAdherencePct < SIGNAL_THRESHOLDS.lowAdherencePct);
  });

  await t.test("el estancamiento exige más adherencia que el umbral de 'baja adherencia'", () => {
    // Si no, un mismo cliente podría disparar las dos alertas a la vez con
    // diagnósticos contradictorios ("cumple pero no avanza" + "no cumple").
    assert.ok(SIGNAL_THRESHOLDS.stagnation.minAdherencePct >= SIGNAL_THRESHOLDS.lowAdherencePct);
  });

  await t.test("la ventana de análisis cubre el mínimo de semanas del estancamiento", () => {
    assert.ok(SIGNAL_THRESHOLDS.analysisWindowDays >= SIGNAL_THRESHOLDS.stagnation.minWeeks * 7);
  });

  await t.test("el umbral crítico de inactividad es mayor que el de aviso", () => {
    assert.ok(SIGNAL_THRESHOLDS.inactiveCriticalDays > SIGNAL_THRESHOLDS.inactiveDays);
  });
});
