const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService } = require("../../.build/trainer-billing/service");
const { BillingError } = require("../../.build/trainer-billing/types");
const { CUSTOMER_ID, FakeStripe, MemoryRepository, USER_ID, errorCode, event, paidSetup, sandboxConfig, state } = require("./test-support");

// Auditoría 09/10/2026: ninguna respuesta de Stripe (rechazo, error de red, respuesta perdida) puede dejar
// una cuenta sin poder releerse. Antes un rechazo dejaba sync, propuestas, webhooks, reconciliación y
// Gestión respondiendo 503 para esa cuenta, y a las 23 h pasaba a "revisión de soporte" para siempre.

const stored = (repository) => repository.accounts.get(USER_ID);
// El gateway traduce así un rechazo de Stripe (petición inválida o clave sin permiso: no aplica nada).
const rejected = (code) => new BillingError(code, "Stripe no ha aceptado la operación.", 503);
const age = (repository, field, hours) => { stored(repository)[field].startedAt = new Date(Date.now() - hours * 3600000); };
const quiet = (t) => { t.mock.method(console, "warn", () => {}); t.mock.method(console, "error", () => {}); };

test("cancelar la renovación que Stripe rechaza avisa, no cambia nada y la cuenta sigue funcionando", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.failNext("setCancellation", rejected("CONTROL_REJECTED"));
  await assert.rejects(service.cancel(USER_ID), errorCode("CONTROL_REJECTED"));
  assert.deepEqual([stored(repository).control.done, stored(repository).control.rejected], [true, true]);
  assert.equal(stored(repository).cancelAtPeriodEnd, false);
  await service.sync(USER_ID);
  await service.cancel(USER_ID);
  assert.equal(stored(repository).cancelAtPeriodEnd, true, "se puede volver a intentar");
  assert.equal(stripe.named("setCancellation").length, 2);
});

test("un cambio sin confirmar más de 23 h no congela la cuenta: se resuelve con lo que diga Stripe", async (t) => {
  quiet(t);
  // Respuesta perdida: Stripe aplicó la subida (pendiente de pago), pero el backend no llegó a saberlo.
  const lost = paidSetup(state("starter"));
  const quote = await lost.service.previewChange(USER_ID, { tier: "professional", interval: "monthly" });
  lost.stripe.loseNextResponse("applyUpgrade");
  await assert.rejects(lost.service.changePlan(USER_ID, quote.quoteId));
  age(lost.repository, "change", 24);
  await lost.service.sync(USER_ID);
  assert.equal(stored(lost.repository).change.status, "payment_pending");
  assert.equal(stored(lost.repository).change.invoiceId, lost.stripe.sub().latestInvoiceId);
  assert.equal(lost.stripe.named("applyUpgrade").length, 1, "con la clave caducada no se reintenta: se lee lo que hay");

  // Error de red antes de llegar a Stripe: no se aplicó nada y se descarta.
  const failed = paidSetup(state("starter"));
  const other = await failed.service.previewChange(USER_ID, { tier: "professional", interval: "monthly" });
  failed.stripe.failNext("applyUpgrade");
  await assert.rejects(failed.service.changePlan(USER_ID, other.quoteId));
  age(failed.repository, "change", 24);
  await failed.service.sync(USER_ID);
  assert.equal(stored(failed.repository).change.status, "discarded");
  assert.deepEqual(failed.stripe.sub().state, state("starter"), "se conserva lo pagado");
});

test("una cancelación sin confirmar más de 23 h se cierra y manda el estado de Stripe", async (t) => {
  quiet(t);
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.failNext("setCancellation");
  await assert.rejects(service.cancel(USER_ID));
  assert.ok(!stored(repository).control.done);
  age(repository, "control", 24);
  await service.sync(USER_ID);
  assert.equal(stored(repository).control.done, true);
  assert.equal(stored(repository).cancelAtPeriodEnd, false, "Stripe no llegó a cancelar y así se refleja");
});

test("una bajada que Stripe rechaza se descarta y no bloquea la cuenta", async () => {
  const { stripe, repository, service } = paidSetup(state("professional"));
  const quote = await service.previewChange(USER_ID, { tier: "starter", interval: "monthly" });
  assert.equal(quote.kind, "scheduled");
  stripe.failNext("scheduleChange", rejected("CHANGE_REJECTED"));
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), errorCode("CHANGE_REJECTED"));
  assert.equal(stored(repository).change.status, "discarded");
  await service.sync(USER_ID);
  assert.ok((await service.previewChange(USER_ID, { tier: "starter", interval: "monthly" })).quoteId);
});

test("si Stripe rechaza crear el cliente, el intento se olvida y se puede volver a contratar", async () => {
  const stripe = new FakeStripe();
  const repository = new MemoryRepository(null);
  const service = new TrainerBillingService(sandboxConfig(), repository, stripe);
  stripe.failNext("createCustomer", rejected("CUSTOMER_REJECTED"));
  await assert.rejects(service.checkout(USER_ID, { tier: "starter", interval: "monthly" }), errorCode("CUSTOMER_REJECTED"));
  assert.equal(stored(repository).customerStartedAt, null, "sin intento colgado no hay revisión de soporte a las 23 h");
  const retry = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  assert.match(retry.url, /^https:\/\/checkout\.stripe\.com\//);
});

test("si no se pueden pausar los cobros de una disputa, el caso se registra igualmente y la pausa se reintenta", async (t) => {
  quiet(t);
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.payment = { chargeId: "ch_disputed", paymentIntentId: "pi_disputed", customerId: CUSTOMER_ID, amount: 2900, amountRefunded: 0,
    refunded: false, currency: "eur", refunds: [], invoice: null };
  stripe.dispute = { id: "dp_pause", status: "needs_response", amount: 2900, currency: "eur", reason: "fraudulent", chargeId: "ch_disputed",
    paymentIntentId: "pi_disputed", dueBy: new Date(Date.now() + 7 * 86400000), createdAt: new Date() };
  const disputed = event({ eventId: "evt_dispute_pause", type: "charge.dispute.created", customerId: null, detail: { disputeId: "dp_pause" } });
  stripe.failNext("pauseCollection", rejected("CONTROL_REJECTED"));
  await assert.rejects(service.event(disputed));
  const entry = repository.cases.get("dispute:dp_pause");
  assert.ok(entry, "Gestión ve la disputa aunque la pausa haya fallado");
  assert.deepEqual([entry.priority, entry.suggestion, entry.effects], ["high", "respond_dispute", []]);
  await service.event(disputed);
  assert.deepEqual(repository.cases.get("dispute:dp_pause").effects, ["collection_paused"]);
  assert.equal(stripe.named("pauseCollection").length, 2);
});

test("la reconciliación dice en el log qué cuenta falla y por qué, sin el mensaje ni datos del pago", async (t) => {
  const { stripe, service } = paidSetup(state("starter"));
  const logged = [];
  t.mock.method(console, "warn", (line) => logged.push(line));
  stripe.listSubscriptions = async () => {
    throw Object.assign(new Error("payload con trainer@example.test"), { type: "StripeAPIError", requestId: "req_reconcile" });
  };
  await service.reconcile();
  const line = logged.find((entry) => entry.includes("Reconciliación"));
  assert.match(line, /1 fallo/);
  assert.match(line, new RegExp(`cuenta ${USER_ID}: StripeAPIError req_reconcile`));
  assert.ok(!line.includes("trainer@example.test"));
});
