import { publicPlans, requireReady, resolvePrice } from "./config";
import { checkoutKey } from "./stripe-gateway";
import { Account, BillingDetails, BillingError, ChangeQuote, Config, EventRecord, Gateway, PriceView, Projection, Repository, Session, Subscription, User } from "./types";

const TERMINAL = new Set(["canceled", "incomplete_expired"]);
export function changeKind(from: PriceView, to: PriceView): ChangeQuote["kind"] {
  if (from.interval !== to.interval) return from.interval === "annual" ? "scheduled" : "immediate";
  return to.clientLimit > from.clientLimit ? "immediate" : "scheduled";
}
function subscriptionSnapshot(sub: Subscription): string {
  return sub.fingerprint || JSON.stringify([sub.id, sub.itemId, sub.priceId, sub.currentPeriodEnd,
    sub.latestInvoiceId, sub.latestInvoiceStatus, sub.status, sub.cancelAtPeriodEnd, sub.scheduleId, sub.pendingUpdate]);
}
// Decisión de negocio 2026-09-18: si falla el cobro de una renovación, el plan
// pagado se mantiene 7 días mientras Stripe reintenta; después cae a Free.
export const PAST_DUE_GRACE_MS = 7 * 86400000;
export function accessUntil(account: Account): Date | null {
  if (!account.paidUntil) return null;
  const paidUntil = new Date(account.paidUntil);
  return account.status === "past_due" ? new Date(paidUntil.getTime() + PAST_DUE_GRACE_MS) : paidUntil;
}
export function projection(account: Account, now = new Date()): Projection {
  const until = accessUntil(account);
  const entitled = !account.deletedAt && ["active", "past_due"].includes(account.status) &&
    Boolean(account.tier && until && until > now);
  return { entitled: Boolean(entitled), source: "stripe", tier: account.tier || null,
    plan: account.interval || null, expiresAt: until, lastSyncAt: now,
    stripeRevision: account.revision, stripeMode: account.mode };
}

