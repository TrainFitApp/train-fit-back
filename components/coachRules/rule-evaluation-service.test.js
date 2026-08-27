const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_CLIENTS_AFFECTED_PER_RUN,
  compare,
  evaluateCondition,
  evaluateRule,
  buildEvidence,
  shouldEvaluateClient,
} = require("./rule-evaluation-service");
const { RULE_METRICS_BY_KEY, toCatalogDto } = require("./rule-metric-catalog");

const NOW = new Date("2026-08-23T05:00:00.000Z");

function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

function snapshot(overrides = {}) {
  return {
    clientId: "c1",
    now: NOW,
    entries: [],
    checkinResponses: [],
    relationStatus: "active",
    ...overrides,
  };
}

// Un motor de reglas que se dispara por falta de datos es peor que no
// tenerlo: le dice al coach que un cliente está estancado sin saber si se ha
// pesado. Ese es el caso que más se prueba aquí.

test("compare", async (t) => {
  await t.test("un valor no resuelto (sin datos) NUNCA cumple", () => {
    for (const op of ["gt", "lt", "dropped_more_than_pct", "changed_less_than_pct"]) {
      assert.equal(compare(null, op, 10), false, `${op} con null`);
    }
  });

  await t.test("una condición de variación con un solo dato no cumple", () => {
    // current sí existe, pero changePct es null: no hay variación que juzgar.
    assert.equal(compare({ current: 80, changePct: null }, "dropped_more_than_pct", 2), false);
    assert.equal(compare({ current: 80, changePct: null }, "changed_less_than_pct", 2), false);
  });

  await t.test("comparaciones directas", () => {
    assert.equal(compare({ current: 90, changePct: null }, "gt", 85), true);
    assert.equal(compare({ current: 85, changePct: null }, "gt", 85), false);
    assert.equal(compare({ current: 85, changePct: null }, "gte", 85), true);
    assert.equal(compare({ current: 60, changePct: null }, "lt", 70), true);
  });

  await t.test("'ha bajado más de X%' usa el signo correcto", () => {
    assert.equal(compare({ current: 78, changePct: -3 }, "dropped_more_than_pct", 2), true);
    assert.equal(compare({ current: 79, changePct: -1 }, "dropped_more_than_pct", 2), false);
    // Subir no es bajar.
    assert.equal(compare({ current: 82, changePct: 3 }, "dropped_more_than_pct", 2), false);
  });

  await t.test("'ha bajado menos de X%' incluye no haber bajado y haber subido", () => {
    // Es como un coach describe un estancamiento: "no me baja del 0,25%".
    assert.equal(compare({ current: 80, changePct: -0.1 }, "dropped_less_than_pct", 0.25), true);
    assert.equal(compare({ current: 80, changePct: 0 }, "dropped_less_than_pct", 0.25), true);
    assert.equal(compare({ current: 81, changePct: 1.2 }, "dropped_less_than_pct", 0.25), true);
    assert.equal(compare({ current: 78, changePct: -3 }, "dropped_less_than_pct", 0.25), false);
  });

  await t.test("'apenas ha cambiado' es simétrico en las dos direcciones", () => {
    assert.equal(compare({ current: 80, changePct: 0.3 }, "changed_less_than_pct", 0.5), true);
    assert.equal(compare({ current: 80, changePct: -0.3 }, "changed_less_than_pct", 0.5), true);
    assert.equal(compare({ current: 80, changePct: 1.2 }, "changed_less_than_pct", 0.5), false);
  });

  await t.test("un operador desconocido no cumple, no revienta", () => {
    assert.equal(compare({ current: 80, changePct: 0 }, "inventado", 1), false);
  });
});

