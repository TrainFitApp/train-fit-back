const test = require("node:test");
const assert = require("node:assert/strict");
const { stepsFromCheckin, needSnapshot } = require("./cycle-need");

test("stepsFromCheckin", async (t) => {
  await t.test("daily_steps del check-in, redondeado", () => {
    const at = new Date("2026-09-10");
    assert.deepEqual(stepsFromCheckin({ values: { daily_steps: 8500.4 }, respondedAt: at }), { avg: 8500, respondedAt: at });
  });
  await t.test("sin respuesta, sin campo o valor no válido", () => {
    const empty = { avg: null, respondedAt: null };
    assert.deepEqual(stepsFromCheckin(null), empty);
    assert.deepEqual(stepsFromCheckin({ values: { weight: 80 } }), empty);
    assert.deepEqual(stepsFromCheckin({ values: { daily_steps: 0 } }), empty);
    assert.deepEqual(stepsFromCheckin({ values: { daily_steps: "abc" } }), empty);
  });
});

test("needSnapshot", async (t) => {
  await t.test("faltan biométricos → missing y sin desglose", () => {
    const s = needSnapshot({ ok: false, missing: ["peso"], inputs: { heightCm: 180 } }, new Date("2026-09-14"));
    assert.deepEqual(s.missing, ["peso"]);
    assert.equal(s.breakdown, null);
    assert.equal(s.target, null);
    assert.equal(s.inputs.heightCm, 180);
  });
  await t.test("ok → inputs + breakdown + target", () => {
    const s = needSnapshot({ ok: true, inputs: { a: 1 }, breakdown: { bmr: 1 }, target: { kcal: 2 } });
    assert.equal(s.missing, undefined);
    assert.equal(s.target.kcal, 2);
  });
  await t.test("null → null", () => {
    assert.equal(needSnapshot(null), null);
  });
});
