const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService, PAST_DUE_GRACE_MS, accessSnapshot, changeKind, effectiveAccess, projection } = require("../../.build/trainer-billing/service");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { DAY, FakeStripe, MemoryRepository, USER_ID, account, errorCode, event, nowSeconds, paidSetup, sandboxConfig, session,
  state } = require("./test-support");

const changeIntent = (input) => ({ tier: input.tier, interval: input.interval, extraSeats: input.extraSeats ?? 0 });
async function quoteFor(service, target) { return service.previewChange(USER_ID, changeIntent(target)); }
async function confirm(service, target) { const quote = await quoteFor(service, target); return { quote, result: await service.changePlan(USER_ID, quote.quoteId) }; }
const stored = (repository) => repository.accounts.get(USER_ID);

// ---------- Reglas puras ----------

test("cuándo se aplica cada cambio: subir (también plazas mensuales) se cobra ya y bajar espera", () => {
  const cases = [
    [state("starter"), state("professional"), "immediate"],
    [state("free", "monthly", 9), state("starter"), "immediate"],
    [state("starter", "monthly", 5), state("starter", "monthly", 8), "immediate"],
    [state("free", "monthly", 1), state("free", "monthly", 4), "immediate"],
    [state("starter", "annual", 5), state("starter", "annual", 8), "immediate"],
    [state("starter", "monthly", 8), state("starter", "monthly", 2), "scheduled"],
    [state("professional"), state("starter", "monthly", 20), "scheduled"],
    [state("starter"), state("free", "monthly", 5), "scheduled"],
    [state("starter"), state("starter", "annual"), "immediate"],
    [state("starter", "annual"), state("professional", "monthly"), "scheduled"],
  ];
  for (const [from, to, kind] of cases) assert.equal(changeKind(from, to), kind, `${JSON.stringify(from)} → ${JSON.stringify(to)}`);
});

test("acceso efectivo: lo pagado da sus plazas; una excepción da las de su plan solo si son más; nunca finge un cobro", () => {
  const now = new Date();
  const paid = account({ status: "active", tier: "starter", interval: "monthly", extraSeats: 5, paidUntil: new Date(Date.now() + DAY * 1000),
    provider: { latestInvoiceStatus: "paid" } });
  assert.deepEqual(projection(paid, now), { entitled: true, tier: "starter", interval: "monthly", seats: 25,
    expiresAt: paid.paidUntil, lastSyncAt: now, stripeRevision: 0, stripeMode: "test" });
  const grant = (tier) => ({ id: "adj-1", kind: "grant", from: null, until: new Date(Date.now() + 10 * DAY * 1000), tier, interval: null,
    invoiceId: null, reason: "x", source: "admin", caseId: null, interventionId: null, createdAt: now, liftedAt: null });
  assert.equal(effectiveAccess({ ...paid, adjustments: [grant("professional")] }, now).seats, 50, "50 incluidas > 25 pagadas");
  assert.equal(effectiveAccess({ ...paid, adjustments: [grant("professional")] }, now).basis, "exception");
  assert.equal(effectiveAccess({ ...paid, extraSeats: 20, adjustments: [grant("starter")] }, now).basis, "payment", "40 pagadas > 20");
  const free = account({ status: "canceled" });
  assert.deepEqual([effectiveAccess(free, now).entitled, effectiveAccess(free, now).seats], [false, 3]);
  assert.equal(effectiveAccess({ ...free, adjustments: [grant("scale")] }, now).seats, 150);
  const revoked = { ...paid, adjustments: [{ ...grant(null), kind: "revoke_period", from: new Date(Date.now() - 1000) }] };
  assert.deepEqual([effectiveAccess(revoked, now).entitled, effectiveAccess(revoked, now).seats], [false, 3]);
  assert.equal(effectiveAccess({ ...paid, deletedAt: now }, now).entitled, false);
  assert.deepEqual(accessSnapshot(paid, now).seats, 25);
});