test("resolutores del catálogo", async (t) => {
  await t.test("peso: current y variación sobre el periodo", () => {
    const metric = RULE_METRICS_BY_KEY.get("weight");
    const resolved = metric.resolve(
      snapshot({ entries: [{ date: isoDaysAgo(14), weight: 80 }, { date: isoDaysAgo(1), weight: 78 }] }),
      14
    );
    assert.equal(resolved.current, 78);
    assert.equal(Math.round(resolved.changePct * 100) / 100, -2.5);
  });

  await t.test("peso: registros fuera del periodo quedan excluidos", () => {
    const metric = RULE_METRICS_BY_KEY.get("weight");
    const resolved = metric.resolve(
      snapshot({ entries: [{ date: isoDaysAgo(40), weight: 90 }, { date: isoDaysAgo(1), weight: 78 }] }),
      14
    );
    // El de hace 40 días no cuenta: solo queda uno, así que no hay variación.
    assert.equal(resolved.current, 78);
    assert.equal(resolved.changePct, null);
  });

  await t.test("peso sin registros -> null", () => {
    assert.equal(RULE_METRICS_BY_KEY.get("weight").resolve(snapshot(), 14), null);
  });

  await t.test("bienestar: promedia el periodo", () => {
    const metric = RULE_METRICS_BY_KEY.get("wellbeing_stress_level");
    const resolved = metric.resolve(
      snapshot({
        checkinResponses: [
          { respondedAt: new Date(NOW.getTime() - 3 * 86400000), values: { stress_level: 4 } },
          { respondedAt: new Date(NOW.getTime() - 1 * 86400000), values: { stress_level: 2 } },
        ],
      }),
      14
    );
    assert.equal(resolved.current, 3);
  });

  await t.test("perímetros existen como métrica con etiqueta legible", () => {
    const metric = RULE_METRICS_BY_KEY.get("perimeter_waist");
    assert.ok(metric);
    assert.equal(metric.label, "Cintura");
  });

  await t.test("días sin check-in", () => {
    const metric = RULE_METRICS_BY_KEY.get("days_since_checkin");
    const resolved = metric.resolve(
      snapshot({ lastResponseAt: new Date(NOW.getTime() - 10 * 86400000) })
    );
    assert.equal(resolved.current, 10);
    assert.equal(metric.resolve(snapshot({ lastResponseAt: null })), null);
  });

  await t.test("adherencia nutricional sin datos -> null, no 0", () => {
    const metric = RULE_METRICS_BY_KEY.get("nutrition_adherence");
    assert.equal(metric.resolve(snapshot({ adherence: { percentage: null } })), null);
    assert.equal(metric.resolve(snapshot({ adherence: { percentage: 82 } })).current, 82);
  });

  await t.test("el catálogo servido a la UI no lleva funciones y sí operadores", () => {
    const dto = toCatalogDto();
    assert.ok(dto.metrics.length > 10);
    assert.ok(dto.periods.length > 0);
    for (const metric of dto.metrics) {
      assert.equal(metric.resolve, undefined, "resolve no es serializable");
      assert.ok(Array.isArray(metric.operators) && metric.operators.length > 0);
    }
    // El estrés no debe ofrecer operadores de variación porcentual.
    const stress = dto.metrics.find((m) => m.key === "wellbeing_stress_level");
    assert.ok(!stress.operators.some((o) => o.key === "dropped_more_than_pct"));
  });
});

test("evaluateRule", async (t) => {
  // El ejemplo literal de la especificación:
  // SI peso apenas baja Y adherencia > 85% durante 2 semanas -> estancamiento
  const stagnationRule = {
    conditionLogic: "all",
    conditions: [
      { metric: "weight", operator: "dropped_less_than_pct", value: 0.25, periodDays: 14 },
      { metric: "nutrition_adherence", operator: "gt", value: 85, periodDays: 14 },
    ],
  };

  await t.test("se cumple cuando encajan las dos condiciones", () => {
    const result = evaluateRule(
      stagnationRule,
      snapshot({
        entries: [{ date: isoDaysAgo(14), weight: 80 }, { date: isoDaysAgo(1), weight: 79.95 }],
        adherence: { percentage: 91 },
      })
    );
    assert.equal(result.met, true);
  });

  await t.test("NO se cumple si el peso sí bajó", () => {
    const result = evaluateRule(
      stagnationRule,
      snapshot({
        entries: [{ date: isoDaysAgo(14), weight: 80 }, { date: isoDaysAgo(1), weight: 77 }],
        adherence: { percentage: 91 },
      })
    );
    assert.equal(result.met, false);
  });

  await t.test("con logic 'all', una condición sin datos tumba la regla entera", () => {
    // Sin adherencia no se puede afirmar "estancado PESE A cumplir".
    const result = evaluateRule(
      stagnationRule,
      snapshot({
        entries: [{ date: isoDaysAgo(14), weight: 80 }, { date: isoDaysAgo(1), weight: 79.95 }],
        adherence: { percentage: null },
      })
    );
    assert.equal(result.met, false);
    assert.equal(result.conditions[1].reason, "sin_datos");
  });

  await t.test("con logic 'any' basta una condición cumplida", () => {
    const result = evaluateRule(
      { ...stagnationRule, conditionLogic: "any" },
      snapshot({ entries: [], adherence: { percentage: 91 } })
    );
    assert.equal(result.met, true);
  });

  await t.test("una regla con métrica inexistente no cumple, no revienta", () => {
    const result = evaluateRule(
      { conditionLogic: "all", conditions: [{ metric: "no_existe", operator: "gt", value: 1 }] },
      snapshot()
    );
    assert.equal(result.met, false);
    assert.equal(result.conditions[0].reason, "metrica_desconocida");
  });
});

