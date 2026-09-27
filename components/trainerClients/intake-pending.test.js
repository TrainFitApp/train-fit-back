const test = require("node:test");
const assert = require("node:assert/strict");
const { intakePendingOnAccept, intakeStatusFor } = require("./intake-pending");

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

test("estado: pendiente manda aunque exista un cuestionario (p. ej. creado por el profesional)", () => {
  assert.equal(intakeStatusFor({ intakePending: true, intake: { reviewedAt: null } }), "pending");
});

test("estado: enviado y sin revisar se puede editar", () => {
  assert.equal(intakeStatusFor({ intakePending: false, intake: { reviewedAt: null } }), "submitted");
});

test("estado: revisado es solo lectura", () => {
  assert.equal(intakeStatusFor({ intakePending: false, intake: { reviewedAt: new Date() } }), "reviewed");
});

test("estado: relación antigua sin cuestionario no se muestra", () => {
  assert.equal(intakeStatusFor({ intakePending: false, intake: null }), null);
});
