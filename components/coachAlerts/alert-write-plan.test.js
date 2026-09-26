const test = require("node:test");
const assert = require("node:assert/strict");
const { planAlertWrites } = require("./alert-write-plan");

const NOW = new Date("2026-09-26T08:00:00.000Z");

function candidate(dedupeKey, overrides = {}) {
  return {
    dedupeKey,
    trainerId: "t1",
    clientId: "c1",
    type: "stagnation",
    priority: "medium",
    reason: `motivo ${dedupeKey}`,
    context: { metric: "weight" },
    ...overrides,
  };
}

test("planAlertWrites", async (t) => {
  await t.test("sin abiertas ni silencio: todo se inserta y queda abierto", () => {
    const plan = planAlertWrites([candidate("k1"), candidate("k2")], {
      openIdByKey: new Map(),
      now: NOW,
    });
    assert.equal(plan.inserts.length, 2);
    assert.deepEqual(plan.refreshes, []);
    assert.deepEqual(plan.keptKeys, ["k1", "k2"]);
    assert.equal(plan.inserts[0].createdAt, NOW);
    assert.equal(plan.inserts[0].lastSeenAt, NOW);
  });

  await t.test("la abierta se refresca (frase y números) sin tocar createdAt", () => {
    const plan = planAlertWrites([candidate("k1", { reason: "4 semanas", priority: "high" })], {
      openIdByKey: new Map([["k1", "a1"]]),
      now: NOW,
    });
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.refreshes, [
      {
        _id: "a1",
        set: { reason: "4 semanas", context: { metric: "weight" }, priority: "high", lastSeenAt: NOW },
      },
    ]);
    assert.deepEqual(plan.keptKeys, ["k1"]);
  });

  await t.test("cerrada a mano en silencio: ni se inserta ni se cuenta como abierta", () => {
    const plan = planAlertWrites([candidate("k1")], {
      openIdByKey: new Map(),
      silencedKeys: new Set(["k1"]),
      now: NOW,
    });
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.keptKeys, []);
    assert.equal(plan.skipped, 1);
  });

  await t.test("abierta gana al silencio: se reabrió a mano y sigue vigente", () => {
    const plan = planAlertWrites([candidate("k1")], {
      openIdByKey: new Map([["k1", "a1"]]),
      silencedKeys: new Set(["k1"]),
      now: NOW,
    });
    assert.equal(plan.refreshes.length, 1);
    assert.equal(plan.skipped, 0);
  });

  await t.test("clave repetida en la misma pasada: una sola alerta, gana la última", () => {
    const plan = planAlertWrites(
      [candidate("k1", { reason: "primera" }), candidate("k1", { reason: "segunda" })],
      { openIdByKey: new Map(), now: NOW }
    );
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].reason, "segunda");
    assert.deepEqual(plan.keptKeys, ["k1"]);
  });

  await t.test("conserva ruleId y el resto de campos del candidato", () => {
    const plan = planAlertWrites([candidate("k1", { type: "rule_matched", ruleId: "r1" })], {
      openIdByKey: new Map(),
      now: NOW,
    });
    assert.equal(plan.inserts[0].ruleId, "r1");
    assert.equal(plan.inserts[0].type, "rule_matched");
  });
});