test("un cobro fallido o una renovación todavía en borrador mantienen el plan 7 días; después, Free", () => {
  const paidUntil = new Date(Date.now() - 1000);
  const past = account({ status: "past_due", tier: "starter", interval: "monthly", extraSeats: 0, paidUntil, provider: { latestInvoiceStatus: "open" } });
  assert.equal(effectiveAccess(past).entitled, true);
  assert.equal(effectiveAccess(past).expiresAt.getTime(), paidUntil.getTime() + PAST_DUE_GRACE_MS);
  assert.equal(effectiveAccess({ ...past, status: "active", provider: { latestInvoiceStatus: "draft" } }).entitled, true);
  assert.equal(effectiveAccess({ ...past, status: "active", provider: { latestInvoiceStatus: "paid" } }).entitled, false);
  assert.equal(effectiveAccess({ ...past, paidUntil: new Date(Date.now() - PAST_DUE_GRACE_MS - 1000) }).entitled, false);
});

// ---------- Contratar ----------

function freeSetup(overrides = {}) {
  const config = sandboxConfig(overrides.env);
  const stripe = new FakeStripe();
  const repository = new MemoryRepository(overrides.account || null, overrides.seats);
  return { config, stripe, repository, service: new TrainerBillingService(config, repository, stripe) };
}

