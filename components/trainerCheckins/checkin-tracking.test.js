const test = require("node:test");
const assert = require("node:assert/strict");
const { missedOccurrences, nextDateOf } = require("./checkin-agenda-service");
const { looseContent } = require("./checkin-agenda-controller");

const HOY = "2026-09-21";
const semanal = { _id: "s1", startDate: "2026-08-31", frequency: "weekly", interval: 1, active: true };

test("missedOccurrences — abiertas y perdidas", async (t) => {
  await t.test("la de esta semana sigue abierta; las pasadas sin respuesta, perdidas", () => {
    // 31-ago, 7-sep y 14-sep cerradas; 21-sep abierta. Respondida la del 7.
    const r = missedOccurrences([semanal], new Set(["s1:2026-09-07"]), HOY, 30);
    assert.equal(r.answered, 1);
    assert.equal(r.missed, 2);
    assert.equal(r.open, 1);
    assert.equal(r.lastMissedDate, "2026-09-14");
  });

  await t.test("una puntual sin siguiente fecha no se cierra nunca", () => {
    const puntual = { _id: "p1", startDate: "2026-01-10", frequency: "once", interval: 1, active: true };
    const r = missedOccurrences([puntual], new Set(), HOY, 365);
    assert.deepEqual([r.open, r.missed], [1, 0]);
  });

  await t.test("3 años de una diaria: sin el tope de 400 ocurrencias", () => {
    const diaria = { _id: "d1", startDate: "2023-01-01", frequency: "daily", interval: 1, active: true };
    const r = missedOccurrences([diaria], new Set(), HOY, 3 * 365 - 1);
    assert.equal(r.expected, 3 * 365);
    assert.equal(r.open, 1);
    assert.equal(r.missed, 3 * 365 - 1);
  });
});

test("nextDateOf", async (t) => {
  await t.test("la siguiente a hoy, no la de hoy", () => {
    assert.equal(nextDateOf(semanal, HOY), "2026-09-28");
  });
  await t.test("una que aún no ha empezado: su primera fecha", () => {
    assert.equal(nextDateOf({ ...semanal, startDate: "2026-10-01" }, HOY), "2026-10-01");
  });
  await t.test("pausada o puntual ya lanzada: null", () => {
    assert.equal(nextDateOf({ ...semanal, active: false }, HOY), null);
    assert.equal(nextDateOf({ startDate: HOY, frequency: "once", interval: 1, active: true }, HOY), null);
  });
});

test("looseContent", async (t) => {
  await t.test("campos del catálogo, sin repetir y sin plantilla", () => {
    assert.deepEqual(looseContent(["weight", "weight"]), {
      sourceTemplateId: null,
      enabledFields: ["weight"],
      requiredFields: [],
      customQuestions: [],
    });
  });
  await t.test("una clave que no existe invalida todo", () => {
    assert.equal(looseContent(["weight", "no-existe"]), null);
  });
});
