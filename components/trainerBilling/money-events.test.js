const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService, effectiveAccess } = require("../../.build/trainer-billing/service");
const { billingMetadata } = require("../../.build/trainer-billing/runtime");
const { CUSTOMER_ID, DAY, FakeStripe, MemoryRepository, USER_ID, account, errorCode, event, paidSetup, priceRef, sandboxConfig,
  state, subscription } = require("./test-support");

const ADMIN = { id: "admin-one", email: "admin@example.test" };
const stored = (repository) => repository.accounts.get(USER_ID);
const line = (kind, value, { amount, quantity = 1, proration = false, start, end }) => ({ amount, price: priceRef(kind, value.tier, value.interval),
  quantity, proration, subscriptionItem: `si_${kind}`, periodStart: start, periodEnd: end });

// Cargo de Stripe (releído en cada evento) que pagó la factura de un periodo.
function periodPayment(sub, { amount = 2900, refunds = [] } = {}) {
  return { chargeId: "ch_period", paymentIntentId: "pi_period", customerId: CUSTOMER_ID, amount,
    amountRefunded: refunds.reduce((sum, refund) => sum + refund.amount, 0), refunded: refunds.reduce((sum, r) => sum + r.amount, 0) >= amount,
    currency: "eur", refunds, invoice: { id: "in_period", subscriptionId: sub.id, customerId: CUSTOMER_ID, billingReason: "subscription_cycle",
      amountPaid: amount, currency: "eur", lines: [line("base", sub.state, { amount, start: sub.currentPeriodStart, end: sub.currentPeriodEnd })] } };
}
const refund = (amount, status = "succeeded", id = "re_1") => ({ id, amount, status, reason: null, failureReason: null, createdAt: new Date() });
const refundEvent = (id = "evt_refund") => event({ eventId: id, type: "charge.refunded", customerId: null,
  detail: { chargeId: "ch_period", paymentIntentId: "pi_period", fullyRefunded: true } });
const disputeEvent = (id, disputeId = "dp_1") => event({ eventId: id, type: "charge.dispute.updated", customerId: null, detail: { disputeId } });
const intervene = (service, input) => service.intervene(USER_ID, { reason: "Decisión de facturación", ...input }, ADMIN);

test("un reembolso total del periodo nunca termina el acceso por sí solo: abre un caso de prioridad alta", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter"));
  stripe.payment = periodPayment(sub, { refunds: [refund(2900)] });
  await service.event(refundEvent());
  const entry = repository.cases.get("refund:ch_period");
  assert.deepEqual([entry.kind, entry.priority, entry.role, entry.suggestion, entry.fullyRefunded], ["refund", "high", "current_period",
    "decide_end_or_keep", true]);
  assert.equal(entry.financed.kind, "period");
  assert.deepEqual(entry.financed.state, state("starter"));
  assert.equal(repository.lastProjection.entitled, true);
  assert.equal(stripe.named("cancelSubscription").length, 0);
});

test("reembolsar plazas anuales añadidas sugiere retirarlas; retirarlas no toca la cuota ni cobra nada", async () => {
  const { stripe, repository, service } = paidSetup(state("starter", "annual", 5));
  const quote = await service.previewChange(USER_ID, { tier: "starter", interval: "annual", extraSeats: 15 });
  assert.equal(quote.kind, "immediate");
  await service.changePlan(USER_ID, quote.quoteId);
  const invoiceId = stripe.sub().latestInvoiceId;
  stripe.pay(invoiceId);
  await service.event(event({ eventId: "evt_paid" }));
  assert.equal(repository.lastProjection.seats, 35);
  const sub = stripe.sub();
  stripe.payment = { chargeId: "ch_seats", paymentIntentId: "pi_seats", customerId: CUSTOMER_ID, amount: 5000, amountRefunded: 5000,
    refunded: true, currency: "eur", refunds: [refund(5000, "succeeded", "re_seats")], invoice: { id: invoiceId, subscriptionId: sub.id,
      customerId: CUSTOMER_ID, billingReason: "subscription_update", amountPaid: 5000, currency: "eur", lines: [
        line("seat", sub.state, { amount: -2500, quantity: 5, proration: true, start: sub.currentPeriodStart, end: sub.currentPeriodEnd }),
        line("seat", sub.state, { amount: 7500, quantity: 15, proration: true, start: sub.currentPeriodStart, end: sub.currentPeriodEnd })] } };
  await service.event(event({ eventId: "evt_refund_seats", type: "charge.refunded", customerId: null, detail: { chargeId: "ch_seats" } }));
  const entry = repository.cases.get("refund:ch_seats");
  assert.deepEqual([entry.role, entry.suggestion, entry.financed.kind], ["current_upgrade", "revert_upgrade", "upgrade"]);
  assert.deepEqual(entry.financed.fromState, state("starter", "annual", 5));

  await intervene(service, { action: "revert_upgrade", caseId: "refund:ch_seats", resolveCase: true });
  assert.deepEqual(stripe.named("revertState").map((call) => call.args.value), [state("starter", "annual", 5)]);
  assert.deepEqual(stripe.sub().state, state("starter", "annual", 5), "la cuota anual sigue");
  assert.equal(stored(repository).change.status, "reverted");
  assert.equal(repository.lastProjection.seats, 25);
  assert.equal(repository.cases.get("refund:ch_seats").status, "resolved");
  assert.equal(stripe.named("applyUpgrade").length, 1, "deshacer no genera otro cobro");
});

