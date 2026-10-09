import { randomBytes } from "node:crypto";
import { CATALOG, FREE_SEATS, PlanState, isTier, sameState, seatsOf, tierRank } from "./catalog";
import { parseTarget, publicPlans, requireReady, stateView } from "./config";
import { classifyInvoice, fundingRole } from "./financing";
import { MONEY_EVENT_TYPES, checkoutKey, encodeTarget } from "./stripe-gateway";
import { AccessAdjustment, AccessSnapshot, Account, Actor, AdminAction, BillingCase, BillingDetails, BillingError, CaseSuggestion, ChangeKind, ChangeQuote, Config, DisputeView, EventRecord, Financed, FraudWarningView, FundingRole, Gateway, Intervention, Interval, Notifier, PaymentContext, Projection, Repository, Session, Subscription, TermsAcceptance, Tier, User } from "./types";

const TERMINAL = new Set(["canceled", "incomplete_expired"]);
// Disputa abierta (incluidas las consultas previas); el resto de estados son cierres.
const OPEN_DISPUTE = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review"]);
const ADMIN_ACTIONS: AdminAction[] = ["resolve_case", "end_service_now", "cancel_renewal", "resume_renewal", "revert_upgrade",
  "grant_access", "end_grant", "restore_period_access", "pause_collection", "resume_collection"];
const DAY_MS = 86400000;
// Cuándo se aplica un cambio: lo que sube capacidad a mitad de periodo (también las plazas
// adicionales mensuales, decisión 2026-10-03) se cobra al momento y se da al pagar; lo que baja
// capacidad, y el paso de anual a mensual, espera a la renovación.
export function changeKind(from: PlanState, to: PlanState): ChangeKind {
  if (from.interval !== to.interval) return from.interval === "annual" ? "scheduled" : "immediate";
  const rank = tierRank(to.tier) - tierRank(from.tier);
  if (rank !== 0) return rank > 0 ? "immediate" : "scheduled";
  return to.extraSeats > from.extraSeats ? "immediate" : "scheduled";
}
function subscriptionSnapshot(sub: Subscription): string {
  return sub.fingerprint || JSON.stringify([sub.id, sub.items, sub.currentPeriodEnd,
    sub.latestInvoiceId, sub.latestInvoiceStatus, sub.status, sub.cancelAtPeriodEnd, sub.scheduleId, sub.pendingUpdate]);
}
export function paidState(account: Pick<Account, "tier" | "interval" | "extraSeats">): PlanState | null {
  return account.tier && account.interval ? { tier: account.tier, interval: account.interval, extraSeats: account.extraSeats || 0 } : null;
}
// Decisión de negocio 2026-09-18: si falla el cobro de una renovación, el plan
// pagado se mantiene 7 días mientras Stripe reintenta; después cae a Free. El mismo
// margen cubre la hora en que la factura de renovación sigue en borrador.
export const PAST_DUE_GRACE_MS = 7 * DAY_MS;
export function accessUntil(account: Account): Date | null {
  if (!account.paidUntil) return null;
  const paidUntil = new Date(account.paidUntil);
  const renewing = account.status === "past_due" || (account.status === "active" && account.provider?.latestInvoiceStatus !== "paid");
  return renewing ? new Date(paidUntil.getTime() + PAST_DUE_GRACE_MS) : paidUntil;
}
function activeAdjustment(entry: AccessAdjustment, now: Date): boolean {
  return !entry.liftedAt && (!entry.from || new Date(entry.from) <= now) && (!entry.until || new Date(entry.until) > now);
}
export interface EffectiveAccess {
  entitled: boolean; tier: Tier | null; interval: Interval | null; extraSeats: number; seats: number; expiresAt: Date | null;
  basis: "payment" | "exception" | "none"; revokedUntil: Date | null; exception: AccessAdjustment | null;
}
// Acceso real = lo pagado según Stripe, menos los periodos retirados (disputa perdida o decisión
// registrada), más las excepciones concedidas hasta una fecha. Una excepción nunca finge un cobro:
// da las plazas incluidas en su plan y gana solo si son más que las pagadas.
export function effectiveAccess(account: Account, now = new Date()): EffectiveAccess {
  const until = accessUntil(account);
  const state = paidState(account);
  const paid = !account.deletedAt && ["active", "past_due"].includes(account.status) && Boolean(state && until && until > now);
  const active = (account.adjustments || []).filter((entry) => activeAdjustment(entry, now));
  const revoke = active.find((entry) => entry.kind === "revoke_period");
  const byPayment = paid && !revoke;
  const paidSeats = byPayment ? seatsOf(state!) : 0;
  const grant = account.deletedAt ? undefined : active.filter((entry) => entry.kind === "grant" && entry.tier && entry.until)
    .sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || new Date(b.until!).getTime() - new Date(a.until!).getTime())[0];
  const grantSeats = grant ? CATALOG[grant.tier!].includedSeats : 0;
  const grantWins = Boolean(grant && grantSeats > paidSeats);
  const grantUntil = grant ? new Date(grant.until!) : null;
  const expiresAt = grantUntil ? (byPayment && until! > grantUntil ? until : grantUntil) : revoke ? null : until;
  const entitled = byPayment || Boolean(grant);
  return { entitled, expiresAt,
    tier: grantWins ? grant!.tier : byPayment ? state!.tier : null,
    interval: grantWins ? grant!.interval || state?.interval || null : byPayment ? state!.interval : null,
    extraSeats: grantWins || !byPayment ? 0 : state!.extraSeats,
    seats: entitled ? Math.max(paidSeats, grantSeats) : FREE_SEATS,
    basis: grantWins ? "exception" : byPayment ? "payment" : "none",
    revokedUntil: revoke?.until ? new Date(revoke.until) : null, exception: grant || null };
}
export function projection(account: Account, now = new Date()): Projection {
  const access = effectiveAccess(account, now);
  return { entitled: access.entitled, tier: access.tier, interval: access.interval, seats: access.seats, expiresAt: access.expiresAt,
    lastSyncAt: now, stripeRevision: account.revision, stripeMode: account.mode };
}
export function accessSnapshot(account: Account, now = new Date()): AccessSnapshot {
  const access = effectiveAccess(account, now);
  return { status: account.status, tier: account.tier || null, interval: account.interval || null, extraSeats: account.extraSeats || 0,
    seats: access.seats, paidUntil: account.paidUntil || null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd, entitled: access.entitled, expiresAt: access.expiresAt,
    collectionPaused: Boolean(account.hold || account.provider?.collectionPaused) };
}
function billingNow(account: Account): number {
  return account.provider?.billingNow ?? Math.floor(Date.now() / 1000);
}
// Renovación anual en los próximos 30 días: misma regla para el email y el aviso de la app.
export function annualRenewalWindow(account: Account, now: Date): { at: Date; days: number } | null {
  if (account.deletedAt || account.status !== "active" || account.cancelAtPeriodEnd || account.hold || account.interval !== "annual") return null;
  const at = account.renewal?.at ? new Date(account.renewal.at) : account.currentPeriodEnd ? new Date(account.currentPeriodEnd) : null;
  if (!at) return null;
  const days = (at.getTime() - now.getTime()) / DAY_MS;
  return days > 0 && days <= 30 ? { at, days } : null;
}
// Estado de un caso al registrarlo de nuevo: uno resuelto se reabre (con nota) solo si hay novedades.
function caseLifecycle(existing: BillingCase | null, changed: boolean, note: string) {
  const reopen = Boolean(existing?.status === "resolved" && changed);
  return {
    status: (existing?.status === "resolved" && !changed ? "resolved" : "open") as BillingCase["status"],
    notes: reopen ? [...(existing?.notes || []), `${new Date().toISOString()} ${note}`] : existing?.notes || [],
    openedAt: existing?.openedAt || new Date(), resolution: existing?.resolution || null,
  };
}
function newId(prefix: string): string { return `${prefix}-${randomBytes(12).toString("hex")}`; }
function badRequest(code: string, message: string): BillingError { return new BillingError(code, message, 400); }

