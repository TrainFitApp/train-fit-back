const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTaskInput, sameHabit, maxTargetFor } = require("./task-input");

// QA 2026-10-09 (M14): rango invertido guardado sin avisar, objetivos sin
// tope y errores sin código.

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

test("alta válida: limpia nombre y unidad; sin rango, targetMax null", () => {
  assert.deepEqual(parseTaskInput({ type: "custom", label: "  Estirar ", target: "10", unit: " min " }), {
    type: "custom",
    label: "Estirar",
    target: 10,
    targetMax: null,
    unit: "min",
  });
  assert.deepEqual(parseTaskInput({ type: "steps", target: 8000, targetMax: 10000, unit: "pasos" }).targetMax, 10000);
});

test("cada error lleva su código", () => {
  assert.equal(codeOf(() => parseTaskInput({ type: "yoga", target: 1, unit: "x" })), "TASK_INVALID_TYPE");
  assert.equal(codeOf(() => parseTaskInput({ type: "custom", label: " ", target: 1, unit: "x" })), "TASK_LABEL_REQUIRED");
  assert.equal(codeOf(() => parseTaskInput({ type: "custom", label: "x".repeat(101), target: 1, unit: "x" })), "TASK_LABEL_TOO_LONG");
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: 2, unit: "" })), "TASK_UNIT_REQUIRED");
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: 2, unit: "x".repeat(21) })), "TASK_UNIT_TOO_LONG");
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: -1, unit: "L" })), "TASK_INVALID_TARGET");
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: "abc", unit: "L" })), "TASK_INVALID_TARGET");
  assert.equal(codeOf(() => parseTaskInput({ type: "steps", target: 8000, targetMax: 5000, unit: "pasos" })), "TASK_INVALID_RANGE");
  assert.equal(codeOf(() => parseTaskInput({ type: "steps", target: 8000, targetMax: 8000, unit: "pasos" })), "TASK_INVALID_RANGE");
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: 1e12, unit: "L" })), "TASK_TARGET_TOO_HIGH");
});

test("topes por tipo; el agua según su unidad", () => {
  assert.equal(maxTargetFor("steps"), 100000);
  assert.equal(maxTargetFor("sleep"), 24);
  assert.equal(maxTargetFor("water", "L"), 20);
  assert.equal(maxTargetFor("water", "ml"), 20000);
  assert.equal(codeOf(() => parseTaskInput({ type: "water", target: 3000, unit: "ml" })), null);
});

test("editar: el tipo no cambia y lo no enviado se queda como estaba", () => {
  const current = { type: "steps", label: null, target: 8000, targetMax: 10000, unit: "pasos" };
  assert.deepEqual(parseTaskInput({ type: "water", target: 9000 }, current), { type: "steps", label: null, target: 9000, targetMax: 10000, unit: "pasos" });
  assert.equal(parseTaskInput({ targetMax: "" }, current).targetMax, null, "vaciar el tope lo quita");
  assert.equal(codeOf(() => parseTaskInput({ target: 11000 }, current)), "TASK_INVALID_RANGE", "el tope que ya tenía sigue mandando");
});

test("mismo hábito: mismo tipo; los propios, por nombre sin mayúsculas", () => {
  assert.equal(sameHabit({ type: "steps" }, { type: "steps" }), true);
  assert.equal(sameHabit({ type: "steps" }, { type: "water" }), false);
  assert.equal(sameHabit({ type: "custom", label: "Estirar" }, { type: "custom", label: " estirar " }), true);
  assert.equal(sameHabit({ type: "custom", label: "Estirar" }, { type: "custom", label: "Meditar" }), false);
});