test("contratar crea un único cliente de Stripe y un Checkout con lo elegido; no da acceso antes del pago", async () => {
  const { stripe, repository, service } = freeSetup();
  const first = await service.checkout(USER_ID, { tier: "free", interval: "monthly", extraSeats: 4 });
  assert.equal(first.reused, false);
  assert.match(first.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(stripe.named("createCustomer").length, 1);
  assert.equal(stripe.named("createCustomer")[0].args.key, `trainers-test-${USER_ID}`);
  assert.deepEqual(stripe.named("validateState")[0].args.value, state("free", "monthly", 4));
  assert.equal(stored(repository).status, "checkout_pending");
  assert.equal(repository.lastProjection.entitled, false);
  // Repetir lo mismo reutiliza la sesión abierta; otro plan con una sesión abierta se rechaza.
  assert.equal((await service.checkout(USER_ID, { tier: "free", interval: "monthly", extraSeats: 4 })).reused, true);
  await assert.rejects(service.checkout(USER_ID, { tier: "starter", interval: "monthly" }), errorCode("EXISTING_CHECKOUT"));
  assert.equal(stripe.named("createCheckout").length, 1);
  await assert.rejects(service.checkout(USER_ID, { tier: "free", interval: "monthly", extraSeats: 0 }), errorCode("INVALID_PLAN"));
});

test("si Stripe rechaza abrir Checkout no queda un intento colgado: se puede contratar enseguida, también otro plan", async () => {
  const { BillingError } = require("../../.build/trainer-billing/types");
  const { stripe, repository, service } = freeSetup();
  stripe.failNext("createCheckout", new BillingError("CHECKOUT_REJECTED", "No se ha podido abrir la página de pago.", 503));
  await assert.rejects(service.checkout(USER_ID, { tier: "professional", interval: "monthly" }), errorCode("CHECKOUT_REJECTED"));
  assert.equal(stored(repository).checkout, null);
  assert.notEqual(stored(repository).status, "checkout_pending", "no se presenta como contratación pendiente");
  const retry = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  assert.equal(retry.reused, false);
  assert.equal(stripe.named("createCheckout").length, 2);
});

test("un intento que Stripe nunca llegó a crear no bloquea la cuenta: pasados 25 min se abre otro", async () => {
  const { stripe, repository, service } = freeSetup();
  // Fallo incierto (p. ej. de red): el intento se conserva para reintentarlo con su misma clave.
  stripe.failNext("createCheckout");
  await assert.rejects(service.checkout(USER_ID, { tier: "professional", interval: "monthly" }));
  const first = stored(repository).checkout.key;
  assert.ok(first);
  // Sin ninguna sesión de ese intento en Stripe y pasados 25 min se abre otro (antes: «contacta con soporte»).
  repository.accounts.get(USER_ID).checkout.startedAt = new Date(Date.now() - 30 * 60000);
  const fresh = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  assert.equal(fresh.reused, false);
  assert.notEqual(stripe.named("createCheckout").at(-1).args.key, first);
});

test("al volver de Checkout el pago confirmado da las plazas del plan comprado, también en Free con plazas", async () => {
  const { stripe, repository, service } = freeSetup();
  const { sessionId } = await service.checkout(USER_ID, { tier: "free", interval: "monthly", extraSeats: 4 });
  stripe.completeCheckout(sessionId);
  await service.sync(USER_ID, sessionId);
  const projected = repository.lastProjection;
  assert.deepEqual([projected.entitled, projected.tier, projected.seats], [true, "free", 7]);
  await assert.rejects(service.checkout(USER_ID, { tier: "starter", interval: "monthly" }), errorCode("ACTIVE_SUBSCRIPTION"));
  // La sesión debe ser de esta cuenta y de este entorno.
  await assert.rejects(service.sync(USER_ID, "cs_live_other"), errorCode("INVALID_SESSION"));
});

test("un Checkout completado pero sin cobrar no da acceso", async () => {
  const { stripe, repository, service } = freeSetup();
  const { sessionId } = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  stripe.completeCheckout(sessionId, { latestInvoiceStatus: "open", status: "incomplete" });
  await service.sync(USER_ID, sessionId);
  assert.equal(repository.lastProjection.entitled, false);
});

test("dos contrataciones a la vez no crean dos Checkouts: el bloqueo por entrenador lo impide", async () => {
  const { repository, service } = freeSetup();
  repository.leases.add(USER_ID);
  await assert.rejects(service.checkout(USER_ID, { tier: "starter", interval: "monthly" }), errorCode("BILLING_BUSY"));
});

test("tras una suscripción terminada se puede volver a contratar", async () => {
  const { stripe, service } = freeSetup();
  const { sessionId } = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  stripe.completeCheckout(sessionId);
  await service.sync(USER_ID, sessionId);
  stripe.sub().status = "canceled";
  await service.sync(USER_ID);
  const again = await service.checkout(USER_ID, { tier: "professional", interval: "annual" });
  assert.equal(again.reused, false);
});

test("una suscripción viva fuera del catálogo se para para revisión de soporte", async () => {
  const { stripe, service } = paidSetup(state("starter"));
  stripe.sub().state = null;
  await assert.rejects(service.sync(USER_ID), errorCode("UNKNOWN_SUBSCRIPTION_PRICE"));
  stripe.sub().status = "canceled";
  await service.sync(USER_ID);
});

// ---------- Propuestas ----------

test("la propuesta sale de Stripe, no expone datos internos y dice cuántas plazas quedan", async () => {
  const { service } = paidSetup(state("starter", "monthly", 5), { seats: { occupied: 22, reserved: 2 } });
  const quote = await quoteFor(service, state("professional"));
  assert.equal(quote.kind, "immediate");
  assert.deepEqual(quote.from, { tier: "starter", interval: "monthly", extraSeats: 5, seats: 25, amount: 3400 });
  assert.deepEqual(quote.to, { tier: "professional", interval: "monthly", extraSeats: 0, seats: 50, amount: 4900 });
  assert.equal(quote.amountDueNow, 750);
  assert.deepEqual(quote.seats, { occupied: 22, reserved: 2 });
  assert.equal(quote.readOnlyAfter, 0);
  for (const internal of ["subscriptionId", "snapshot", "prorationDate", "periodEnd", "previousScheduleId", "updates", "fromItems", "targetItems"]) {
    assert.equal(Object.hasOwn(quote, internal), false, internal);
  }
  assert.ok(new Date(quote.expiresAt) - Date.now() <= 5 * 60000);
});

test("reducir nunca se bloquea por tener más clientes: la propuesta dice cuántos quedarán en solo lectura", async () => {
  const { service } = paidSetup(state("starter", "monthly", 10), { seats: { occupied: 28, reserved: 1 } });
  const quote = await quoteFor(service, state("starter", "monthly", 2));
  assert.equal(quote.kind, "scheduled");
  assert.equal(quote.readOnlyAfter, 6);
  assert.equal(quote.amountDueNow, 0);
  assert.equal(new Date(quote.effectiveAt).getTime(), new Date(quote.nextRenewal.at).getTime());
  const toFree = await quoteFor(service, state("free", "monthly", 9));
  assert.equal(toFree.readOnlyAfter, 16);
  // Mensual → anual es inmediato aunque baje plazas: la propuesta también avisa.
  const annual = paidSetup(state("professional"), { seats: { occupied: 28, reserved: 1 } });
  const toAnnual = await quoteFor(annual.service, state("starter", "annual"));
  assert.equal(toAnnual.kind, "immediate");
  assert.equal(toAnnual.readOnlyAfter, 8);
});

test("plazas mensuales: la prorrata se cobra hoy", async () => {
  const { service } = paidSetup(state("starter", "monthly", 5));
  const quote = await quoteFor(service, state("starter", "monthly", 9));
  assert.equal(quote.kind, "immediate");
  assert.equal(quote.amountDueNow, 200);
  assert.equal(quote.nextRenewal.amount, 3800);
});

test("la propuesta rechaza lo ya contratado o programado y estados que no se pueden cambiar", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 5));
  await assert.rejects(quoteFor(service, state("starter", "monthly", 5)), errorCode("SAME_PLAN"));
  await assert.rejects(service.previewChange(USER_ID, { tier: "starter", interval: "monthly", extraSeats: 99 }), errorCode("INVALID_PLAN"));
  await confirm(service, state("starter", "monthly", 2));
  await assert.rejects(quoteFor(service, state("starter", "monthly", 2)), errorCode("SAME_SCHEDULED_CHANGE"));
  stripe.sub().cancelAtPeriodEnd = true;
  await assert.rejects(quoteFor(service, state("professional")), errorCode("CANCELLATION_SCHEDULED"));
  stripe.sub().cancelAtPeriodEnd = false;
  stripe.sub().collectionPaused = true;
  await assert.rejects(quoteFor(service, state("professional")), errorCode("COLLECTION_PAUSED"));
  // Sin suscripción (Free sin plazas) no hay nada que cambiar: se contrata por Checkout.
  const free = freeSetup({ account: account() });
  await assert.rejects(free.service.previewChange(USER_ID, changeIntent(state("starter"))), errorCode("SUBSCRIPTION_NOT_ACTIVE"));
  assert.equal(stored(repository).change.status, "scheduled", "los rechazos no tocan el cambio programado");
});