test("buildEvidence", async (t) => {
  await t.test("compone los números que dispararon la regla", () => {
    const evaluation = evaluateRule(
      {
        conditionLogic: "all",
        conditions: [
          { metric: "weight", operator: "dropped_less_than_pct", value: 0.25, periodDays: 14 },
          { metric: "nutrition_adherence", operator: "gt", value: 85, periodDays: 14 },
        ],
      },
      snapshot({
        entries: [{ date: isoDaysAgo(14), weight: 80 }, { date: isoDaysAgo(1), weight: 80 }],
        adherence: { percentage: 91 },
      })
    );
    const evidence = buildEvidence(evaluation);
    assert.match(evidence, /Peso/);
    assert.match(evidence, /Adherencia nutricional: 91/);
    assert.doesNotMatch(evidence, /NaN|undefined/);
  });

  await t.test("sin condiciones cumplidas devuelve cadena vacía", () => {
    assert.equal(buildEvidence({ conditions: [{ met: false, resolved: null }] }), "");
  });
});

test("shouldEvaluateClient", async (t) => {
  await t.test("trigger 'daily' evalúa siempre", () => {
    assert.equal(shouldEvaluateClient({ trigger: "daily", appliesTo: "all_clients" }, snapshot()), true);
  });

  await t.test("'after_checkin' salta a quien no ha reportado desde la última pasada", () => {
    const rule = {
      trigger: "after_checkin",
      appliesTo: "all_clients",
      lastEvaluatedAt: new Date(NOW.getTime() - 2 * 86400000),
    };
    assert.equal(
      shouldEvaluateClient(rule, snapshot({ lastResponseAt: new Date(NOW.getTime() - 1 * 86400000) })),
      true
    );
    assert.equal(
      shouldEvaluateClient(rule, snapshot({ lastResponseAt: new Date(NOW.getTime() - 5 * 86400000) })),
      false
    );
    assert.equal(shouldEvaluateClient(rule, snapshot({ lastResponseAt: null })), false);
  });

  await t.test("sin evaluación previa, cualquier trigger corre la primera vez", () => {
    const rule = { trigger: "after_checkin", appliesTo: "all_clients", lastEvaluatedAt: null };
    assert.equal(
      shouldEvaluateClient(rule, snapshot({ lastResponseAt: new Date(NOW.getTime() - 90 * 86400000) })),
      true
    );
  });

  await t.test("'after_measurement' mira la última entrada de antropometría", () => {
    const rule = {
      trigger: "after_measurement",
      appliesTo: "all_clients",
      lastEvaluatedAt: new Date(NOW.getTime() - 3 * 86400000),
    };
    assert.equal(shouldEvaluateClient(rule, snapshot({ entries: [{ date: isoDaysAgo(1) }] })), true);
    assert.equal(shouldEvaluateClient(rule, snapshot({ entries: [{ date: isoDaysAgo(10) }] })), false);
  });

  await t.test("appliesTo 'selected' limita a los clientes elegidos", () => {
    const rule = { trigger: "daily", appliesTo: "selected", clientIds: ["c2", "c3"] };
    assert.equal(shouldEvaluateClient(rule, snapshot({ clientId: "c1" })), false);
    assert.equal(shouldEvaluateClient(rule, snapshot({ clientId: "c2" })), true);
  });
});

test("MAX_CLIENTS_AFFECTED_PER_RUN", async (t) => {
  await t.test("es un tope real, ni cero ni ilimitado", () => {
    assert.ok(MAX_CLIENTS_AFFECTED_PER_RUN >= 1);
    assert.ok(MAX_CLIENTS_AFFECTED_PER_RUN <= 50, "un tope alto no protege de nada");
  });
});