test("reembolsos parciales, antiguos y fallidos se registran con su prioridad; un movimiento nuevo reabre un caso resuelto", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter"));
  stripe.payment = periodPayment(sub, { refunds: [refund(500)] });
  await service.event(refundEvent("evt_partial"));
  let entry = repository.cases.get("refund:ch_period");
  assert.deepEqual([entry.priority, entry.suggestion, entry.fullyRefunded], ["normal", "keep_access", false]);
  await intervene(service, { action: "resolve_case", caseId: "refund:ch_period" });
  assert.equal(repository.cases.get("refund:ch_period").status, "resolved");
  stripe.payment = periodPayment(sub, { refunds: [refund(500), refund(400, "failed", "re_2")] });
  await service.event(refundEvent("evt_failed"));
  entry = repository.cases.get("refund:ch_period");
  assert.deepEqual([entry.status, entry.priority, entry.suggestion], ["open", "high", "check_failed_refund"]);
  assert.equal(entry.notes.length, 1);
  // Un periodo ya terminado nunca toca el acceso de hoy.
  const old = periodPayment(sub, { refunds: [refund(2900)] });
  old.chargeId = "ch_old";
  old.invoice.lines[0].periodStart = sub.currentPeriodStart - 60 * DAY;
  old.invoice.lines[0].periodEnd = sub.currentPeriodStart - 30 * DAY;
  stripe.payment = old;
  await service.event(event({ eventId: "evt_old", type: "charge.refunded", customerId: null, detail: { chargeId: "ch_old" } }));
  assert.deepEqual([repository.cases.get("refund:ch_old").role, repository.cases.get("refund:ch_old").suggestion], ["past", "keep_access"]);
});

test("una disputa abierta pausa los cobros una vez, mantiene el acceso y bloquea cambios con cobro", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter", "monthly", 4));
  stripe.payment = periodPayment(sub);
  stripe.dispute = { id: "dp_1", status: "needs_response", amount: 2900, currency: "eur", reason: "fraudulent", chargeId: "ch_period",
    paymentIntentId: "pi_period", dueBy: new Date(Date.now() + 7 * DAY * 1000), createdAt: new Date() };
  await service.event(disputeEvent("evt_d1"));
  await service.event(disputeEvent("evt_d2"));
  assert.equal(stripe.named("pauseCollection").length, 1);
  const entry = repository.cases.get("dispute:dp_1");
  assert.deepEqual([entry.priority, entry.suggestion, entry.effects], ["high", "respond_dispute", ["collection_paused"]]);
  assert.equal(repository.lastProjection.seats, 24);
  await assert.rejects(service.previewChange(USER_ID, { tier: "professional", interval: "monthly" }), errorCode("COLLECTION_PAUSED"));
  assert.ok(billingMetadata(sandboxConfig(), stored(repository)).billing.hold);
});