test("un reloj de pruebas congelado fija la fecha de prorrateo de la propuesta y de su confirmación", async () => {
  const frozen = nowSeconds() - 3 * DAY;
  const { stripe, service } = paidSetup(state("starter"), { sub: { billingNow: frozen } });
  const { quote } = await confirm(service, state("professional"));
  const previews = stripe.named("previewChange");
  assert.ok(previews.length >= 2);
  assert.ok(previews.every((call) => call.args.prorationDate === frozen));
  assert.equal(new Date(quote.effectiveAt).getTime(), frozen * 1000);
});

// ---------- Confirmar ----------

test("una subida queda pendiente hasta pagar su factura: mientras tanto se conservan las plazas pagadas", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 5));
  const { result } = await confirm(service, state("professional"));
  assert.equal(result.status, "payment_pending");
  assert.match(result.paymentActionUrl, /^https:\/\/invoice\.stripe\.com\//);
  assert.equal(repository.lastProjection.seats, 25);
  await assert.rejects(quoteFor(service, state("scale")), errorCode("PAYMENT_PENDING"));
  const [{ args }] = stripe.named("applyUpgrade");
  stripe.pay(stripe.sub().latestInvoiceId);
  await service.event(event({ eventId: "evt_paid" }));
  assert.equal(stored(repository).change.status, "applied");
  assert.deepEqual([repository.lastProjection.tier, repository.lastProjection.seats], ["professional", 50]);
  assert.equal(args.key, `trainers-change-${stored(repository).change.quote.quoteId}`);
});