interface MoneyContext {
  kind: "refund" | "dispute" | "early_fraud_warning"; payment: PaymentContext | null;
  dispute?: DisputeView; warning?: FraudWarningView;
}
// La propuesta sin los datos internos (elementos, huella, fechas de prorrateo).
function publicQuote(quote: ChangeQuote) {
  const { subscriptionId: _sub, snapshot: _snapshot, prorationDate: _date, periodEnd: _period, previousScheduleId: _schedule,
    updates: _updates, fromItems: _from, targetItems: _target, ...visible } = quote;
  return visible;
}

export class TrainerBillingService {
  private backfilledAt = 0;
  constructor(readonly config: Config, readonly repository: Repository, readonly gateway: Gateway, readonly notifier?: Notifier) {}
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
  private sessionOwned(session: Session, account: Account): boolean {
    return session.livemode === (this.config.mode === "live") && session.customerId === account.customerId &&
      session.userId === account.userId && session.scope === "trainers";
  }
  private ownSession(session: Session, account: Account): void {
    if (!this.sessionOwned(session, account)) {
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
      account.hold = null;
      await this.persist(account, save);
      return;
    }
    if (sub.livemode !== (this.config.mode === "live") || sub.customerId !== account.customerId || sub.scope !== "trainers" || sub.userId !== account.userId) {
      throw new BillingError("SUBSCRIPTION_NOT_OWNED", "La suscripción requiere revisión de soporte.");
    }
    // Una suscripción viva fuera del catálogo (precios ajenos, dos cuotas…) la revisa soporte.
    if (!sub.state && !TERMINAL.has(sub.status)) throw new BillingError("UNKNOWN_SUBSCRIPTION_PRICE", "La suscripción requiere revisión de soporte.");
    account.subscriptionId = sub.id;
    account.status = sub.status;
    account.cancelAtPeriodEnd = sub.cancelAtPeriodEnd;
    account.currentPeriodEnd = new Date(sub.currentPeriodEnd * 1000);
    account.provider = sub;
    // Espejo de la pausa de cobros de Stripe (disputa, intervención o Dashboard): Stripe manda.
    if (sub.collectionPaused && !TERMINAL.has(sub.status)) {
      if (account.hold?.subscriptionId !== sub.id) {
        account.hold = { kind: "admin", since: new Date(), caseIds: [], pausedInvoiceIds: [], subscriptionId: sub.id };
      }
    } else if (account.hold) {
      if (!TERMINAL.has(sub.status)) console.warn("[TrainerBilling] Collection resumed outside TrainFit; hold cleared.");
      account.hold = null;
    }
    // A status of active alone is not proof of payment (e.g. unpaid plan change): the latest invoice
    // must be paid and cover the current items. Monthly extra seats count from the moment they are
    // added; their proration is collected with the next invoice (decision 2026-10-02).
    if (sub.status === "active" && sub.paid && sub.state && sub.paidPeriodEnd > 0) {
      this.applyState(account, sub.state);
      account.paidUntil = new Date(Math.min(sub.currentPeriodEnd, sub.paidPeriodEnd) * 1000);
    }
    const change = account.change;
    account.pendingPayment = null;
    if (change?.status === "payment_pending" && change.invoiceId) {
      const payment = await this.gateway.changePayment(account, change);
      if (payment.paid && !sub.pendingUpdate && sub.status === "active" && sameState(sub.state, change.quote.to) && payment.periodEnd > 0) {
        // This is an explicitly tracked, paid change invoice.
        this.applyState(account, change.quote.to);
        account.paidUntil = new Date(Math.min(sub.currentPeriodEnd, payment.periodEnd) * 1000);
        change.status = "applied";
      } else if (payment.voided || (!sub.pendingUpdate && !sameState(sub.state, change.quote.to))) {
        change.status = "discarded";
      } else {
        account.pendingPayment = { url: payment.url,
          expiresAt: sub.pendingUpdateExpiresAt ? new Date(sub.pendingUpdateExpiresAt * 1000) : undefined };
      }
    }
    if (change?.status === "scheduled" && !sub.scheduleId) {
      change.status = sameState(sub.state, change.quote.to) ? "applied" : "discarded";
    }
    // The schedule may still own its final phase after the transition. Its change
    // is complete once the items match; renewal payment gates access.
    if (change?.status === "scheduled" && sameState(sub.state, change.quote.to)) change.status = "applied";
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
    if (account.renewal?.fingerprint === fingerprint) return;
    try {
      const next = await this.gateway.upcomingRenewal(sub);
      account.renewal = next ? { at: new Date(next.at * 1000), amount: next.amount, fingerprint,
        state: next.state, subtotal: next.subtotal } : null;
    } catch { account.renewal = null; }
  }
  private applyState(account: Account, state: PlanState): void {
    account.tier = state.tier;
    account.interval = state.interval;
    account.extraSeats = state.extraSeats;
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
      const applied = await this.gateway.applyUpgrade(change.quote, key).catch((error: unknown) => {
        if (error instanceof BillingError && error.code === "CHANGE_REJECTED") return null;
        throw error;
      });
      // Stripe lo rechazó sin aplicar nada: se descarta y la cuenta sigue con lo pagado. Antes quedaba
      // "processing" y cada relectura (sync, propuesta, webhook) lo reintentaba y fallaba con 503.
      if (!applied) {
        change.status = "discarded";
        account.quote = null;
        await save();
        return;
      }
      change.invoiceId = applied.invoiceId;
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
    // Con los cobros en pausa (disputa o decisión administrativa) no se crean cargos nuevos.
    if (account.hold) {
      throw new BillingError("COLLECTION_PAUSED", "Los cobros de tu suscripción están en pausa mientras revisamos una incidencia con un pago. Escríbenos para cambiar de plan.");
    }
    const sub = account.provider;
    if (!sub || sub.status !== "active" || !account.paidUntil || new Date(account.paidUntil) <= new Date() || !sub.state ||
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
  private async seatUsage(userId: string) {
    const usage = await this.repository.seatUsage(userId);
    if (![usage.occupied, usage.reserved].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new BillingError("USAGE_UNAVAILABLE", "No se ha podido comprobar el número de clientes.", 503);
    }
    return usage;
  }
  // Propuesta de cambio con importes de Stripe. Reducir nunca se bloquea por tener más clientes que
  // plazas (decisión 2026-10-02): la propuesta dice cuántos quedarán en solo lectura al aplicarse.
  async previewChange(userId: string, input: unknown) {
    requireReady(this.config);
    const target = parseTarget(input);
    return this.repository.withLock(userId, async (account, save) => {
      await this.refresh(account, save);
      const sub = this.editable(account);
      const current = sub.state!;
      if (sameState(current, target)) throw new BillingError("SAME_PLAN", "Ya tienes ese plan, periodicidad y plazas.");
      if (account.change?.status === "scheduled" && sameState(account.change.quote.to, target)) {
        throw new BillingError("SAME_SCHEDULED_CHANGE", "Ese cambio ya está programado.");
      }
      const seats = await this.seatUsage(userId);
      await this.gateway.validateState(target);
      const kind = changeKind(current, target);
      // Stripe test-clock subscriptions bill in simulated time. Mixing that
      // clock with wall time can prorate even a newly started annual period.
      const prorationDate = sub.billingNow ?? Math.floor(Date.now() / 1000);
      const preview = await this.gateway.previewChange(sub, target, kind, prorationDate);
      const items = await this.gateway.changeItems(sub, target);
      const quote: ChangeQuote = { quoteId: checkoutKey(), expiresAt: new Date(Date.now() + 5 * 60000), kind,
        from: stateView(current), to: stateView(target),
        effectiveAt: new Date((kind === "scheduled" ? sub.currentPeriodEnd : prorationDate) * 1000),
        amountDueNow: preview.amountDueNow, currency: "eur",
        creditBalance: preview.creditBalance || 0, lines: preview.lines || [], taxAmount: preview.taxAmount || 0,
        nextRenewal: { at: new Date((preview.renewalAt || sub.currentPeriodEnd) * 1000), amount: preview.renewalAmount, estimated: true,
          excludesTax: Boolean(preview.renewalExcludesTax) },
        // También en cambios inmediatos: pasar de mensual a anual puede bajar plazas al momento.
        seats, readOnlyAfter: Math.max(0, seats.occupied - seatsOf(target)),
        termsUrl: this.config.termsUrl || null,
        subscriptionId: sub.id, snapshot: subscriptionSnapshot(sub), prorationDate, periodEnd: sub.currentPeriodEnd,
        previousScheduleId: sub.scheduleId || undefined, ...items };
      account.quote = quote;
      await save();
      return publicQuote(quote);
    });
  }
  // termsUrl: las condiciones que el entrenador tenía delante al confirmar. Si ya no son las vigentes,
  // se le pide revisar de nuevo: nunca se registra la aceptación de un texto que no ha visto.
  async changePlan(userId: string, quoteId: unknown, termsUrl?: unknown) {
    requireReady(this.config);
    if (typeof quoteId !== "string" || !/^trainers-checkout-[a-f0-9]{40}$/.test(quoteId)) throw new BillingError("INVALID_QUOTE", "La propuesta no es válida.", 400);
    const terms = this.config.termsUrl || null;
    if (terms && termsUrl !== terms) {
      throw new BillingError("TERMS_CHANGED", "Las condiciones de contratación han cambiado. Revísalas y vuelve a confirmar.");
    }
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
      const target: PlanState = { tier: quote.to.tier, interval: quote.to.interval, extraSeats: quote.to.extraSeats };
      await this.gateway.validateState(target);
      const preview = await this.gateway.previewChange(sub, target, quote.kind, quote.prorationDate);
      if (preview.amountDueNow !== quote.amountDueNow || preview.renewalAmount !== quote.nextRenewal.amount ||
          (preview.creditBalance || 0) !== (quote.creditBalance || 0)) {
        throw new BillingError("QUOTE_STALE", "El importe ha cambiado. Revisa una nueva propuesta antes de confirmar.");
      }
      // Persist intent before any mutation. All retries retain the same quote,
      // proration timestamp and Stripe idempotency key, including lost responses.
      account.change = { quote, startedAt: new Date(), status: "processing" };
      if (terms) this.acceptTerms(account, { at: new Date(), via: "change", ref: quote.quoteId, termsUrl: terms });
      await save();
      await this.refresh(account, save);
      if (account.change.status === "discarded") {
        throw new BillingError("CHANGE_REJECTED", "Stripe no ha aceptado el cambio. Tu plan actual se mantiene.", 503);
      }
      return { status: account.change.status, paymentActionUrl: account.pendingPayment?.url };
    });
  }
  private async control(userId: string, kind: "cancel" | "resume" | "discard"): Promise<void> {
    requireReady(this.config);
    await this.repository.withLock(userId, async (account, save) => this.controlLocked(account, save, kind));
  }
  // Cancelar/reactivar la renovación o descartar un cambio, ya dentro del lease (entrenador o administrador).
  private async controlLocked(account: Account, save: () => Promise<void>, kind: "cancel" | "resume" | "discard"): Promise<void> {
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
  }
  async cancel(userId: string): Promise<void> { await this.control(userId, "cancel"); }
  async resume(userId: string): Promise<void> { await this.control(userId, "resume"); }
  async discardChange(userId: string): Promise<void> { await this.control(userId, "discard"); }
  // Contratación desde Free: Checkout con la cuota del plan y, si se piden, las plazas adicionales.
  async checkout(userId: string, input: unknown) {
    requireReady(this.config);
    const target = parseTarget(input);
    const wanted = encodeTarget(target);
    return this.repository.withLock(userId, async (account, save) => {
      this.ensureOpen(account);
      const user = await this.user(userId);
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
        if (pending.target !== wanted) throw new BillingError("EXISTING_CHECKOUT", "Ya hay un pago abierto para otro plan. Finalízalo o espera a que caduque.");
        return { url: pending.url, sessionId: pending.id, reused: true };
      }
      const attempt = account.checkout && sessions.find((s) => s.attempt === account.checkout!.key);
      const terminalAttempt = attempt?.status === "complete" && attempt.subscriptionId === account.subscriptionId && TERMINAL.has(account.status);
      if (attempt?.status === "complete" && !terminalAttempt) {
        await this.refresh(account, save);
        throw new BillingError("PAYMENT_PENDING", "Estamos comprobando el pago anterior. Actualiza el estado antes de volver a contratar.");
      }
      // Un intento sin sesión en Stripe pasados 25 min nunca llegó a crearse: la sesión siempre lleva su
      // customer y la lista es completa (has_more se rechaza). Ya no admite reintento con su clave
      // (expires_at quedaría a menos de 30 min), así que se empieza otro en vez de bloquear la cuenta.
      const abandoned = Boolean(account.checkout && !attempt && Date.now() - account.checkout.startedAt.getTime() > 25 * 60000);
      if (!account.checkout || attempt?.status === "expired" || terminalAttempt || abandoned) {
        account.checkout = { key: checkoutKey(), target, startedAt: new Date() };
      } else if (!sameState(account.checkout.target, target)) {
        throw new BillingError("EXISTING_CHECKOUT", "Estamos comprobando un pago anterior para otro plan.");
      }
      await this.gateway.validateState(target);
      const previousStatus = account.status;
      account.status = "checkout_pending";
      await this.persist(account, save);
      const session = await this.gateway.createCheckout(user, account, target, account.checkout.key).catch(async (error: unknown) => {
        // Stripe no creó nada: el intento se descarta para que el siguiente empiece limpio.
        if (error instanceof BillingError && error.code === "CHECKOUT_REJECTED") {
          account.checkout = null;
          account.status = previousStatus;
          await this.persist(account, save);
        }
        throw error;
      });
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
      let session: Session | null = null;
      if (sessionId) { session = await this.gateway.getSession(sessionId as string); this.ownSession(session, account); }
      await this.refresh(account, save);
      if (session) await this.recordConsent(account, save, session);
    });
  }
  // Aceptación de las condiciones en Checkout: queda registrada con la sesión y la URL vigente.
  private async recordConsent(account: Account, save: () => Promise<void>, session: Session): Promise<void> {
    if (!session.termsAccepted || account.termsAcceptance?.ref === session.id || !this.sessionOwned(session, account)) return;
    this.acceptTerms(account, { at: new Date(), via: "checkout", ref: session.id, termsUrl: this.config.termsUrl || null });
    await save();
  }
  // Se añade al historial (los últimos 50) sin borrar nunca una aceptación anterior.
  private acceptTerms(account: Account, acceptance: TermsAcceptance): void {
    account.termsAcceptance = acceptance;
    account.termsHistory = [...(account.termsHistory || []), acceptance].slice(-50);
  }
  // Facturas y método de pago de la propia cuenta, leídos de Stripe (solo lectura).
  async billingDetails(userId: string): Promise<BillingDetails> {
    requireReady(this.config);
    const account = await this.repository.get(userId);
    if (!account?.customerId || account.deletedAt || !this.gateway.billingDetails) return { invoices: [], paymentMethod: null };
    const details = await this.gateway.billingDetails(account.customerId, account.subscriptionId || null);
    // Reembolsos registrados por factura (los de Stripe no cambian el estado "pagada" de la factura).
    const refunds = new Map<string, number>();
    for (const entry of (await this.repository.listCases?.({ userId, limit: 200 })) || []) {
      const invoiceId = entry.kind === "refund" ? entry.financed?.invoiceId : null;
      if (invoiceId) refunds.set(invoiceId, (refunds.get(invoiceId) || 0) + entry.amount);
    }
    return { ...details, invoices: details.invoices.map((invoice) =>
      refunds.has(invoice.id) ? { ...invoice, refundedAmount: refunds.get(invoice.id) } : invoice) };
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
      const money = await this.moneyContext(existing);
      const customerId = existing.customerId || money?.payment?.customerId || null;
      const account = customerId ? await this.repository.findCustomer(customerId) : null;
      // Unrelated customers can belong to other products in the same Stripe account.
      if (account) await this.repository.withLock(account.userId, async (locked, save) => {
        if (locked.deletedAt) await this.cancelAll(locked, save);
        else {
          await this.refresh(locked, save);
          if (money) await this.applyMoneyEvent(locked, save, money);
          if (existing.type === "checkout.session.completed" && existing.detail?.sessionId) {
            await this.recordConsent(locked, save, await this.gateway.getSession(existing.detail.sessionId));
          }
        }
      });
      await this.repository.completeEvent(existing.eventId);
      return { received: true };
    } catch (error) {
      await this.repository.failEvent(existing.eventId);
      throw error;
    }
  }
  // Releé de Stripe el objeto de dinero y lo que financiaba su pago: el orden y el contenido del
  // evento no importan, así que duplicados y eventos desordenados producen el mismo resultado.
  private async moneyContext(event: EventRecord): Promise<MoneyContext | null> {
    const detail = event.detail || {};
    const payment = (ref: { chargeId?: string | null; paymentIntentId?: string | null }) =>
      this.gateway.paymentContext ? this.gateway.paymentContext(ref) : Promise.resolve(null);
    if (event.type === "charge.refunded" || event.type === "charge.refund.updated" || event.type.startsWith("refund.")) {
      return { kind: "refund", payment: await payment({ chargeId: detail.chargeId, paymentIntentId: detail.paymentIntentId }) };
    }
    if (event.type.startsWith("charge.dispute.") && detail.disputeId && this.gateway.getDispute) {
      const dispute = await this.gateway.getDispute(detail.disputeId);
      return { kind: "dispute", dispute, payment: await payment({ chargeId: dispute.chargeId, paymentIntentId: dispute.paymentIntentId }) };
    }
    if (event.type.startsWith("radar.early_fraud_warning.") && detail.warningId && this.gateway.getFraudWarning) {
      const warning = await this.gateway.getFraudWarning(detail.warningId);
      return { kind: "early_fraud_warning", warning, payment: await payment({ chargeId: warning.chargeId, paymentIntentId: warning.paymentIntentId }) };
    }
    return null;
  }
  private async applyMoneyEvent(account: Account, save: () => Promise<void>, money: MoneyContext): Promise<void> {
    if (!this.repository.saveCase || !this.repository.getCase) return;
    const financed = money.payment?.invoice ? classifyInvoice(money.payment.invoice, account) : null;
    const role: FundingRole = financed
      ? fundingRole(financed, { subscriptionId: account.subscriptionId, state: paidState(account) }, billingNow(account))
      : "unknown";
    if (money.kind === "refund" && money.payment) await this.recordRefund(account, money.payment, financed, role);
    else if (money.kind === "dispute" && money.dispute) await this.handleDispute(account, save, money.dispute, money.payment, financed, role);
    else if (money.kind === "early_fraud_warning" && money.warning) await this.recordFraudWarning(account, money.warning, money.payment, financed, role);
  }
  // Política 2026-09-28: un reembolso no cambia por sí solo ni el acceso ni la suscripción; su efecto
  // depende del motivo (servicio terminado, duplicado, compensación…), así que se abre un caso con lo
  // que financiaba el pago y el efecto sugerido, y una persona decide en Gestión.
  private async recordRefund(account: Account, payment: PaymentContext, financed: Financed | null, role: FundingRole): Promise<void> {
    if (!payment.chargeId) return;
    const caseId = `refund:${payment.chargeId}`;
    const existing = await this.repository.getCase!(caseId);
    const failed = payment.refunds.some((refund) => ["failed", "canceled"].includes(refund.status));
    const amount = payment.refunds.filter((refund) => !["failed", "canceled"].includes(refund.status)).reduce((sum, refund) => sum + refund.amount, 0);
    const full = payment.refunded || (payment.amount > 0 && amount >= payment.amount);
    const suggestion: CaseSuggestion = failed ? "check_failed_refund" : role === "unknown" ? "manual_review"
      : full && role === "current_upgrade" ? "revert_upgrade" : full && role === "current_period" ? "decide_end_or_keep" : "keep_access";
    const high = failed || role === "unknown" || (full && (role === "current_period" || role === "current_upgrade"));
    const signature = (refunds: PaymentContext["refunds"] = []) => JSON.stringify(refunds.map((refund) => [refund.id, refund.status, refund.amount]));
    const changed = !existing || signature(existing.refunds) !== signature(payment.refunds);
    await this.repository.saveCase!({
      caseId, userId: account.userId, mode: account.mode, kind: "refund", priority: high ? "high" : "normal",
      chargeId: payment.chargeId, paymentIntentId: payment.paymentIntentId, financed, role,
      amount, currency: payment.currency, fullyRefunded: full, refunds: payment.refunds,
      effects: existing?.effects || [], suggestion,
      ...caseLifecycle(existing, changed, "Nuevo movimiento de reembolso tras resolver el caso."),
    });
    if (changed) console.warn("[TrainerBilling] Refund recorded; decision pending in Gestión.");
  }
  // Política 2026-09-28: una disputa no retira el acceso; se pausan los cobros futuros y los
  // reintentos mientras se resuelve. Si se pierde, se retiran solo los derechos que financiaba el
  // pago perdido; si no se puede saber cuáles, revisión manual antes de tocar el acceso.
  private async handleDispute(account: Account, save: () => Promise<void>, dispute: DisputeView, payment: PaymentContext | null,
    financed: Financed | null, role: FundingRole): Promise<void> {
    const caseId = `dispute:${dispute.id}`;
    const existing = await this.repository.getCase!(caseId);
    const effects = [...(existing?.effects || [])];
    const open = OPEN_DISPUTE.has(dispute.status);
    const live = Boolean(account.subscriptionId && account.provider && !TERMINAL.has(account.status));
    if (open && live && !effects.includes("collection_paused") && this.gateway.pauseCollection) {
      if (!account.hold) {
        const paused = await this.gateway.pauseCollection(account.subscriptionId!, `trainers-dispute-${dispute.id}-pause`);
        account.hold = { kind: "dispute", since: new Date(), caseIds: [caseId], pausedInvoiceIds: paused.pausedInvoiceIds,
          subscriptionId: account.subscriptionId! };
      } else if (!account.hold.caseIds.includes(caseId)) {
        account.hold = { ...account.hold, kind: "dispute", caseIds: [...account.hold.caseIds, caseId] };
      }
      effects.push("collection_paused");
      await save();
    }
    if (dispute.status === "lost" && !effects.some((effect) => effect.startsWith("rights_"))) {
      effects.push(await this.withdrawRights(account, save, financed, role, caseId, `trainers-dispute-${dispute.id}`));
    }
    const unknown = effects.includes("rights_unknown");
    const statusChanged = existing?.disputeStatus !== dispute.status;
    await this.repository.saveCase!({
      caseId, userId: account.userId, mode: account.mode, kind: "dispute", priority: open || unknown ? "high" : "normal",
      chargeId: payment?.chargeId || dispute.chargeId, paymentIntentId: payment?.paymentIntentId || dispute.paymentIntentId,
      financed, role, amount: dispute.amount, currency: dispute.currency,
      disputeId: dispute.id, disputeStatus: dispute.status, disputeReason: dispute.reason, dueBy: dispute.dueBy,
      effects, suggestion: open ? "respond_dispute" : unknown ? "manual_review" : "decide_collection",
      ...caseLifecycle(existing, statusChanged, `La disputa ha pasado a ${dispute.status}.`),
    });
    if (statusChanged) console.warn("[TrainerBilling] Dispute updated; decision pending in Gestión.");
    await this.persist(account, save);
  }
  private async recordFraudWarning(account: Account, warning: FraudWarningView, payment: PaymentContext | null, financed: Financed | null,
    role: FundingRole): Promise<void> {
    const caseId = `efw:${warning.id}`;
    const existing = await this.repository.getCase!(caseId);
    await this.repository.saveCase!({
      caseId, userId: account.userId, mode: account.mode, kind: "early_fraud_warning", priority: "high",
      chargeId: payment?.chargeId || warning.chargeId, paymentIntentId: payment?.paymentIntentId || warning.paymentIntentId,
      financed, role, amount: payment?.amount || 0, currency: payment?.currency || "eur",
      warningId: warning.id, fraudType: warning.fraudType, effects: existing?.effects || [], suggestion: "review_fraud_warning",
      ...caseLifecycle(existing, false, ""),
    });
    if (!existing) console.warn("[TrainerBilling] Early fraud warning recorded; decision pending in Gestión.");
  }
  // Retira solo lo que financiaba el pago perdido. Devuelve el efecto aplicado (se guarda en el caso).
  private async withdrawRights(account: Account, save: () => Promise<void>, financed: Financed | null, role: FundingRole,
    caseId: string, keyBase: string): Promise<string> {
    if (!financed || role === "unknown") return "rights_unknown";
    if (role === "past") return "rights_past";
    if (role === "current_upgrade") {
      return await this.revertUpgradeLocked(account, save, financed, `${keyBase}-revert`) ? "rights_withdrawn:upgrade" : "rights_unknown";
    }
    account.adjustments = [...(account.adjustments || []), { id: newId("adj"), kind: "revoke_period",
      from: new Date(financed.periodStart * 1000), until: new Date(financed.periodEnd * 1000),
      tier: financed.state?.tier || null, interval: financed.state?.interval || null,
      invoiceId: financed.invoiceId, reason: "Disputa perdida: el banco devolvió el pago que financiaba este periodo.",
      source: "dispute_lost", caseId, interventionId: null, createdAt: new Date(), liftedAt: null }];
    await save();
    return "rights_withdrawn:period";
  }
  // Deshace una subida en la misma periodicidad (plan superior o más plazas): vuelve el estado anterior
  // sin prorrateo (ni factura ni cobro) y el periodo base ya pagado se respeta. Reembolsar plazas
  // adicionales solo devuelve esas plazas. Si la subida ya no es la vigente, no se toca.
  private async revertUpgradeLocked(account: Account, save: () => Promise<void>, financed: Financed, key: string): Promise<boolean> {
    const sub = account.provider;
    const from = financed.fromState;
    const to = financed.state;
    if (!sub || !from || !to || from.interval !== to.interval || !sameState(sub.state, to) || sub.pendingUpdate ||
        TERMINAL.has(sub.status) || !this.gateway.revertState) return false;
    if (sub.scheduleId) await this.gateway.releaseSchedule(sub.scheduleId, `${key}-release`);
    await this.gateway.revertState(sub, from, key);
    this.applyState(account, from);
    if (account.change?.status === "applied" && sameState(account.change.quote.to, to)) account.change.status = "reverted";
    else if (account.change?.status === "scheduled") account.change.status = "discarded";
    account.quote = null;
    await save();
    await this.refresh(account, save);
    return true;
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
    account.hold = null;
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
  // Aviso de renovación anual a 30 y 7 días (decisión 2026-09-28). Se marca antes de enviar: un
  // aviso nunca se duplica; si el envío falla, se desmarca y se reintenta en la siguiente ronda.
  async remindRenewal(account: Account, save: () => Promise<void>): Promise<void> {
    const state = paidState(account);
    if (!this.notifier || !state) return;
    const now = new Date(billingNow(account) * 1000);
    const window = annualRenewalWindow(account, now);
    if (!window) return;
    const { at, days } = window;
    const current = account.reminders && new Date(account.reminders.periodEnd).getTime() === at.getTime()
      ? account.reminders : { periodEnd: at, sent30At: null, sent7At: null };
    const stage: 30 | 7 | null = days <= 7 ? (current.sent7At ? null : 7) : (current.sent30At ? null : 30);
    if (!stage) return;
    const user = await this.repository.getUser(account.userId);
    if (!user?.email) return;
    const previous = account.reminders || null;
    account.reminders = stage === 7 ? { ...current, sent7At: now } : { ...current, sent30At: now };
    await save();
    try {
      await this.notifier.renewalReminder({ email: user.email, stage, at, amount: account.renewal?.amount ?? null,
        tier: state.tier, seats: seatsOf(state), manageUrl: `${this.config.returnUrl}/tabs/subscription`,
        supportEmail: this.config.supportEmail || null });
    } catch {
      account.reminders = previous;
      await save();
      console.error("[TrainerBilling] Renewal reminder failed; it will be retried.");
    }
  }
  // Red de seguridad: recupera eventos de dinero de las últimas 72 h (o desde la última pasada)
  // por si un webhook se perdió o llegó con los pagos apagados. Cada evento se procesa una vez.
  async backfillMoneyEvents(nowMs = Date.now()): Promise<number> {
    if (!this.gateway.recentEvents || nowMs - this.backfilledAt < 10 * 60000) return 0;
    const since = Math.floor((this.backfilledAt ? this.backfilledAt - 15 * 60000 : nowMs - 72 * 3600000) / 1000);
    const records = await this.gateway.recentEvents(MONEY_EVENT_TYPES, since);
    this.backfilledAt = nowMs;
    let processed = 0;
    for (const record of records) {
      try { await this.event(record); processed += 1; } catch { /* queda pendiente y se reintenta */ }
    }
    return processed;
  }
  async reconcile(): Promise<void> {
    requireReady(this.config);
    try { await this.backfillMoneyEvents(); } catch { /* siguiente ronda */ }
    for (const event of await this.repository.pendingEvents(100)) {
      try { await this.event(event); } catch { /* remains retryable; no secret/error payload logging */ }
    }
    for (const account of await this.repository.accountsForReconciliation(100)) {
      try {
        await this.repository.withLock(account.userId, async (locked, save) => {
          if (locked.deletedAt) await this.cancelAll(locked, save);
          else {
            await this.refresh(locked, save);
            await this.remindRenewal(locked, save);
          }
        });
      } catch { /* Next cron run retries, access still expires locally. */ }
    }
  }

  // ---- Gestión (solo administradores) ----

  async adminCases(status?: unknown) {
    requireReady(this.config);
    if (!this.repository.listCases) throw new BillingError("ADMIN_UNAVAILABLE", "La gestión de facturación no está disponible.", 503);
    const filter = status === "all" ? undefined : status === "resolved" ? "resolved" : "open";
    const cases = await this.repository.listCases({ status: filter, limit: 200 });
    const userIds = [...new Set(cases.map((entry) => entry.userId))];
    const emails = new Map(await Promise.all(userIds.map(async (id) => [id, (await this.repository.getUser(id))?.email || null] as const)));
    const pendingEvents = (await this.repository.pendingEvents(100)).length;
    return { mode: this.config.mode, pendingEvents, cases: cases.map((entry) => ({ ...entry, email: emails.get(entry.userId) || null })) };
  }
  async adminTrainer(userId: string) {
    requireReady(this.config);
    const user = await this.user(userId);
    const account = await this.repository.get(userId);
    const access = account ? effectiveAccess(account) : null;
    const dashboard = `https://dashboard.stripe.com/${this.config.mode === "test" ? "test/" : ""}`;
    return {
      mode: this.config.mode, user: { id: user.id, email: user.email },
      account: account ? {
        status: account.status, tier: account.tier || null, interval: account.interval || null,
        extraSeats: account.extraSeats || 0, paidUntil: account.paidUntil || null,
        currentPeriodEnd: account.currentPeriodEnd || null, cancelAtPeriodEnd: account.cancelAtPeriodEnd,
        customerId: account.customerId || null, subscriptionId: account.subscriptionId || null,
        collectionPaused: Boolean(account.provider?.collectionPaused), hold: account.hold || null,
        adjustments: account.adjustments || [], renewal: account.renewal || null, renewalPayment: account.renewalPayment || null,
        change: account.change ? { status: account.change.status, from: account.change.quote.from, to: account.change.quote.to,
          effectiveAt: account.change.quote.effectiveAt } : null,
        termsAcceptance: account.termsAcceptance || null, termsHistory: (account.termsHistory || []).slice(-10).reverse(),
        deletedAt: account.deletedAt || null,
      } : null,
      access: access ? { entitled: access.entitled, tier: access.tier, interval: access.interval, seats: access.seats,
        expiresAt: access.expiresAt, basis: access.basis, revokedUntil: access.revokedUntil } : null,
      cases: (await this.repository.listCases?.({ userId, limit: 100 })) || [],
      interventions: (await this.repository.listInterventions?.(userId, 50)) || [],
      links: account?.customerId ? { customer: `${dashboard}customers/${account.customerId}`,
        subscription: account.subscriptionId ? `${dashboard}subscriptions/${account.subscriptionId}` : null } : null,
    };
  }
  // Intervención registrada: motivo obligatorio, autor, estado antes/después y claves de idempotencia
  // propias. Reembolsar se hace en Stripe; aquí se decide qué pasa con el acceso y la renovación.
  async intervene(userId: string, input: Record<string, unknown>, actor: Actor) {
    requireReady(this.config);
    if (!this.repository.saveIntervention || !this.repository.updateIntervention || !this.repository.getCase || !this.repository.saveCase) {
      throw new BillingError("ADMIN_UNAVAILABLE", "La gestión de facturación no está disponible.", 503);
    }
    const action = input.action as AdminAction;
    if (!ADMIN_ACTIONS.includes(action)) throw badRequest("INVALID_ACTION", "Acción no válida.");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 3 || reason.length > 300) throw badRequest("REASON_REQUIRED", "Indica el motivo (entre 3 y 300 caracteres).");
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 1000) : null;
    const caseId = typeof input.caseId === "string" && /^(refund|dispute|efw):[A-Za-z0-9_]+$/.test(input.caseId) ? input.caseId : null;
    if (input.caseId !== undefined && input.caseId !== null && !caseId) throw badRequest("INVALID_CASE", "Caso no válido.");
    const params = this.interventionParams(action, input);
    const intervention: Intervention = { interventionId: newId("trainers-admin"), userId, mode: this.config.mode, action, reason, note,
      caseId, by: actor, at: new Date(), status: "pending", error: null, before: null, after: null, params };
    await this.user(userId);
    await this.repository.saveIntervention(intervention);
    let before: AccessSnapshot | null = null;
    let after: AccessSnapshot | null = null;
    try {
      await this.repository.withLock(userId, async (account, save) => {
        if (account.customerId && !account.deletedAt) await this.refresh(account, save);
        before = accessSnapshot(account);
        const entry = caseId ? await this.repository.getCase!(caseId) : null;
        if (caseId && (!entry || entry.userId !== userId)) throw new BillingError("CASE_NOT_FOUND", "El caso no pertenece a este entrenador.", 404);
        await this.applyAdminAction(account, save, action, params, entry, intervention);
        if (entry && (action === "resolve_case" || input.resolveCase === true)) {
          await this.repository.saveCase!({ ...entry, status: "resolved",
            resolution: { action, reason, note, by: actor, at: new Date(), interventionId: intervention.interventionId } });
        }
        await this.persist(account, save);
        after = accessSnapshot(account);
      });
      await this.repository.updateIntervention(intervention.interventionId, { status: "applied", before, after });
    } catch (error) {
      await this.repository.updateIntervention(intervention.interventionId, { status: "failed", before,
        error: error instanceof BillingError ? error.code : "UNEXPECTED" });
      throw error;
    }
    return this.adminTrainer(userId);
  }
  private interventionParams(action: AdminAction, input: Record<string, unknown>): Record<string, unknown> {
    if (action === "grant_access") {
      const until = typeof input.until === "string" ? new Date(input.until) : null;
      const now = Date.now();
      if (!until || !Number.isFinite(until.getTime()) || until.getTime() <= now || until.getTime() > now + 400 * DAY_MS) {
        throw badRequest("INVALID_UNTIL", "La fecha de la excepción debe ser futura y de como mucho 400 días.");
      }
      if (!isTier(input.tier) || input.tier === "free") throw badRequest("INVALID_TIER", "Elige el plan que se concede.");
      return { until: until.toISOString(), tier: input.tier };
    }
    if (action === "end_grant" || action === "restore_period_access") {
      if (typeof input.adjustmentId !== "string" || !/^adj-[a-f0-9]{24}$/.test(input.adjustmentId)) {
        throw badRequest("INVALID_ADJUSTMENT", "Ajuste de acceso no válido.");
      }
      return { adjustmentId: input.adjustmentId };
    }
    return {};
  }
  private async applyAdminAction(account: Account, save: () => Promise<void>, action: AdminAction, params: Record<string, unknown>,
    entry: BillingCase | null, intervention: Intervention): Promise<void> {
    const key = intervention.interventionId;
    const live = Boolean(account.subscriptionId && !TERMINAL.has(account.status) && !account.deletedAt);
    const requireLive = () => { if (!live) throw new BillingError("SUBSCRIPTION_NOT_ACTIVE", "No hay una suscripción vigente sobre la que actuar."); };
    switch (action) {
      case "resolve_case":
        if (!entry) throw badRequest("CASE_REQUIRED", "Indica el caso que se resuelve.");
        return;
      case "end_service_now":
        // Termina el servicio de pago ya (sin prorrateo ni factura final); los datos se conservan.
        requireLive();
        if (account.provider?.scheduleId) await this.gateway.releaseSchedule(account.provider.scheduleId, `${key}-release`);
        await this.gateway.cancelSubscription(account.subscriptionId!);
        await this.refresh(account, save);
        return;
      case "cancel_renewal": requireLive(); await this.controlLocked(account, save, "cancel"); return;
      case "resume_renewal": requireLive(); await this.controlLocked(account, save, "resume"); return;
      case "revert_upgrade": {
        requireLive();
        const financed = entry?.financed?.kind === "upgrade" ? entry.financed : this.appliedUpgrade(account);
        if (!financed || !await this.revertUpgradeLocked(account, save, financed, `${key}-revert`)) {
          throw new BillingError("NOT_REVERTIBLE", "Esa subida ya no es la vigente o cambia de periodicidad: revísalo en Stripe.");
        }
        return;
      }
      case "grant_access": {
        account.adjustments = [...(account.adjustments || []), { id: newId("adj"), kind: "grant", from: new Date(),
          until: new Date(params.until as string), tier: params.tier as Tier, interval: account.interval || null, invoiceId: null,
          reason: intervention.reason, source: "admin",
          caseId: intervention.caseId, interventionId: intervention.interventionId, createdAt: new Date(), liftedAt: null }];
        await save();
        return;
      }
      case "end_grant":
      case "restore_period_access": {
        const kind = action === "end_grant" ? "grant" : "revoke_period";
        const target = (account.adjustments || []).find((adjustment) => adjustment.id === params.adjustmentId && adjustment.kind === kind && !adjustment.liftedAt);
        if (!target) throw new BillingError("ADJUSTMENT_NOT_FOUND", "Ese ajuste de acceso no existe o ya se retiró.", 404);
        account.adjustments = (account.adjustments || []).map((adjustment) => adjustment === target ? { ...adjustment, liftedAt: new Date() } : adjustment);
        await save();
        return;
      }
      case "pause_collection": {
        requireLive();
        if (account.hold) throw new BillingError("ALREADY_PAUSED", "Los cobros ya están en pausa.");
        if (!this.gateway.pauseCollection) throw new BillingError("ADMIN_UNAVAILABLE", "La pausa de cobros no está disponible.", 503);
        const paused = await this.gateway.pauseCollection(account.subscriptionId!, `${key}-pause`);
        account.hold = { kind: "admin", since: new Date(), caseIds: entry ? [entry.caseId] : [], pausedInvoiceIds: paused.pausedInvoiceIds,
          subscriptionId: account.subscriptionId! };
        await save();
        await this.refresh(account, save);
        return;
      }
      case "resume_collection": {
        if (!account.hold) throw new BillingError("NOT_PAUSED", "Los cobros no están en pausa.");
        if (live) {
          if (!this.gateway.resumeCollection) throw new BillingError("ADMIN_UNAVAILABLE", "La reanudación de cobros no está disponible.", 503);
          await this.gateway.resumeCollection(account.subscriptionId!, account.hold.pausedInvoiceIds, `${key}-resume`, billingNow(account));
        }
        account.hold = null;
        await save();
        if (live) await this.refresh(account, save);
        return;
      }
    }
  }
  // La subida aplicada en este periodo (cuando no hay un caso con la factura que la financió).
  private appliedUpgrade(account: Account): Financed | null {
    const change = account.change;
    if (change?.status !== "applied" || change.quote.kind === "scheduled" || change.quote.from.interval !== change.quote.to.interval) return null;
    const { from, to } = change.quote;
    return { kind: "upgrade", invoiceId: change.invoiceId || null, subscriptionId: change.quote.subscriptionId, customerId: account.customerId || null,
      state: { tier: to.tier, interval: to.interval, extraSeats: to.extraSeats },
      fromState: { tier: from.tier, interval: from.interval, extraSeats: from.extraSeats },
      periodStart: change.quote.prorationDate, periodEnd: change.quote.periodEnd, amountPaid: change.quote.amountDueNow, currency: "eur" };
  }
}
