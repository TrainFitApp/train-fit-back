const test = require("node:test");
const assert = require("node:assert/strict");
const { validateInput, expectedFilter } = require("./measurement-write");

test("mediciones: rechazar valores imposibles, campos ajenos y fechas futuras", () => {
  const valid = { date: "2026-09-10", fields: { weight: 80, waist: 90 }, requestId: "intake:12345" };
  assert.doesNotThrow(() => validateInput(valid, "2026-09-10"));
  for (const fields of [{ weight: 0 }, { weight: "80" }, { weight: NaN }, { password: 50 }, { waist: 800 }]) {
    assert.throws(() => validateInput({ ...valid, fields }, "2026-09-10"), { status: 400 });
  }
  assert.throws(() => validateInput({ ...valid, date: "2026-02-30" }, "2026-09-10"), { status: 400 });
  assert.throws(() => validateInput(valid, "2026-09-09"), { status: 400 });
});

test("alta parcial preserva campos ajenos y confirma valor anterior para corregir", () => {
  assert.deepEqual(expectedFilter({ waist: 90 }, { weight: 80 }), { weight: null });
  assert.deepEqual(expectedFilter({ weight: 80, waist: 90 }, { weight: 80 }), { weight: 80 });
  assert.throws(() => expectedFilter({ weight: 80 }, { weight: 81 }), { status: 409, code: "MEASUREMENT_CONFLICT" });
  assert.deepEqual(expectedFilter({ weight: 80 }, { weight: 81 }, { weight: 80 }), { weight: 80 });
});

test("un valor visto antes no autoriza pisar la edición nueva de otro actor", () => {
  assert.throws(() => expectedFilter({ weight: 82 }, { weight: 81 }, { weight: 80 }), { status: 409 });
  assert.throws(() => expectedFilter({ weight: 82 }, { weight: 81 }, { weight: null }), { status: 409 });
});