test("las plazas mensuales se dan al pagar su factura, como cualquier subida", async () => {
  const { stripe, repository, service } = paidSetup(state("free", "monthly", 2));
  const { result } = await confirm(service, state("free", "monthly", 6));
  assert.equal(result.status, "payment_pending");
  assert.equal(stripe.named("applyUpgrade").length, 1);
  assert.equal(repository.lastProjection.seats, 5, "hasta pagar se conservan las plazas pagadas");
  stripe.pay(stripe.sub().latestInvoiceId);
  await service.event(event({ eventId: "evt_seats_paid" }));
  assert.deepEqual([repository.lastProjection.tier, repository.lastProjection.seats], ["free", 9]);
});

test("una bajada se programa para la renovación y se aplica cuando se cobra el periodo nuevo", async () => {
  const { stripe, repository, service } = paidSetup(state("professional", "monthly", 20));
  const { result } = await confirm(service, state("starter", "monthly", 15));
  assert.equal(result.status, "scheduled");
  assert.equal(repository.lastProjection.seats, 70, "hasta la renovación se conserva lo pagado");
  // Confirmar dos veces la misma propuesta no programa otro calendario.
  await service.changePlan(USER_ID, stored(repository).change.quote.quoteId);
  assert.equal(stripe.named("scheduleChange").length, 1);
  stripe.renew();
  await service.event(event({ eventId: "evt_cycle" }));
  assert.equal(stored(repository).change.status, "applied");
  assert.deepEqual([repository.lastProjection.tier, repository.lastProjection.seats], ["starter", 35]);
});

test("propuestas ajenas, caducadas o de una suscripción que ha cambiado no cobran nada", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  await assert.rejects(service.changePlan(USER_ID, "not-a-quote"), errorCode("INVALID_QUOTE"));
  await assert.rejects(service.changePlan(USER_ID, `trainers-checkout-${"a".repeat(40)}`), errorCode("INVALID_QUOTE"));
  const quote = await quoteFor(service, state("professional"));
  const row = stored(repository);
  row.quote.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), errorCode("QUOTE_EXPIRED"));
  const fresh = await quoteFor(service, state("professional"));
  stripe.sub().items = [...stripe.sub().items, { id: "si_new", price: stripe.sub().items[0].price, quantity: 0 }];
  await assert.rejects(service.changePlan(USER_ID, fresh.quoteId), errorCode("QUOTE_STALE"));
  assert.equal(stripe.named("applyUpgrade").length, 0);
});

test("si cambia el importe entre la propuesta y la confirmación, hay que revisarlo de nuevo", async (t) => {
  const { stripe, service } = paidSetup(state("starter"));
  const quote = await quoteFor(service, state("professional"));
  const original = stripe.previewChange.bind(stripe);
  t.mock.method(stripe, "previewChange", async (...args) => ({ ...(await original(...args)), amountDueNow: 9999 }));
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), errorCode("QUOTE_STALE"));
  assert.equal(stripe.named("applyUpgrade").length, 0);
});

test("una respuesta perdida de Stripe se recupera con la misma clave: nunca hay dos facturas", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  const quote = await quoteFor(service, state("professional"));
  stripe.loseNextResponse("applyUpgrade");
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId));
  assert.equal(stored(repository).change.status, "processing");
  const retried = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(retried.status, "payment_pending");
  const calls = stripe.named("applyUpgrade");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.key, calls[1].args.key);
  assert.equal(stripe.invoices.size, 1);
});