test("una disputa perdida retira solo lo que financiaba su pago, y nunca un periodo antiguo", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter", "monthly", 4));
  stripe.payment = periodPayment(sub);
  stripe.dispute = { id: "dp_lost", status: "lost", amount: 2900, currency: "eur", reason: "fraudulent", chargeId: "ch_period",
    paymentIntentId: "pi_period", dueBy: null, createdAt: new Date() };
  await service.event(disputeEvent("evt_lost", "dp_lost"));
  const entry = repository.cases.get("dispute:dp_lost");
  assert.deepEqual(entry.effects, ["rights_withdrawn:period"]);
  const adjustment = stored(repository).adjustments[0];
  assert.deepEqual([adjustment.kind, adjustment.tier, adjustment.source], ["revoke_period", "starter", "dispute_lost"]);
  assert.equal(effectiveAccess(stored(repository)).entitled, false);
  assert.equal(repository.lastProjection.seats, 3);
  // Restaurar el periodo es una decisión registrada de Gestión.
  await intervene(service, { action: "restore_period_access", adjustmentId: adjustment.id });
  assert.equal(repository.lastProjection.seats, 24);
});

test("una disputa ganada mantiene el acceso y pide decidir si se reanudan los cobros; reanudar reactiva los reintentos", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter"));
  stripe.payment = periodPayment(sub);
  stripe.dispute = { id: "dp_won", status: "needs_response", amount: 2900, currency: "eur", reason: null, chargeId: "ch_period",
    paymentIntentId: "pi_period", dueBy: null, createdAt: new Date() };
  await service.event(disputeEvent("evt_open", "dp_won"));
  stripe.dispute = { ...stripe.dispute, status: "won" };
  await service.event(disputeEvent("evt_won", "dp_won"));
  assert.equal(repository.cases.get("dispute:dp_won").suggestion, "decide_collection");
  await intervene(service, { action: "resume_collection", caseId: "dispute:dp_won", resolveCase: true });
  assert.deepEqual(stripe.named("resumeCollection")[0].args.paused, ["in_retry"]);
  assert.equal(stored(repository).hold, null);
  assert.equal(repository.lastProjection.entitled, true);
});

test("un aviso de fraude temprano abre un caso prioritario y no cambia nada más", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter"));
  stripe.payment = periodPayment(sub);
  stripe.warning = { id: "issfr_1", chargeId: "ch_period", paymentIntentId: "pi_period", fraudType: "card_never_received", actionable: true,
    createdAt: new Date() };
  await service.event(event({ eventId: "evt_efw", type: "radar.early_fraud_warning.created", customerId: null, detail: { warningId: "issfr_1" } }));
  const entry = repository.cases.get("efw:issfr_1");
  assert.deepEqual([entry.priority, entry.suggestion], ["high", "review_fraud_warning"]);
  assert.equal(stripe.named("pauseCollection").length, 0);
  assert.equal(stripe.named("cancelSubscription").length, 0);
});

test("las intervenciones exigen motivo, registran autor y resultado, y fallan cerradas", async () => {
  const { repository, service } = paidSetup(state("starter"));
  await assert.rejects(service.intervene(USER_ID, { action: "grant_access", reason: "" }, ADMIN), errorCode("REASON_REQUIRED"));
  await assert.rejects(intervene(service, { action: "delete_everything" }), errorCode("INVALID_ACTION"));
  await assert.rejects(intervene(service, { action: "grant_access", tier: "free", until: new Date(Date.now() + DAY * 1000).toISOString() }),
    errorCode("INVALID_TIER"), "Free no se concede: es lo que queda sin pago");
  await assert.rejects(intervene(service, { action: "grant_access", tier: "scale", until: new Date(Date.now() + 500 * DAY * 1000).toISOString() }),
    errorCode("INVALID_UNTIL"));
  const detail = await intervene(service, { action: "grant_access", tier: "scale", until: new Date(Date.now() + 10 * DAY * 1000).toISOString() });
  assert.equal(detail.access.seats, 150);
  assert.equal(detail.access.basis, "exception");
  const [record] = repository.interventions;
  assert.deepEqual([record.status, record.by.id, record.before.seats, record.after.seats], ["applied", "admin-one", 20, 150]);
  await assert.rejects(intervene(service, { action: "revert_upgrade" }), errorCode("NOT_REVERTIBLE"));
  assert.equal(repository.interventions.at(-1).status, "failed");
  assert.equal(repository.interventions.at(-1).error, "NOT_REVERTIBLE");
});

