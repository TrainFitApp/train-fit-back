const test = require("node:test");
const assert = require("node:assert/strict");
const { compareChain, coveringPhase, cutEndDate, phaseState, sortChain, successorOf, withStates } = require("./phase-chain");

// Cadena de fases (dieta y rutina): todo se deduce del orden por inicio y,
// con el mismo inicio, por creación.

test("coveringPhase: la que rige en una fecha", async (t) => {
  await t.test("sin fases, null", () => assert.equal(coveringPhase([], "2026-09-03"), null));

  await t.test("una fase futura no rige", () => {
    assert.equal(coveringPhase([{ startDate: "2026-09-10", createdAt: "2026-09-01" }], "2026-09-03"), null);
  });

  await t.test("una que empieza ese día ya rige", () => {
    const phase = { startDate: "2026-09-03", createdAt: "2026-09-03" };
    assert.equal(coveringPhase([phase], "2026-09-03"), phase);
  });

  await t.test("entre varias, la de inicio más reciente", () => {
    const old = { startDate: "2026-07-01", createdAt: "2026-07-01" };
    const recent = { startDate: "2026-08-15", createdAt: "2026-08-15" };
    const future = { startDate: "2026-09-10", createdAt: "2026-09-10" };
    assert.equal(coveringPhase([old, recent, future], "2026-09-03"), recent);
  });

  await t.test("mismo inicio: la creada después, llegue en el orden que llegue", () => {
    const a = { startDate: "2026-09-03", createdAt: "2026-09-03T09:00:00.000Z" };
    const b = { startDate: "2026-09-03", createdAt: "2026-09-03T10:00:00.000Z" };
    assert.equal(coveringPhase([a, b], "2026-09-03"), b);
    assert.equal(coveringPhase([b, a], "2026-09-03"), b);
  });

  await t.test("una fase de dieta terminada no rige después de su fin", () => {
    const ended = { startDate: "2026-08-01", endDate: "2026-08-31", createdAt: "2026-08-01" };
    assert.equal(coveringPhase([ended], "2026-08-31"), ended);
    assert.equal(coveringPhase([ended], "2026-09-01"), null);
  });
});

test("orden y siguiente", () => {
  const a = { _id: "a", startDate: "2026-08-01", createdAt: "2026-08-01" };
  const b = { _id: "b", startDate: "2026-09-01", createdAt: "2026-08-20" };
  const c = { _id: "c", startDate: "2026-09-01", createdAt: "2026-08-25" };
  assert.deepEqual(sortChain([c, a, b]).map((p) => p._id), ["a", "b", "c"]);
  assert.ok(compareChain(b, c) < 0);
  assert.equal(successorOf([c, a, b], a), b);
  assert.equal(successorOf([c, a, b], c), null);
});

test("cutEndDate: el día antes de la que entra, nunca antes de su inicio", () => {
  assert.equal(cutEndDate({ startDate: "2026-08-01" }, "2026-09-01"), "2026-08-31");
  assert.equal(cutEndDate({ startDate: "2026-09-01" }, "2026-09-01"), "2026-09-01");
});

test("phaseState: programada, en curso o pasada", () => {
  const past = { _id: "p", startDate: "2026-08-01", createdAt: "2026-08-01" };
  const current = { _id: "c", startDate: "2026-09-01", createdAt: "2026-09-01" };
  const scheduled = { _id: "s", startDate: "2026-10-01", createdAt: "2026-09-02" };
  const today = "2026-09-15";
  assert.deepEqual(
    withStates([past, current, scheduled], today).map(({ phase, state }) => [phase._id, state]),
    [["p", "past"], ["c", "current"], ["s", "scheduled"]],
  );
  assert.equal(phaseState(past, today, null), "past");
});