test("si Stripe rechaza aplicar una subida, el cambio se descarta: el plan sigue y la cuenta no queda bloqueada", async () => {
  const { BillingError } = require("../../.build/trainer-billing/types");
  const { stripe, repository, service } = paidSetup(state("free", "monthly", 1));
  const quote = await quoteFor(service, state("starter"));
  stripe.failNext("applyUpgrade", new BillingError("CHANGE_REJECTED", "Stripe no ha aceptado el cambio.", 503));
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), errorCode("CHANGE_REJECTED"));
  assert.equal(stored(repository).change.status, "discarded");
  assert.equal(stored(repository).quote, null);
  assert.deepEqual([stored(repository).tier, stored(repository).extraSeats], ["free", 1], "se conserva lo pagado");
  // Antes cada relectura reintentaba el cambio y fallaba: ahora sync funciona y se puede pedir otra propuesta.
  await service.sync(USER_ID);
  assert.equal(stripe.named("applyUpgrade").length, 1);
  const again = await quoteFor(service, state("starter"));
  assert.ok(again.quoteId);
});

test("un error de red al aplicar una subida no descarta el cambio: se reintenta con la misma clave", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  const quote = await quoteFor(service, state("professional"));
  stripe.failNext("applyUpgrade");
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId));
  assert.equal(stored(repository).change.status, "processing");
});

test("si Stripe responde pero falla el guardado local, el reintento no crea otra factura", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  const quote = await quoteFor(service, state("professional"));
  repository.failSaveWhen = (row) => row.change?.status === "payment_pending";
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId));
  await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(stripe.invoices.size, 1);
  assert.equal(stored(repository).change.status, "payment_pending");
});

test("una programación cuya respuesta se perdió se reintenta igual, sin duplicar calendarios", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 8));
  const quote = await quoteFor(service, state("starter", "monthly", 2));
  stripe.loseNextResponse("scheduleChange");
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId));
  await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(stripe.schedules.size, 1);
  assert.equal(stored(repository).change.status, "scheduled");
});

// ---------- Descartar, cancelar y reactivar ----------

test("descartar una bajada programada libera el calendario y nunca cancela la suscripción", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 8));
  await confirm(service, state("starter", "monthly", 2));
  await service.discardChange(USER_ID);
  assert.equal(stripe.named("releaseSchedule").length, 1);
  assert.equal(stripe.named("cancelSubscription").length, 0);
  assert.equal(stored(repository).change.status, "discarded");
  assert.equal(stripe.sub().scheduleId, null);
});

test("descartar una subida sin pagar anula solo su factura; lo pagado sigue y se puede pedir otra propuesta", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 3));
  await confirm(service, state("professional"));
  const invoiceId = stripe.sub().latestInvoiceId;
  await service.discardChange(USER_ID);
  assert.deepEqual(stripe.named("voidInvoice").map((call) => call.args.id), [invoiceId]);
  assert.equal(stored(repository).change.status, "discarded");
  assert.equal(repository.lastProjection.seats, 23);
  const quote = await quoteFor(service, state("scale"));
  assert.equal(quote.kind, "immediate");
});

test("cancelar y reactivar solo tocan la renovación, conservan lo pagado y se pueden repetir", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 2));
  await service.cancel(USER_ID);
  await service.cancel(USER_ID);
  assert.equal(stripe.named("setCancellation").length, 1);
  assert.equal(stripe.sub().cancelAtPeriodEnd, true);
  assert.equal(repository.lastProjection.seats, 22);
  await service.resume(USER_ID);
  await service.resume(USER_ID);
  assert.equal(stripe.named("setCancellation").length, 2);
  assert.equal(stripe.sub().cancelAtPeriodEnd, false);
});

test("una cancelación cuya respuesta se perdió la termina la reconciliación sin otra petición", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.loseNextResponse("setCancellation");
  await assert.rejects(service.cancel(USER_ID));
  assert.equal(stored(repository).control.done, undefined);
  await service.reconcile();
  assert.equal(stored(repository).control.done, true);
  assert.equal(stripe.sub().cancelAtPeriodEnd, true);
});