test("pausar los cobros a mano bloquea los cambios; la pausa de Stripe se refleja en los dos sentidos", async () => {
  const { stripe, repository, service } = paidSetup(state("starter"));
  await intervene(service, { action: "pause_collection" });
  assert.equal(stored(repository).hold.kind, "admin");
  await assert.rejects(service.previewChange(USER_ID, { tier: "professional", interval: "monthly" }), errorCode("COLLECTION_PAUSED"));
  stripe.sub().collectionPaused = false;
  await service.sync(USER_ID);
  assert.equal(stored(repository).hold, null, "reanudada fuera de TrainFit");
  stripe.sub().collectionPaused = true;
  await service.sync(USER_ID);
  assert.equal(stored(repository).hold.kind, "admin", "pausada desde el Dashboard");
});

test("el aviso anual sale a 30 y a 7 días, una vez cada uno, solo si se va a renovar, y dice las plazas", async () => {
  const sent = [];
  const notifier = { async renewalReminder(input) { sent.push(input); } };
  const value = state("starter", "annual", 6);
  const at = Math.floor(Date.now() / 1000) + 20 * DAY;
  const { stripe, repository, service } = paidSetup(value, { sub: { currentPeriodEnd: at, paidPeriodEnd: at } });
  const withNotifier = new TrainerBillingService(service.config, repository, stripe, notifier);
  await withNotifier.reconcile();
  await withNotifier.reconcile();
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].stage, sent[0].tier, sent[0].seats, sent[0].amount], [30, "starter", 26, 29000 + 6 * 1000]);
  assert.match(sent[0].manageUrl, /\/tabs\/subscription$/);
  stripe.sub().cancelAtPeriodEnd = true;
  const monthly = paidSetup(state("starter", "monthly", 6), { sub: { currentPeriodEnd: at, paidPeriodEnd: at } });
  await new TrainerBillingService(monthly.config, monthly.repository, monthly.stripe, notifier).reconcile();
  assert.equal(sent.length, 1, "los planes mensuales no llevan aviso");
});

test("la recuperación trae los eventos de dinero que el webhook no entregó y nunca procesa uno dos veces", async () => {
  const { stripe, repository, service, sub } = paidSetup(state("starter"));
  stripe.payment = periodPayment(sub, { refunds: [refund(2900)] });
  stripe.recent = [refundEvent("evt_missed")];
  const now = Date.now();
  assert.equal(await service.backfillMoneyEvents(now), 1);
  assert.equal(await service.backfillMoneyEvents(now + 60000), 0, "como mucho cada 10 minutos");
  assert.equal(await service.backfillMoneyEvents(now + 11 * 60000), 1);
  assert.equal(repository.events.get("evt_missed").status, "processed");
  assert.equal(stripe.named("paymentContext").length, 1, "el ya procesado no se vuelve a releer ni a aplicar");
  assert.ok(repository.cases.get("refund:ch_period"));
});

test("la renovación anual en los próximos 30 días se anuncia también en la app, con el soporte de la configuración", () => {
  const config = sandboxConfig({ STRIPE_SUPPORT_EMAIL: "facturacion@trainfit.net" });
  const at = new Date(Date.now() + 10 * DAY * 1000);
  const row = account({ status: "active", tier: "starter", interval: "annual", extraSeats: 0, subscriptionId: "sub_trainers",
    paidUntil: at, provider: subscription(state("starter", "annual")), renewal: { at, amount: 29000, fingerprint: "x", state: state("starter", "annual") } });
  const { billing } = billingMetadata(config, row);
  assert.equal(billing.renewalNotice.daysLeft, 10);
  assert.equal(billing.renewalNotice.amount, 29000);
  assert.deepEqual(billing.support, { email: "facturacion@trainfit.net", termsUrl: null });
  assert.equal(billingMetadata(config, { ...row, interval: "monthly" }).billing.renewalNotice, null);
});

test("los casos y la ficha de Gestión solo se ven con la facturación activa", async () => {
  const repository = new MemoryRepository(account());
  const disabled = new TrainerBillingService({ ...sandboxConfig(), enabled: false }, repository, new FakeStripe());
  await assert.rejects(disabled.adminCases(), errorCode("BILLING_DISABLED"));
  const { service } = paidSetup(state("professional", "monthly", 30));
  const detail = await service.adminTrainer(USER_ID);
  assert.deepEqual([detail.account.tier, detail.account.extraSeats, detail.access.seats], ["professional", 30, 80]);
  assert.match(detail.links.customer, /^https:\/\/dashboard\.stripe\.com\/test\/customers\//);
});