export class TrainerBillingService {
  constructor(readonly config: Config, readonly repository: Repository, readonly gateway: Gateway) {}
  plans() { return publicPlans(this.config); }
  private async user(id: string): Promise<User> {
    const user = await this.repository.getUser(id);
    if (!user) throw new BillingError("USER_NOT_FOUND", "La cuenta no está disponible.", 404);
    return user;
  }
  private async persist(account: Account, save: () => Promise<void>): Promise<void> {
    await save();
    await this.repository.project(account, projection(account));
  }
  private ensureOpen(account: Account): void {
    if (account.deletedAt) throw new BillingError("ACCOUNT_DELETION_PENDING", "La cuenta está en proceso de eliminación.");
  }
  private ownSession(session: Session, account: Account): void {
    if (session.livemode !== (this.config.mode === "live") || session.customerId !== account.customerId || session.userId !== account.userId || session.scope !== "trainers") {
      throw new BillingError("SESSION_NOT_OWNED", "La sesión de pago no pertenece a tu cuenta.", 403);
    }
  }
  private async refresh(account: Account, save: () => Promise<void>): Promise<void> {
    this.ensureOpen(account);
    if (!account.customerId) return;
    await this.recoverChange(account, save);
    await this.recoverControl(account, save);
    const subscriptions = await this.gateway.listSubscriptions(account.customerId);
    const active = subscriptions.filter((sub) => !TERMINAL.has(sub.status));
    if (active.length > 1) throw new BillingError("MULTIPLE_SUBSCRIPTIONS", "Contacta con soporte para revisar tus suscripciones.");
    const sub = active[0] || subscriptions.find((s) => s.id === account.subscriptionId);
    if (!sub) {
      if (account.subscriptionId) { account.status = "canceled"; account.paidUntil = null; }
      await this.persist(account, save);
      return;
    }
    if (sub.livemode !== (this.config.mode === "live") || sub.customerId !== account.customerId || sub.scope !== "trainers" || sub.userId !== account.userId) {
      throw new BillingError("SUBSCRIPTION_NOT_OWNED", "La suscripción requiere revisión de soporte.");
    }
    const plan = this.config.plans.find((p) => Object.values(p.prices).some((price) => price.id === sub.priceId));
    const price = plan && Object.values(plan.prices).find((p) => p.id === sub.priceId);
    if (!plan || !price || sub.quantity !== 1) throw new BillingError("UNKNOWN_SUBSCRIPTION_PRICE", "La suscripción requiere revisión de soporte.");
    account.subscriptionId = sub.id;
    account.status = sub.status;
    account.cancelAtPeriodEnd = sub.cancelAtPeriodEnd;
    account.currentPeriodEnd = new Date(sub.currentPeriodEnd * 1000);
    account.provider = sub;
    // A status of active alone is not proof of payment (e.g. unpaid plan change).
    if (sub.status === "active" && sub.paid && sub.paidPriceId === price.id && sub.paidPeriodEnd > 0) {
      account.tier = plan.tier;
      account.interval = price.interval;
      account.paidUntil = new Date(Math.min(sub.currentPeriodEnd, sub.paidPeriodEnd) * 1000);
    }
    const change = account.change;
    account.pendingPayment = null;
    if (change?.status === "payment_pending" && change.invoiceId) {
      const payment = await this.gateway.changePayment(account, change);
      if (payment.paid && !sub.pendingUpdate && sub.status === "active" && sub.priceId === change.quote.targetPriceId && payment.periodEnd > 0) {
        // This is an explicitly tracked, paid change invoice. Arbitrary proration
        // invoices still cannot grant access through the generic renewal path.
        account.tier = change.quote.to.tier;
        account.interval = change.quote.to.interval;
        account.paidUntil = new Date(Math.min(sub.currentPeriodEnd, payment.periodEnd) * 1000);
        change.status = "applied";
      } else if (payment.voided || (!sub.pendingUpdate && sub.priceId !== change.quote.targetPriceId)) {
        change.status = "discarded";
      } else {
        account.pendingPayment = { url: payment.url,
          expiresAt: sub.pendingUpdateExpiresAt ? new Date(sub.pendingUpdateExpiresAt * 1000) : undefined };
      }
    }
    if (change?.status === "scheduled" && !sub.scheduleId) {
      change.status = sub.priceId === change.quote.targetPriceId ? "applied" : "discarded";
    }
    // The schedule may still own its final phase after the transition. Its change
    // is complete once the canonical item has changed; renewal payment gates access.
    if (change?.status === "scheduled" && sub.priceId === change.quote.targetPriceId) change.status = "applied";
    if (TERMINAL.has(sub.status) || ["unpaid", "paused", "incomplete", "trialing"].includes(sub.status)) account.paidUntil = null;
    account.renewalPayment = ["past_due", "unpaid"].includes(sub.status) && sub.latestInvoiceStatus === "open" && sub.latestInvoiceId &&
      account.change?.invoiceId !== sub.latestInvoiceId
      ? { url: sub.latestInvoiceUrl, amount: sub.latestInvoiceAmountDue || 0, invoiceId: sub.latestInvoiceId } : null;
    await this.refreshRenewal(account, sub);
    await this.persist(account, save);
  }
  // Display-only data: a failed preview must never block webhooks or access.
  private async refreshRenewal(account: Account, sub: Subscription): Promise<void> {
    const fingerprint = subscriptionSnapshot(sub);
    if (sub.cancelAtPeriodEnd || TERMINAL.has(sub.status) || !this.gateway.upcomingRenewal) { account.renewal = null; return; }
    // Registros previos a guardar priceId se recalculan una vez.
    if (account.renewal?.fingerprint === fingerprint && account.renewal.priceId !== undefined) return;
    try {
      const next = await this.gateway.upcomingRenewal(sub);
      account.renewal = next ? { at: new Date(next.at * 1000), amount: next.amount, fingerprint,
        priceId: next.priceId, subtotal: next.subtotal } : null;
    } catch { account.renewal = null; }
  }
  private async recoverChange(account: Account, save: () => Promise<void>): Promise<void> {
    const change = account.change;
    if (!change || change.status !== "processing") return;
    if (Date.now() - new Date(change.startedAt).getTime() > 23 * 3600000) {
      throw new BillingError("CHANGE_REVIEW_REQUIRED", "El cambio requiere revisión de soporte antes de reintentarlo.");
    }
    const key = `trainers-change-${change.quote.quoteId}`;
    if (change.quote.previousScheduleId) await this.gateway.releaseSchedule(change.quote.previousScheduleId, `${key}-release`);
    if (change.quote.kind === "immediate") {
      change.invoiceId = (await this.gateway.applyUpgrade(change.quote, key)).invoiceId;
      change.status = "payment_pending";
    } else {
      change.scheduleId = (await this.gateway.scheduleChange(change.quote, key)).scheduleId;
      change.status = "scheduled";
    }
    await save();
  }
  private async recoverControl(account: Account, save: () => Promise<void>): Promise<void> {
    const op = account.control;
    if (!op || op.done) return;
    if (Date.now() - new Date(op.startedAt).getTime() > 23 * 3600000 || !account.subscriptionId) {
      throw new BillingError("CHANGE_REVIEW_REQUIRED", "La operación requiere revisión de soporte.");
    }
    if (op.invoiceId && op.kind !== "resume") await this.gateway.voidInvoice(op.invoiceId, `${op.id}-void`);
    if (op.scheduleId && op.kind !== "resume") await this.gateway.releaseSchedule(op.scheduleId, `${op.id}-release`);
    if (op.kind !== "discard") await this.gateway.setCancellation(account.subscriptionId, op.kind === "cancel", `${op.id}-${op.kind}`);
    op.done = true;
    account.quote = null;
    await save();
  }
  private editable(account: Account): Subscription {
    this.ensureOpen(account);
    const sub = account.provider;
    if (!sub || sub.status !== "active" || !account.paidUntil || new Date(account.paidUntil) <= new Date() || !sub.itemId ||
        (sub.collectionMethod && sub.collectionMethod !== "charge_automatically")) {
      throw new BillingError("SUBSCRIPTION_NOT_ACTIVE", "Necesitas una suscripción activa y pagada para cambiar de plan.");
    }
    if (sub.pendingUpdate || account.change?.status === "payment_pending") throw new BillingError("PAYMENT_PENDING", "Resuelve o descarta el pago pendiente antes de cambiar de plan.");
    if (sub.cancelAtPeriodEnd) throw new BillingError("CANCELLATION_SCHEDULED", "Reactiva la suscripción antes de cambiar de plan.");
    // Our own scheduled change may be replaced: the new quote carries its
    // schedule as previousScheduleId and recoverChange releases it before
    // applying the replacement. Any other schedule still needs support review.
    const ownSchedule = Boolean(sub.scheduleId) && account.change?.scheduleId === sub.scheduleId &&
      ["scheduled", "applied"].includes(account.change?.status || "");
    if (account.change?.status === "scheduled" && !ownSchedule) throw new BillingError("CHANGE_ALREADY_SCHEDULED", "Descarta el cambio programado antes de elegir otro.");
    const discardedInvoice = account.change?.status === "discarded" && account.change.invoiceId === sub.latestInvoiceId && sub.latestInvoiceStatus === "void";
    if (sub.latestInvoiceStatus !== "paid" && !discardedInvoice) throw new BillingError("PAYMENT_PENDING", "Paga la factura pendiente antes de cambiar de plan.");
    // A completed schedule can retain its final phase until the following renewal.
    if (sub.scheduleId && !ownSchedule) {
      throw new BillingError("CHANGE_ALREADY_SCHEDULED", "La suscripción ya tiene un cambio programado.");
    }
    return sub;
  }
  private async usageFor(userId: string, limit: number): Promise<number> {
    const clients = await this.repository.clientUsage(userId);
    if (!Number.isSafeInteger(clients) || clients < 0) throw new BillingError("USAGE_UNAVAILABLE", "No se ha podido comprobar el número de clientes.", 503);
    if (clients > limit) throw new BillingError("CLIENT_LIMIT_EXCEEDED", "El plan elegido no admite todos tus clientes actuales. Reduce el número de clientes antes de cambiar.");
    return clients;
  }
  async previewChange(userId: string, tier: unknown, interval: unknown) {
    requireReady(this.config);
    const target = resolvePrice(this.config, tier, interval);
    return this.repository.withLock(userId, async (account, save) => {
      await this.refresh(account, save);
      const sub = this.editable(account);
      const current = resolvePrice(this.config, account.tier, account.interval);
      if (target.price.id === sub.priceId) throw new BillingError("SAME_PLAN", "Ya tienes ese plan y periodicidad.");
      if (account.change?.status === "scheduled" && account.change.quote.targetPriceId === target.price.id) {
        throw new BillingError("SAME_SCHEDULED_CHANGE", "Ese cambio ya está programado.");
      }
      const from: PriceView = { tier: current.plan.tier, interval: current.price.interval, amount: current.price.amount, clientLimit: current.plan.clientLimit };
      const to: PriceView = { tier: target.plan.tier, interval: target.price.interval, amount: target.price.amount, clientLimit: target.plan.clientLimit };
      const clients = await this.usageFor(userId, to.clientLimit);
      await this.gateway.validatePrice(target.price);
      const kind = changeKind(from, to);
      // Stripe test-clock subscriptions bill in simulated time. Mixing that
      // clock with wall time can prorate even a newly started annual period.
      const prorationDate = sub.billingNow ?? Math.floor(Date.now() / 1000);
      const preview = await this.gateway.previewChange(sub, target.price, kind, prorationDate);
      const quote: ChangeQuote = { quoteId: checkoutKey(), expiresAt: new Date(Date.now() + 5 * 60000), kind, from, to,
        effectiveAt: new Date((kind === "immediate" ? prorationDate : sub.currentPeriodEnd) * 1000),
        amountDueNow: preview.amountDueNow, currency: "eur", creditBalance: preview.creditBalance || 0,
        lines: preview.lines || [], taxAmount: preview.taxAmount || 0,
        nextRenewal: { at: new Date((preview.renewalAt || sub.currentPeriodEnd) * 1000), amount: preview.renewalAmount, estimated: true,
          excludesTax: Boolean(preview.renewalExcludesTax) },
        usage: { clients, limit: from.clientLimit }, subscriptionId: sub.id, itemId: sub.itemId!, priceId: sub.priceId,
        targetPriceId: target.price.id, snapshot: subscriptionSnapshot(sub), prorationDate, periodEnd: sub.currentPeriodEnd,
        previousScheduleId: sub.scheduleId || undefined };
      account.quote = quote;
      await save();
      const { subscriptionId: _sub, itemId: _item, priceId: _price, targetPriceId: _target, snapshot: _snapshot,
        prorationDate: _date, periodEnd: _period, previousScheduleId: _schedule, ...publicQuote } = quote;
      return publicQuote;
    });
  }
  async changePlan(userId: string, quoteId: unknown) {
    requireReady(this.config);
    if (typeof quoteId !== "string" || !/^trainers-checkout-[a-f0-9]{40}$/.test(quoteId)) throw new BillingError("INVALID_QUOTE", "La propuesta no es válida.", 400);
    return this.repository.withLock(userId, async (account, save) => {
      this.ensureOpen(account);
      if (account.change?.quote.quoteId === quoteId) {
        await this.refresh(account, save);
        if (account.change.status === "discarded") throw new BillingError("QUOTE_STALE", "El cambio fue descartado. Solicita una nueva propuesta.");
        return { status: account.change.status, paymentActionUrl: account.pendingPayment?.url };
      }
      const quote = account.quote;
      if (!quote || quote.quoteId !== quoteId) throw new BillingError("INVALID_QUOTE", "La propuesta no pertenece a tu cuenta o ya fue sustituida.", 404);
      if (new Date(quote.expiresAt) <= new Date()) throw new BillingError("QUOTE_EXPIRED", "La propuesta ha caducado. Revisa de nuevo el cambio.");
      await this.refresh(account, save);
      const sub = this.editable(account);
      if (subscriptionSnapshot(sub) !== quote.snapshot) throw new BillingError("QUOTE_STALE", "La suscripción ha cambiado. Revisa de nuevo el importe.");
      await this.usageFor(userId, quote.to.clientLimit);
      const target = resolvePrice(this.config, quote.to.tier, quote.to.interval);
      await this.gateway.validatePrice(target.price);
      const preview = await this.gateway.previewChange(sub, target.price, quote.kind, quote.prorationDate);
      if (preview.amountDueNow !== quote.amountDueNow || preview.renewalAmount !== quote.nextRenewal.amount || (preview.creditBalance || 0) !== (quote.creditBalance || 0)) {
        throw new BillingError("QUOTE_STALE", "El importe ha cambiado. Revisa una nueva propuesta antes de confirmar.");
      }
      // Persist intent before any mutation. All retries retain the same quote,
      // proration timestamp and Stripe idempotency key, including lost responses.
      account.change = { quote, startedAt: new Date(), status: "processing" };
      await save();
      await this.refresh(account, save);
      return { status: account.change.status, paymentActionUrl: account.pendingPayment?.url };
    });
  }
  private async control(userId: string, kind: "cancel" | "resume" | "discard"): Promise<void> {
    requireReady(this.config);
    await this.repository.withLock(userId, async (account, save) => {
      this.ensureOpen(account);
      await this.refresh(account, save);
      if (!account.subscriptionId || TERMINAL.has(account.status)) throw new BillingError("SUBSCRIPTION_NOT_ACTIVE", "La suscripción ya ha finalizado. Puedes contratar un nuevo plan.");
      const previous = account.control;
      if (previous && !previous.done && previous.kind !== kind) throw new BillingError("BILLING_BUSY", "Hay otra operación de facturación pendiente. Vuelve a intentarlo.");
      if (kind === "resume" && !account.cancelAtPeriodEnd && (!previous || previous.done)) return;
      if (kind === "cancel" && account.cancelAtPeriodEnd && (!previous || previous.done)) return;
      if (kind === "discard" && !["scheduled", "payment_pending"].includes(account.change?.status || "") && (!previous || previous.done)) return;
      account.control = previous && !previous.done ? previous : { id: checkoutKey(), kind, startedAt: new Date(),
        invoiceId: account.change?.status === "payment_pending" ? account.change.invoiceId : undefined,
        scheduleId: kind !== "resume" ? account.provider?.scheduleId || undefined : undefined };
      const op = account.control;
      if (Date.now() - new Date(op.startedAt).getTime() > 23 * 3600000) throw new BillingError("CHANGE_REVIEW_REQUIRED", "La operación requiere revisión de soporte.");
      await save();
      // Refresh paid proof first: a concurrent successful payment must retain the
      // newly paid plan even when its pending change is being discarded.
      await this.refresh(account, save);
      if (kind !== "resume") {
        if (account.change && ["payment_pending", "scheduled"].includes(account.change.status)) account.change.status = "discarded";
        account.pendingPayment = null;
      }
      account.quote = null;
      op.done = true;
      await this.persist(account, save);
    });
  }
  async cancel(userId: string): Promise<void> { await this.control(userId, "cancel"); }
  async resume(userId: string): Promise<void> { await this.control(userId, "resume"); }
  async discardChange(userId: string): Promise<void> { await this.control(userId, "discard"); }
  async checkout(userId: string, tier: unknown, interval: unknown) {
    requireReady(this.config);
    const { price } = resolvePrice(this.config, tier, interval);
    const beforeLock = await this.user(userId);
    const beforePremium = beforeLock.professionalPremium;
    if (beforePremium?.source !== "stripe" && beforePremium?.entitled && (!beforePremium.expiresAt || new Date(beforePremium.expiresAt) > new Date())) {
      throw new BillingError("LEGACY_SUBSCRIPTION", "Tu suscripción actual debe revisarse con soporte antes de contratar otro plan.");
    }
    return this.repository.withLock(userId, async (account, save) => {
      this.ensureOpen(account);
      const user = await this.user(userId);
      const legacy = user.professionalPremium;
      if (legacy?.source !== "stripe" && legacy?.entitled && (!legacy.expiresAt || new Date(legacy.expiresAt) > new Date())) {
        throw new BillingError("LEGACY_SUBSCRIPTION", "Tu suscripción actual debe revisarse con soporte antes de contratar otro plan.");
      }
      // Claims professional billing authority without touching consumer premium.
      await this.persist(account, save);
      if (!account.customerId) {
        if (account.customerStartedAt && Date.now() - account.customerStartedAt.getTime() > 23 * 3600000) {
          throw new BillingError("CUSTOMER_REVIEW_REQUIRED", "Contacta con soporte para recuperar la configuración de pago.");
        }
        account.customerStartedAt ||= new Date();
        await save();
        account.customerId = await this.gateway.createCustomer(user, `trainers-${account.mode}-${userId}`);
        await save();
      }
      await this.refresh(account, save);
      if (account.subscriptionId && !TERMINAL.has(account.status)) {
        throw new BillingError("ACTIVE_SUBSCRIPTION", "Ya existe una suscripción. Gestiona los pagos desde el portal.");
      }
      const sessions = await this.gateway.listSessions(account.customerId);
      const pending = sessions.find((s) => s.status === "open");
      if (pending) {
        this.ownSession(pending, account);
        if (pending.priceId !== price.id) throw new BillingError("EXISTING_CHECKOUT", "Ya hay un pago abierto para otro plan. Finalízalo o espera a que caduque.");
        return { url: pending.url, sessionId: pending.id, reused: true };
      }
      const attempt = account.checkout && sessions.find((s) => s.attempt === account.checkout!.key);
      const terminalAttempt = attempt?.status === "complete" && attempt.subscriptionId === account.subscriptionId && TERMINAL.has(account.status);
      if (attempt?.status === "complete" && !terminalAttempt) {
        await this.refresh(account, save);
        throw new BillingError("PAYMENT_PENDING", "Estamos comprobando el pago anterior. Actualiza el estado antes de volver a contratar.");
      }
      if (account.checkout && !attempt && Date.now() - account.checkout.startedAt.getTime() > 25 * 60000) {
        throw new BillingError("CHECKOUT_REVIEW_REQUIRED", "Contacta con soporte para revisar el pago anterior.");
      }
      if (!account.checkout || attempt?.status === "expired" || terminalAttempt) {
        account.checkout = { key: checkoutKey(), priceId: price.id, startedAt: new Date() };
      } else if (account.checkout.priceId !== price.id) {
        throw new BillingError("EXISTING_CHECKOUT", "Estamos comprobando un pago anterior para otro plan.");
      }
      await this.gateway.validatePrice(price);
      account.status = "checkout_pending";
      await this.persist(account, save);
      const session = await this.gateway.createCheckout(user, account, price, account.checkout.key);
      this.ownSession(session, account);
      if (!session.url) throw new BillingError("CHECKOUT_UNAVAILABLE", "No se ha podido abrir la página de pago.", 503);
      account.checkout.sessionId = session.id;
      account.checkout.url = session.url;
      await save();
      return { url: session.url, sessionId: session.id, reused: false };
    });
  }
  async sync(userId: string, sessionId?: unknown): Promise<void> {
    requireReady(this.config);
    if (sessionId !== undefined && (typeof sessionId !== "string" || !new RegExp(`^cs_${this.config.mode}_[A-Za-z0-9]+$`).test(sessionId))) {
      throw new BillingError("INVALID_SESSION", "La sesión de pago no es válida.", 400);
    }
    const existing = await this.repository.get(userId);
    if (!existing?.customerId) {
      if (sessionId) throw new BillingError("SESSION_NOT_OWNED", "La sesión de pago no pertenece a tu cuenta.", 403);
      return;
    }
    await this.repository.withLock(userId, async (account, save) => {
      this.ensureOpen(account);
      if (sessionId) this.ownSession(await this.gateway.getSession(sessionId as string), account);
      await this.refresh(account, save);
    });
  }
  // Facturas y método de pago de la propia cuenta, leídos de Stripe (solo lectura).
  async billingDetails(userId: string): Promise<BillingDetails> {
    requireReady(this.config);
    const account = await this.repository.get(userId);
    if (!account?.customerId || account.deletedAt || !this.gateway.billingDetails) return { invoices: [], paymentMethod: null };
    return this.gateway.billingDetails(account.customerId, account.subscriptionId || null);
  }
  async portal(userId: string) {
    requireReady(this.config);
    const account = await this.repository.get(userId);
    if (!account?.customerId) throw new BillingError("NO_BILLING_ACCOUNT", "No hay una cuenta de facturación disponible.", 404);
    return this.repository.withLock(userId, async (locked) => {
      this.ensureOpen(locked);
      return { url: await this.gateway.createPortal(locked.customerId!) };
    });
  }
  async event(record: EventRecord): Promise<{ received: boolean }> {
    requireReady(this.config);
    const existing = await this.repository.saveEvent(record);
    if (existing.status === "processed") return { received: true };
    try {
      let customerId = existing.customerId;
      if (!customerId && existing.detail?.paymentIntentId && this.gateway.invoiceForPayment) {
        customerId = (await this.gateway.invoiceForPayment(existing.detail.paymentIntentId))?.customerId || null;
      }
      const account = customerId ? await this.repository.findCustomer(customerId) : null;
      // Unrelated customers can belong to other products in the same Stripe account.
      if (account) await this.repository.withLock(account.userId, async (locked, save) => {
        if (locked.deletedAt) await this.cancelAll(locked, save);
        else {
          await this.refresh(locked, save);
          await this.afterMoneyEvent(locked, save, existing);
        }
      });
      await this.repository.completeEvent(existing.eventId);
      return { received: true };
    } catch (error) {
      await this.repository.failEvent(existing.eventId);
      throw error;
    }
  }
  // Política 2026-09-21: sin reembolsos salvo los que TrainFit haga a mano. Un
  // reembolso TOTAL del cobro que paga el periodo vigente termina el acceso de
  // pago en el acto (sin esperar al fin de periodo); cualquier otro reembolso o
  // un contracargo no toca el acceso y queda marcado para revisión humana.
  private async afterMoneyEvent(account: Account, save: () => Promise<void>, event: EventRecord): Promise<void> {
    const detail = event.detail;
    if (event.type === "charge.dispute.created") {
      account.review = { reason: "dispute", at: new Date(), reference: detail?.disputeId || event.eventId };
      console.warn("[TrainerBilling] Dispute opened; account flagged for review.");
      await save();
      return;
    }
    if (event.type !== "charge.refunded" || !detail?.paymentIntentId) return;
    const paid = this.gateway.invoiceForPayment ? await this.gateway.invoiceForPayment(detail.paymentIntentId) : null;
    const current = Boolean(detail.fullyRefunded && paid && account.subscriptionId && paid.subscriptionId === account.subscriptionId &&
      paid.invoiceId === account.provider?.latestInvoiceId);
    if (!current) {
      account.review = { reason: "refund", at: new Date(), reference: detail.chargeId || event.eventId };
      await save();
      return;
    }
    if (!TERMINAL.has(account.status)) await this.gateway.cancelSubscription(account.subscriptionId!);
    await this.refresh(account, save);
  }
  private async cancelAll(account: Account, save: () => Promise<void>) {
    if (account.customerId) {
      for (const session of await this.gateway.listSessions(account.customerId)) {
        this.ownSession(session, account);
        if (session.status === "open") await this.gateway.expireSession(session.id);
      }
      for (const sub of await this.gateway.listSubscriptions(account.customerId)) {
        if (sub.customerId !== account.customerId || sub.userId !== account.userId || sub.scope !== "trainers" || sub.livemode !== (this.config.mode === "live")) {
          throw new BillingError("SUBSCRIPTION_NOT_OWNED", "La suscripción requiere revisión antes de eliminar la cuenta.");
        }
        if (!TERMINAL.has(sub.status)) await this.gateway.cancelSubscription(sub.id);
      }
    }
    account.status = "canceled";
    account.paidUntil = null;
    account.cancelAtPeriodEnd = false;
    await this.persist(account, save);
  }
  async prepareDeletion(userId: string): Promise<void> {
    const existing = await this.repository.get(userId);
    if (!existing) return;
    if (existing.customerId || existing.customerStartedAt) requireReady(this.config); // Never orphan a paying account.
    await this.repository.withLock(userId, async (account, save) => {
      account.deletedAt ||= new Date();
      await save(); // Persist before contacting Stripe so Checkout cannot race deletion.
      await this.cancelAll(account, save);
    });
  }
  async reconcile(): Promise<void> {
    requireReady(this.config);
    for (const event of await this.repository.pendingEvents(100)) {
      try { await this.event(event); } catch { /* remains retryable; no secret/error payload logging */ }
    }
    for (const account of await this.repository.accountsForReconciliation(100)) {
      try {
        await this.repository.withLock(account.userId, async (locked, save) => {
          if (locked.deletedAt) await this.cancelAll(locked, save);
          else await this.refresh(locked, save);
        });
      } catch { /* Next cron run retries, access still expires locally. */ }
    }
  }
}