test("una bajada programada se puede sustituir por una subida: se libera el calendario antes de cobrar", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 8));
  await confirm(service, state("starter", "monthly", 2));
  const { result } = await confirm(service, state("professional"));
  assert.equal(result.status, "payment_pending");
  const order = stripe.calls.map((call) => call.name).filter((name) => ["releaseSchedule", "applyUpgrade"].includes(name));
  assert.deepEqual(order, ["releaseSchedule", "applyUpgrade"]);
  assert.equal(stored(repository).change.quote.to.tier, "professional");
});

test("una bajada programada se puede sustituir por otra sin duplicar calendarios", async () => {
  const { stripe, service } = paidSetup(state("starter", "monthly", 8));
  await confirm(service, state("starter", "monthly", 2));
  await confirm(service, state("starter", "monthly", 4));
  assert.equal(stripe.named("releaseSchedule").length, 1);
  assert.equal(stripe.named("scheduleChange").length, 2);
  assert.equal(stripe.subs.filter((sub) => sub.scheduleId).length, 1);
});

test("las operaciones se niegan con la cuenta borrándose o una suscripción de otro usuario", async () => {
  const deleting = paidSetup(state("starter"), { account: { deletedAt: new Date() } });
  await assert.rejects(quoteFor(deleting.service, state("professional")), errorCode("ACCOUNT_DELETION_PENDING"));
  const foreign = paidSetup(state("starter"), { sub: { userId: "someone-else" } });
  await assert.rejects(foreign.service.cancel(USER_ID), errorCode("SUBSCRIPTION_NOT_OWNED"));
});

// ---------- Renovación, impago y eventos ----------

test("una renovación fallida expone su factura; la factura de un cambio pendiente no se ofrece como renovación", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.renew(false);
  await service.sync(USER_ID);
  assert.equal(stored(repository).renewalPayment.invoiceId, stripe.sub().latestInvoiceId);
  assert.equal(repository.lastProjection.entitled, true, "7 días de margen mientras Stripe reintenta");
  const pending = paidSetup(state("starter"));
  await confirm(pending.service, state("professional"));
  assert.equal(stored(pending.repository).renewalPayment, null);
});

test("la próxima renovación sale de Stripe, se cachea por huella de la suscripción y desaparece al cancelar", async (t) => {
  const { stripe, repository, service } = paidSetup(state("starter", "annual", 4));
  const renewal = t.mock.method(stripe, "upcomingRenewal");
  await service.sync(USER_ID);
  await service.sync(USER_ID);
  assert.equal(renewal.mock.callCount(), 1);
  assert.deepEqual(stored(repository).renewal.state, state("starter", "annual", 4));
  await service.cancel(USER_ID);
  assert.equal(stored(repository).renewal, null);
});

test("un evento con fallo al proyectar queda pendiente y se reintenta; los repetidos no hacen nada", async () => {
  const { repository, service } = paidSetup(state("starter"));
  repository.projectFailures = 1;
  await assert.rejects(service.event(event({ eventId: "evt_retry" })));
  assert.equal(repository.events.get("evt_retry").status, "failed");
  await service.reconcile();
  assert.equal(repository.events.get("evt_retry").status, "processed");
  const before = repository.projections.length;
  await service.event(event({ eventId: "evt_retry" }));
  assert.equal(repository.projections.length, before, "un evento ya procesado no se reaplica");
  // Clientes de Stripe ajenos a Trainers no tocan nada.
  await service.event(event({ eventId: "evt_other", customerId: "cus_other_product" }));
  assert.equal(repository.events.get("evt_other").status, "processed");
});

test("eventos desordenados releen el estado actual de Stripe en vez de aplicar el del evento", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  const { result } = await confirm(service, state("professional"));
  assert.equal(result.status, "payment_pending");
  stripe.pay(stripe.sub().latestInvoiceId);
  // Llega primero un evento antiguo de "pago fallido": el estado de Stripe ya es el pagado.
  await service.event(event({ eventId: "evt_old", type: "invoice.payment_failed" }));
  assert.equal(repository.lastProjection.seats, 50);
});

