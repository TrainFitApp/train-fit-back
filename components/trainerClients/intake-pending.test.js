const test = require("node:test");
const assert = require("node:assert/strict");
const { intakePendingOnAccept } = require("./intake-pending");

test("primer scope con el profesional: cuestionario pendiente", () => {
  assert.equal(intakePendingOnAccept([]), true);
});

test("segundo scope con el cuestionario ya enviado: no se repite", () => {
  assert.equal(intakePendingOnAccept([{ scope: "training", intakePending: false }]), false);
});

test("segundo scope con el cuestionario aún sin enviar: sigue pendiente", () => {
  assert.equal(intakePendingOnAccept([{ scope: "training", intakePending: true }]), true);
});

test("relación antigua sin el campo cuenta como cuestionario ya resuelto", () => {
  assert.equal(intakePendingOnAccept([{ scope: "training" }]), false);
});
