const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("./pair-state");

const link = (scope, status, extra = {}) => ({ _id: `${scope}-${status}`, scope, status, invitedAt: new Date("2026-01-01"), ...extra });

test("scopes activos y estado de la relación", () => {
  const pair = { scopes: [link("training", "revoked", { revokedAt: new Date("2026-03-01") }), link("nutrition", "active")] };
  assert.deepEqual(state.activeScopes(pair), ["nutrition"]);
  assert.equal(state.hasActiveScope(pair), true);
  assert.equal(state.hasActiveScope(pair, "training"), false);
  assert.equal(state.relationState(pair), "active");
  assert.equal(state.relationState({ scopes: [link("training", "revoked")] }), "former");
  assert.equal(state.relationState({ scopes: [link("training", "declined")] }), null, "rechazar no es haber sido cliente");
  assert.equal(state.relationState(null), null);
});

test("una invitación abierta por scope: pendiente o en curso", () => {
  const pair = { scopes: [link("training", "declined"), link("training", "pending")] };
  assert.equal(state.openLink(pair, "training").status, "pending");
  assert.equal(state.openLink(pair, "nutrition"), null);
  assert.equal(state.hasOpenLink(pair), true);
  assert.equal(state.hasOpenLink({ scopes: [link("training", "revoked")] }), false);
});

test("inicio de la relación en curso y fin de la anterior", () => {
  const pair = {
    scopes: [
      link("training", "revoked", { respondedAt: new Date("2025-01-01"), revokedAt: new Date("2025-06-01") }),
      link("training", "active", { respondedAt: new Date("2026-02-01") }),
      link("nutrition", "active", { respondedAt: new Date("2026-01-15") }),
    ],
  };
  assert.deepEqual(state.activeSince(pair), new Date("2026-01-15"));
  assert.deepEqual(state.latestRevokedAt(pair), new Date("2025-06-01"));
  assert.equal(state.latestRevokedAt({ scopes: [] }), null);
});

test("cuestionario: pendiente con el primer scope; con otro ya activo se conserva lo que hubiera", () => {
  assert.equal(state.intakePendingOnAccept({ scopes: [] }), true);
  assert.equal(state.intakePendingOnAccept({ scopes: [link("training", "revoked")] }), true, "volver tras una baja lo pide otra vez");
  assert.equal(state.intakePendingOnAccept({ scopes: [link("training", "active")], intakePending: false }), false);
  assert.equal(state.intakePendingOnAccept({ scopes: [link("training", "active")], intakePending: true }), true);
});

test("estado del cuestionario: pendiente, enviado, revisado o sin cuestionario", () => {
  assert.equal(state.intakeStatusOf({ intakePending: true, intake: { submittedAt: new Date() } }), "pending");
  assert.equal(state.intakeStatusOf({ intakePending: false, intake: { submittedAt: new Date(), reviewedAt: null } }), "submitted");
  assert.equal(state.intakeStatusOf({ intakePending: false, intake: { submittedAt: new Date(), reviewedAt: new Date() } }), "reviewed");
  assert.equal(state.intakeStatusOf({ intakePending: false, intake: { submittedAt: null } }), null, "rellenado por el profesional no cuenta");
  assert.equal(state.intakeStatusOf({ intakePending: false, intake: null }), null);
  assert.equal(state.intakeStatusOf(null), null);
});

test("invitaciones en plano, de la más reciente a la más antigua", () => {
  const pair = {
    trainerId: "t1",
    clientEmail: "a@x.test",
    scopes: [link("training", "pending", { invitedAt: new Date("2026-01-01") }), link("nutrition", "pending", { invitedAt: new Date("2026-02-01") })],
  };
  const list = state.invitationsOf([pair]).map(({ pair: p, link: l }) => state.invitationView(p, l));
  assert.deepEqual(list.map((i) => i.scope), ["nutrition", "training"]);
  assert.equal(list[0].clientId, null, "sin cuenta todavía");
  assert.equal(list[0].trainerId, "t1");
});