test("borrar la cuenta deja la marca antes de tocar Stripe, caduca Checkout y cancela con reintento seguro", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  stripe.sessions.push(session({ status: "open" }));
  stripe.failNext("cancelSubscription");
  await assert.rejects(service.prepareDeletion(USER_ID));
  assert.ok(stored(repository).deletedAt, "la marca se guardó antes de llamar a Stripe");
  await service.prepareDeletion(USER_ID);
  assert.equal(stripe.sessions[0].status, "expired");
  assert.equal(stripe.sub().status, "canceled");
  assert.equal(repository.lastProjection.entitled, false);
});

test("con la facturación apagada no se borra una cuenta que tiene cliente en Stripe", async () => {
  const repository = new MemoryRepository(account({ status: "active" }));
  const service = new TrainerBillingService(loadConfig({}), repository, new FakeStripe());
  await assert.rejects(service.prepareDeletion(USER_ID), errorCode("BILLING_DISABLED"));
  // Sin cliente en Stripe no hay nada que cancelar: el borrado sigue aunque la facturación esté apagada.
  const empty = new TrainerBillingService(loadConfig({}), new MemoryRepository(), new FakeStripe());
  await empty.prepareDeletion(USER_ID);
});

test("las condiciones aceptadas en Checkout quedan registradas con la sesión", async () => {
  const { stripe, repository, service } = freeSetup({ env: { STRIPE_TERMS_URL: "https://trainfit.net/condiciones" } });
  const { sessionId } = await service.checkout(USER_ID, { tier: "starter", interval: "monthly" });
  stripe.completeCheckout(sessionId);
  stripe.sessions[0].termsAccepted = true;
  await service.sync(USER_ID, sessionId);
  assert.deepEqual(stored(repository).termsAcceptance, { at: stored(repository).termsAcceptance.at, via: "checkout", ref: sessionId,
    termsUrl: "https://trainfit.net/condiciones" });
  assert.equal(stored(repository).termsHistory.length, 1);
});

test("un cambio en la app registra la aceptación de las condiciones vigentes; si cambiaron, se pide revisarlas", async () => {
  const terms = "https://trainfit.net/condiciones/2026-10";
  const { stripe, repository, service } = paidSetup(state("starter", "monthly", 5), { env: { STRIPE_TERMS_URL: terms } });
  const quote = await quoteFor(service, state("starter", "monthly", 9));
  assert.equal(quote.termsUrl, terms);
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), errorCode("TERMS_CHANGED"), "sin las condiciones mostradas no se confirma");
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId, "https://trainfit.net/condiciones/2025-01"), errorCode("TERMS_CHANGED"));
  assert.equal(stripe.named("applyUpgrade").length, 0);
  await service.changePlan(USER_ID, quote.quoteId, terms);
  const row = stored(repository);
  assert.deepEqual([row.termsAcceptance.via, row.termsAcceptance.ref, row.termsAcceptance.termsUrl], ["change", quote.quoteId, terms]);
  stripe.pay(stripe.sub().latestInvoiceId);
  await service.event(event({ eventId: "evt_terms_paid" }));
  const second = await quoteFor(service, state("starter", "monthly", 12));
  await service.changePlan(USER_ID, second.quoteId, terms);
  assert.equal(stored(repository).termsHistory.length, 2, "cada aceptación queda en el historial");
  // Sin condiciones publicadas no se exige ni se registra nada.
  const plain = paidSetup(state("starter"));
  const plainQuote = await quoteFor(plain.service, state("professional"));
  assert.equal(plainQuote.termsUrl, null);
  await plain.service.changePlan(USER_ID, plainQuote.quoteId);
  assert.equal(stored(plain.repository).termsAcceptance, undefined);
});
