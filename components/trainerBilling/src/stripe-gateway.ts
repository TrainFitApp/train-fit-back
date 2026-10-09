import Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { API_VERSION } from "./config";
import { Interval, PlanState, PriceKind, Tier, catalogAmount, catalogPrices, isInterval, isTier, lookupKey,
  recurringAmount } from "./catalog";
import { stateFromLines } from "./financing";
import { Account, BillingDetails, BillingError, ChangeKind, ChangeOperation, ChangePreview, ChangeQuote, Config, DisputeView,
  EventRecord, FinancingInvoice, FraudWarningView, Gateway, InvoiceView, ItemUpdate, Mode, PaymentContext, PaymentMethodView,
  PhaseItem, PriceRef, QuoteLine, RefundView, Session, Subscription, SubscriptionItemView, User } from "./types";

// Eventos que procesa el backend. Los de dinero (reembolsos, disputas, avisos de fraude)
// también se recuperan con events.list si un webhook se pierde (service.backfillMoneyEvents).
export const MONEY_EVENT_TYPES = ["charge.refunded", "charge.refund.updated", "refund.created", "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated", "radar.early_fraud_warning.created", "radar.early_fraud_warning.updated"];
export const SUPPORTED_EVENT_TYPES = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
  "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired",
  "subscription_schedule.updated", "subscription_schedule.released", "subscription_schedule.completed", "subscription_schedule.canceled",
  "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.finalization_failed", ...MONEY_EVENT_TYPES];

// Los precios del catálogo llevan estos metadatos (los pone `npm run stripe:catalog`): así se
// reconocen también los precios archivados que sigan en suscripciones antiguas.
export const PRICE_METADATA = "trainfit_catalog";
const PRICE_CACHE_MS = 10 * 60000;
const LOOKUP_KEYS_PER_LIST = 10;

function id(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id || null;
}
// Every Stripe object must belong to the configured mode: a live key never
// touches test objects and the sandbox never accepts a live one.
function assertMode(livemode: boolean, mode: Mode): void {
  if (livemode !== (mode === "live")) throw new BillingError("MODE_MISMATCH", "Se ha rechazado un recurso de otro entorno de pagos.", 409);
}
export function encodeTarget(state: PlanState): string { return `${state.tier}:${state.interval}:${state.extraSeats}`; }
// Stripe rechazó abrir Checkout (petición inválida: no ha creado nada). Al log van el código, el parámetro
// y el id de la petición para buscarla en el Dashboard; nunca el payload ni el mensaje.
function checkoutRejection(error: unknown): unknown {
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) return error;
  console.error(`[TrainerBilling] Stripe rechazó abrir Checkout: ${error.code || "invalid_request"}` +
    `${error.param ? ` (${error.param})` : ""}, petición ${error.requestId || "sin id"}.`);
  return new BillingError("CHECKOUT_REJECTED", "No se ha podido abrir la página de pago.", 503);
}
function sessionView(session: Stripe.Checkout.Session, mode: Mode): Session {
  assertMode(session.livemode, mode);
  return { id: session.id, customerId: id(session.customer), subscriptionId: id(session.subscription),
    status: session.status, url: session.url, livemode: session.livemode,
    userId: session.metadata?.trainfitUserId, scope: session.metadata?.scope,
    attempt: session.metadata?.attempt, target: session.metadata?.target,
    termsAccepted: session.consent?.terms_of_service === "accepted" };
}
// Precio del catálogo de Trainers según sus metadatos; null si es de otro producto o no encaja.
export function priceRef(price: Stripe.Price): PriceRef | null {
  const meta = price.metadata || {};
  const kind = meta.trainfit_kind as PriceKind;
  if (meta[PRICE_METADATA] !== "trainers" || (kind !== "base" && kind !== "seat") || !isTier(meta.trainfit_tier) ||
      !isInterval(meta.trainfit_interval)) return null;
  const interval = meta.trainfit_interval as Interval;
  if (price.type !== "recurring" || price.currency !== "eur" || price.unit_amount === null ||
      price.recurring?.interval !== (interval === "annual" ? "year" : "month") || price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed" || price.billing_scheme !== "per_unit") return null;
  return { id: price.id, kind, tier: meta.trainfit_tier as Tier, interval, amount: price.unit_amount };
}
// Solo identificadores: los objetos se releen de Stripe al procesar (nunca se confía en el payload).
function eventRecord(event: Stripe.Event, mode: Mode): EventRecord | null {
  if (!SUPPORTED_EVENT_TYPES.includes(event.type)) return null;
  const object = event.data.object as unknown as { id?: string; object?: string; customer?: string | { id: string } | null;
    payment_intent?: string | { id: string } | null; refunded?: boolean; charge?: string | { id: string } | null };
  const record: EventRecord = { eventId: event.id, type: event.type, customerId: id(object.customer), mode, status: "pending", attempts: 0 };
  if (event.type === "charge.refunded") {
    record.detail = { chargeId: object.id, paymentIntentId: id(object.payment_intent), fullyRefunded: object.refunded === true };
  } else if (event.type.startsWith("refund.") || event.type === "charge.refund.updated") {
    record.detail = { refundId: object.id, chargeId: id(object.charge) || undefined, paymentIntentId: id(object.payment_intent) };
  } else if (event.type.startsWith("charge.dispute.")) {
    // A Dispute carries no customer: the service resolves it through its payment.
    record.detail = { disputeId: object.id, chargeId: id(object.charge) || undefined, paymentIntentId: id(object.payment_intent) };
  } else if (event.type.startsWith("radar.early_fraud_warning.")) {
    record.detail = { warningId: object.id, chargeId: id(object.charge) || undefined, paymentIntentId: id(object.payment_intent) };
  } else if (event.type === "checkout.session.completed") {
    record.detail = { sessionId: object.id };
  }
  return record;
}
function refundView(refund: Stripe.Refund): RefundView {
  return { id: refund.id, amount: refund.amount, status: refund.status || "pending", reason: refund.reason || null,
    failureReason: refund.failure_reason || null, createdAt: new Date(refund.created * 1000) };
}
function invoiceUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "invoice.stripe.com" && url.pathname.startsWith("/i/") && !url.username && !url.password ? value : undefined; }
  catch { return undefined; }
}
function pdfUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "pay.stripe.com" && !url.username && !url.password ? value : undefined; }
  catch { return undefined; }
}
function discountIds(discounts: Stripe.SubscriptionSchedule.Phase.Discount[]) {
  return discounts.map((discount) => {
    if (id(discount.discount)) return { discount: id(discount.discount)! };
    if (id(discount.promotion_code)) return { promotion_code: id(discount.promotion_code)! };
    if (id(discount.coupon)) return { coupon: id(discount.coupon)! };
    throw new BillingError("UNSUPPORTED_SUBSCRIPTION", "El descuento requiere revisión de soporte.");
  });
}
function subscriptionItemLine(line: Stripe.InvoiceLineItem): boolean { return line.parent?.type === "subscription_item_details"; }
function prorationLine(line: Stripe.InvoiceLineItem): boolean { return Boolean(line.parent?.subscription_item_details?.proration); }

// Reuse existing discount IDs instead of restarting coupon durations. Fail closed
// on advanced billing settings that this SaaS does not implement.
function copyPhase(phase: Stripe.SubscriptionSchedule.Phase): Stripe.SubscriptionScheduleUpdateParams.Phase {
  if (!phase.items.length || phase.add_invoice_items.length || phase.application_fee_percent ||
      phase.billing_thresholds || phase.on_behalf_of || phase.transfer_data || phase.trial_end || phase.trial ||
      phase.items.some((item) => item.billing_thresholds) || phase.collection_method === "send_invoice") {
    throw new BillingError("UNSUPPORTED_SUBSCRIPTION", "Esta configuración requiere revisión de soporte.");
  }
  // Managed Payments: Stripe emite la factura y responde del impuesto (issuer y liability "stripe").
  // La API no admite enviarlos (solo self/account): la fase los hereda de los ajustes por defecto
  // del calendario, que los conservan (comprobado en el sandbox, 2026-10-01).
  return { start_date: phase.start_date, end_date: phase.end_date, currency: phase.currency,
    collection_method: phase.collection_method || "charge_automatically",
    billing_cycle_anchor: phase.billing_cycle_anchor || "automatic",
    default_payment_method: id(phase.default_payment_method) || undefined,
    default_tax_rates: phase.default_tax_rates?.map((rate) => rate.id) || [],
    description: phase.description || undefined, discounts: discountIds(phase.discounts),
    metadata: phase.metadata || undefined, proration_behavior: "none",
    items: phase.items.map((item) => ({ price: id(item.price)!, quantity: item.quantity ?? 1,
      discounts: discountIds(item.discounts), tax_rates: item.tax_rates?.map((rate) => rate.id) || [],
      metadata: item.metadata || undefined })) };
}
function samePhaseItems(a: PhaseItem[], b: PhaseItem[]): boolean {
  const key = (items: PhaseItem[]) => items.filter((item) => item.quantity > 0).map((item) => `${item.price}x${item.quantity}`).sort().join();
  return key(a) === key(b);
}

export class StripeGateway implements Gateway {
  readonly stripe: Stripe;
  private book: { at: number; byKey: Map<string, PriceRef> } | null = null;
  private refs = new Map<string, PriceRef | null>();
  constructor(private config: Config) {
    this.stripe = new Stripe(config.key, { apiVersion: API_VERSION, timeout: 10000, maxNetworkRetries: 2 });
  }
  private check(livemode: boolean): void { assertMode(livemode, this.config.mode); }
  private taxOf(invoice: Stripe.Invoice): number {
    return (invoice.total_taxes || []).reduce((sum, tax) => sum + (tax.amount || 0), 0);
  }

  // ---- Catálogo ----

  // Precios a la venta, buscados por lookup key y comprobados contra el catálogo (importe, intervalo,
  // moneda, IVA aparte). Se cachean unos minutos: cada propuesta los necesita.
  private async priceBook(): Promise<Map<string, PriceRef>> {
    if (this.book && Date.now() - this.book.at < PRICE_CACHE_MS) return this.book.byKey;
    // Stripe admite como mucho 10 lookup keys por consulta y el catálogo tiene más.
    const keys = catalogPrices().map((entry) => lookupKey(entry.kind, entry.tier, entry.interval));
    const prices: Stripe.Price[] = [];
    for (let i = 0; i < keys.length; i += LOOKUP_KEYS_PER_LIST) {
      prices.push(...(await this.stripe.prices.list({ lookup_keys: keys.slice(i, i + LOOKUP_KEYS_PER_LIST), active: true, limit: 100 })).data);
    }
    const byKey = new Map<string, PriceRef>();
    for (const price of prices) {
      this.check(price.livemode);
      const ref = priceRef(price);
      if (!ref || !price.lookup_key) continue;
      if (lookupKey(ref.kind, ref.tier, ref.interval) !== price.lookup_key || ref.amount !== catalogAmount(ref.kind, ref.tier, ref.interval) ||
          price.tax_behavior !== "exclusive") {
        throw new BillingError("PRICE_MISMATCH", "El precio configurado en Stripe no coincide con el catálogo.", 503);
      }
      byKey.set(price.lookup_key, ref);
      this.refs.set(ref.id, ref);
    }
    this.book = { at: Date.now(), byKey };
    return byKey;
  }
  private async priceFor(kind: PriceKind, tier: Tier, interval: Interval): Promise<PriceRef> {
    const ref = (await this.priceBook()).get(lookupKey(kind, tier, interval));
    if (!ref) throw new BillingError("PRICE_CATALOG_REQUIRED", "Falta un precio del catálogo en Stripe.", 503);
    return ref;
  }
  // Cualquier precio (también archivado) por id, para leer facturas y suscripciones.
  private async priceInfo(priceId: string | null): Promise<PriceRef | null> {
    if (!priceId) return null;
    if (this.refs.has(priceId)) return this.refs.get(priceId)!;
    const price = await this.stripe.prices.retrieve(priceId);
    this.check(price.livemode);
    const ref = priceRef(price);
    this.refs.set(priceId, ref);
    return ref;
  }
  async validateState(state: PlanState): Promise<void> {
    if (state.tier !== "free") await this.priceFor("base", state.tier, state.interval);
    if (state.extraSeats > 0) await this.priceFor("seat", state.tier, state.interval);
  }
  // Elementos con cantidad > 0 de un estado: la cuota (si el plan la tiene) y las plazas adicionales.
  private async phaseItems(state: PlanState): Promise<PhaseItem[]> {
    const items: PhaseItem[] = [];
    if (state.tier !== "free") items.push({ price: (await this.priceFor("base", state.tier, state.interval)).id, quantity: 1 });
    if (state.extraSeats > 0) items.push({ price: (await this.priceFor("seat", state.tier, state.interval)).id, quantity: state.extraSeats });
    return items;
  }
  // Cambios sobre los elementos actuales para llegar al estado pedido. La plaza adicional se reutiliza
  // (con cantidad 0 si no quedan plazas) y solo se borra si el plan de destino no vende plazas.
  private async itemUpdates(sub: Subscription, target: PlanState): Promise<ItemUpdate[]> {
    const updates: ItemUpdate[] = [];
    const baseItem = sub.items.find((item) => item.price.kind === "base");
    const seatItem = sub.items.find((item) => item.price.kind === "seat");
    if (target.tier !== "free") {
      const base = await this.priceFor("base", target.tier, target.interval);
      if (!baseItem) updates.push({ price: base.id, quantity: 1 });
      else if (baseItem.price.id !== base.id || baseItem.quantity !== 1) updates.push({ id: baseItem.id, price: base.id, quantity: 1 });
    } else if (baseItem) updates.push({ id: baseItem.id, deleted: true });
    const seat = catalogAmount("seat", target.tier, target.interval) !== undefined
      ? await this.priceFor("seat", target.tier, target.interval) : null;
    if (target.extraSeats > 0) {
      if (!seatItem) updates.push({ price: seat!.id, quantity: target.extraSeats });
      else if (seatItem.price.id !== seat!.id || seatItem.quantity !== target.extraSeats) {
        updates.push({ id: seatItem.id, price: seat!.id, quantity: target.extraSeats });
      }
    } else if (seatItem) {
      if (!seat) updates.push({ id: seatItem.id, deleted: true });
      else if (seatItem.price.id !== seat.id || seatItem.quantity !== 0) updates.push({ id: seatItem.id, price: seat.id, quantity: 0 });
    }
    return updates;
  }
  // Lo que se enviará a Stripe para llegar al estado pedido; se guarda en la propuesta.
  async changeItems(sub: Subscription, target: PlanState): Promise<{ updates: ItemUpdate[]; fromItems: PhaseItem[]; targetItems: PhaseItem[] }> {
    return { updates: await this.itemUpdates(sub, target),
      fromItems: sub.items.filter((item) => item.quantity > 0).map((item) => ({ price: item.price.id, quantity: item.quantity })),
      targetItems: await this.phaseItems(target) };
  }

  // ---- Clientes, suscripciones y Checkout ----

  async createCustomer(user: User, idempotencyKey: string): Promise<string> {
    const customer = await this.stripe.customers.create({ email: user.email,
      metadata: { trainfitUserId: user.id, scope: "trainers" } }, { idempotencyKey });
    this.check(customer.livemode);
    return customer.id;
  }
  async listSubscriptions(customerId: string): Promise<Subscription[]> {
    const list = await this.stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100,
      expand: ["data.latest_invoice", "data.test_clock"] });
    if (list.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "Contacta con soporte para revisar tu suscripción.");
    return Promise.all(list.data.map((sub) => this.subscriptionView(sub)));
  }
  private async subscriptionView(sub: Stripe.Subscription): Promise<Subscription> {
    this.check(sub.livemode);
    const testClock = sub.test_clock;
    if (testClock && (typeof testClock === "string" || testClock.status !== "ready")) {
      throw new BillingError("TEST_CLOCK_NOT_READY", "Espera a que termine de avanzar el reloj de pruebas.", 503);
    }
    if (testClock && typeof testClock !== "string") this.check(testClock.livemode);
    if (!sub.items.data.length || sub.items.has_more) throw new BillingError("UNSUPPORTED_SUBSCRIPTION", "La suscripción requiere revisión de soporte.");
    const items: SubscriptionItemView[] = [];
    let unknown = false;
    for (const item of sub.items.data) {
      const ref = priceRef(item.price);
      if (ref) { this.refs.set(ref.id, ref); items.push({ id: item.id, price: ref, quantity: item.quantity ?? 0 }); }
      else if ((item.quantity ?? 0) > 0) unknown = true;
    }
    const active = items.filter((item) => item.quantity > 0);
    const bases = active.filter((item) => item.price.kind === "base");
    const seats = active.filter((item) => item.price.kind === "seat");
    // Solo una cuota y una plaza adicional; cualquier otra forma la revisa soporte.
    const state = !unknown && bases.length <= 1 && seats.length <= 1 ? stateFromLines(bases[0], seats[0]) : null;
    const anchor = sub.items.data.find((item) => item.id === (bases[0] || seats[0])?.id) || sub.items.data[0]!;
    let invoice = sub.latest_invoice;
    if (typeof invoice === "string") invoice = await this.stripe.invoices.retrieve(invoice);
    if (invoice) this.check(invoice.livemode);
    const lines = invoice?.lines.has_more ? await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 }) : invoice?.lines;
    if (lines?.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    // Prueba de pago: la última factura está pagada y cubre los elementos vigentes.
    const activeIds = new Set(active.map((item) => item.id));
    const covered = (lines?.data || []).filter((line) => subscriptionItemLine(line) &&
      activeIds.has(line.parent?.subscription_item_details?.subscription_item || ""));
    return { id: sub.id, customerId: id(sub.customer) || "", status: sub.status, state, items,
      currentPeriodEnd: anchor.current_period_end, currentPeriodStart: anchor.current_period_start,
      cancelAtPeriodEnd: sub.cancel_at_period_end, paid: invoice?.status === "paid" && !sub.pending_update,
      paidPeriodEnd: covered.length ? Math.max(...covered.map((line) => line.period.end)) : 0,
      livemode: sub.livemode, userId: sub.metadata.trainfitUserId, scope: sub.metadata.scope, scheduleId: id(sub.schedule),
      latestInvoiceId: id(invoice), latestInvoiceStatus: invoice?.status,
      latestInvoiceUrl: invoiceUrl(invoice?.hosted_invoice_url), latestInvoiceAmountDue: invoice?.amount_due,
      pendingUpdate: Boolean(sub.pending_update), pendingUpdateExpiresAt: sub.pending_update?.expires_at,
      collectionMethod: sub.collection_method, collectionPaused: Boolean(sub.pause_collection),
      billingNow: testClock && typeof testClock !== "string" ? testClock.frozen_time : undefined,
      fingerprint: createHash("sha256").update(JSON.stringify({ id: sub.id,
        items: sub.items.data.map((item) => [item.id, item.price.id, item.quantity, item.current_period_start, item.current_period_end,
          item.discounts, item.tax_rates]),
        status: sub.status, cancel: sub.cancel_at_period_end, cancelAt: sub.cancel_at, schedule: id(sub.schedule),
        pending: sub.pending_update, invoice: id(invoice), invoiceStatus: invoice?.status,
        discounts: sub.discounts, tax: sub.default_tax_rates, mode: sub.billing_mode, collection: sub.collection_method,
        pause: sub.pause_collection })).digest("hex") };
  }
  async listSessions(customerId: string): Promise<Session[]> {
    const list = await this.stripe.checkout.sessions.list({ customer: customerId, limit: 100 });
    // Recent 100 sessions are enough for normal accounts; never create another on ambiguity.
    if (list.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "Contacta con soporte para revisar los pagos pendientes.");
    return list.data.map((session) => sessionView(session, this.config.mode));
  }
  async getSession(sessionId: string): Promise<Session> {
    return sessionView(await this.stripe.checkout.sessions.retrieve(sessionId), this.config.mode);
  }
  async createCheckout(user: User, account: Account, target: PlanState, key: string): Promise<Session> {
    const metadata = { trainfitUserId: user.id, scope: "trainers", attempt: key, target: encodeTarget(target) };
    // Label remains stable for retries sharing the same Stripe idempotency key.
    const suffix = key.slice(-8).replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)));
    const session = await this.stripe.checkout.sessions.create({ mode: "subscription", customer: account.customerId,
      client_reference_id: user.id, metadata, subscription_data: { metadata },
      line_items: (await this.phaseItems(target)).map((item) => ({ price: item.price, quantity: item.quantity })),
      // Managed Payments: Stripe vende como comerciante registrado; él calcula el impuesto, pide la
      // dirección, elige los métodos de pago y no admite texto propio (comprobado en el sandbox, 2026-10-01).
      managed_payments: { enabled: true }, billing_address_collection: "required",
      // Con condiciones publicadas, Checkout exige aceptarlas (y Stripe guarda la aceptación en la sesión).
      // Requiere la URL de condiciones también en los datos públicos de la cuenta.
      ...(this.config.termsUrl ? { consent_collection: { terms_of_service: "required" as const } } : {}),
      allow_promotion_codes: true,
      success_url: `${this.config.returnUrl}/tabs/subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.returnUrl}/tabs/subscription?checkout=cancelled`,
      expires_at: Math.floor(account.checkout!.startedAt.getTime() / 1000) + 3600,
      integration_identifier: `trainfit_trainers_${suffix}`,
    } as Stripe.Checkout.SessionCreateParams, { idempotencyKey: key }).catch((error: unknown) => { throw checkoutRejection(error); });
    return sessionView(session, this.config.mode);
  }
  // Portal de la cuenta (configuración predeterminada): facturas, método de pago y cancelación a fin
  // de periodo; nunca cambios de plan, que pasan por la propuesta de Trainers.
  async createPortal(customerId: string): Promise<string> {
    const configuration = (await this.stripe.billingPortal.configurations.list({ is_default: true, active: true, limit: 1 })).data[0];
    if (!configuration) throw new BillingError("PORTAL_NOT_READY", "El portal de facturación todavía no está disponible.", 503);
    this.check(configuration.livemode);
    const features = configuration.features;
    if (features.subscription_update?.enabled || !features.invoice_history?.enabled ||
        !features.payment_method_update?.enabled || !features.subscription_cancel?.enabled ||
        features.subscription_cancel.mode !== "at_period_end") {
      throw new BillingError("PORTAL_NOT_READY", "El portal requiere una configuración compatible.", 503);
    }
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId,
      configuration: configuration.id, return_url: `${this.config.returnUrl}/tabs/subscription?from=portal` });
    return session.url;
  }
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
  }
  async expireSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  // ---- Propuestas y cambios ----

  async previewChange(sub: Subscription, target: PlanState, kind: ChangeKind, prorationDate: number): Promise<ChangePreview> {
    const intervalChanges = sub.state?.interval !== target.interval;
    // No invoice is generated today for a scheduled change. With an interval change (or a schedule
    // already attached, whose next phase Stripe would preview instead) the renewal is the catalog
    // tariff: an explicit estimate without VAT; coupons and credit may change before that date.
    const tariff = { amountDueNow: 0, renewalAmount: recurringAmount(target), renewalAt: sub.currentPeriodEnd,
      creditBalance: 0, renewalExcludesTax: true };
    if (kind === "scheduled" && (intervalChanges || sub.scheduleId)) return tariff;
    const items = await this.itemUpdates(sub, target);
    if (kind === "scheduled") {
      const renewal = await this.preview(sub.id, items, "none");
      return { ...tariff, renewalAmount: Math.max(0, renewal.amount_due), renewalExcludesTax: false };
    }
    const invoice = await this.preview(sub.id, items, "always_invoice", prorationDate);
    const targetPrices = new Set((await this.phaseItems(target)).map((item) => item.price));
    const targetLine = invoice.lines.data.find((line) => targetPrices.has(id(line.pricing?.price_details?.price) || "") && line.amount >= 0);
    let renewalAmount = recurringAmount(target);
    if (!intervalChanges && !sub.scheduleId) renewalAmount = Math.max(0, (await this.preview(sub.id, items, "none")).amount_due);
    return { amountDueNow: Math.max(0, invoice.amount_due), renewalAmount,
      renewalAt: intervalChanges ? targetLine?.period.end : sub.currentPeriodEnd,
      creditBalance: Math.max(0, -(invoice.ending_balance || 0)),
      lines: await this.quoteLines(invoice.lines.data), taxAmount: this.taxOf(invoice),
      // Tras cambiar de periodicidad no hay previsualización de la renovación: la tarifa va sin IVA.
      renewalExcludesTax: intervalChanges };
  }
  private async preview(subscriptionId: string, items: ItemUpdate[], proration: "none" | "always_invoice" | "create_prorations",
    prorationDate?: number): Promise<Stripe.Invoice> {
    const invoice = await this.stripe.invoices.createPreview({ subscription: subscriptionId, subscription_details: {
      items: items as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[], proration_behavior: proration,
      ...(proration !== "none" && prorationDate ? { proration_date: prorationDate } : {}) } });
    this.check(invoice.livemode);
    if (invoice.currency !== "eur" || invoice.lines.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    return invoice;
  }
  // Desglose de lo que se cobra (crédito del tiempo no usado y cargo de lo nuevo). Importes de Stripe; etiquetas nuestras.
  private async quoteLines(lines: Stripe.InvoiceLineItem[]): Promise<QuoteLine[]> {
    const result: QuoteLine[] = [];
    for (const line of lines) {
      if (!subscriptionItemLine(line)) continue;
      const price = await this.priceInfo(id(line.pricing?.price_details?.price));
      if (!price || (line.amount === 0 && !line.quantity)) continue;
      result.push({ kind: line.amount < 0 ? "credit" : prorationLine(line) ? "charge" : "recurring", item: price.kind,
        tier: price.tier, interval: price.interval, quantity: line.quantity ?? 0, amount: line.amount,
        periodStart: new Date(line.period.start * 1000), periodEnd: new Date(line.period.end * 1000) });
    }
    return result;
  }
  async billingDetails(customerId: string, subscriptionId: string | null): Promise<BillingDetails> {
    const list = await this.stripe.invoices.list({ customer: customerId, limit: 12 });
    const invoices: InvoiceView[] = [];
    for (const invoice of list.data) {
      this.check(invoice.livemode);
      if (id(invoice.customer) !== customerId || invoice.status === "draft") continue;
      const known = ["subscription_create", "subscription_cycle", "subscription_update"] as const;
      const reason = known.find((entry) => entry === invoice.billing_reason);
      const line = invoice.lines.data.find(subscriptionItemLine);
      invoices.push({ id: invoice.id, number: invoice.number || null, status: invoice.status || "open",
        createdAt: new Date(invoice.created * 1000), total: invoice.total, amountPaid: invoice.amount_paid,
        amountDue: invoice.amount_due, currency: invoice.currency,
        reason: reason || "other",
        periodStart: line ? new Date(line.period.start * 1000) : null, periodEnd: line ? new Date(line.period.end * 1000) : null,
        hostedUrl: invoiceUrl(invoice.hosted_invoice_url), pdfUrl: pdfUrl(invoice.invoice_pdf),
        creditedAmount: invoice.post_payment_credit_notes_amount || 0 });
    }
    return { invoices, paymentMethod: subscriptionId ? await this.paymentMethod(subscriptionId, customerId) : null };
  }
  // Solo lectura y opcional: si la clave no puede leer el método, se omite (el portal sigue disponible).
  private async paymentMethod(subscriptionId: string, customerId: string): Promise<PaymentMethodView | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
      this.check(sub.livemode);
      if (id(sub.customer) !== customerId) return null;
      let method = sub.default_payment_method;
      if (!method || typeof method === "string") {
        const customer = await this.stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
        method = "deleted" in customer && customer.deleted ? null : (customer as Stripe.Customer).invoice_settings?.default_payment_method || null;
      }
      if (!method || typeof method === "string") return null;
      // Link guarda el pago en su propia cartera: sin marca ni últimos 4 dígitos.
      if (method.type === "link") return { brand: "link", last4: "", expMonth: 0, expYear: 0, kind: "link", wallet: null };
      if (method.type !== "card" || !method.card) return null;
      return { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year,
        kind: "card", wallet: method.card.wallet?.type || null };
    } catch { return null; }
  }
  async upcomingRenewal(sub: Subscription): Promise<{ at: number; amount: number; state: PlanState | null; subtotal: number } | null> {
    if (sub.cancelAtPeriodEnd || sub.pendingUpdate || !["active", "past_due"].includes(sub.status)) return null;
    const invoice = await this.stripe.invoices.createPreview({ subscription: sub.id });
    this.check(invoice.livemode);
    if (invoice.currency !== "eur") throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    const recurring = invoice.lines.data.filter((line) => subscriptionItemLine(line) && !prorationLine(line));
    if (!recurring.length) return null;
    // Estado que cobrará Stripe (incluida una fase programada); subtotal antes de descuentos
    // permite saber si el importe lleva descuento o saldo.
    const parts = await Promise.all(recurring.map(async (line) => ({ price: await this.priceInfo(id(line.pricing?.price_details?.price)),
      quantity: line.quantity ?? 0 })));
    const base = parts.find((part) => part.price?.kind === "base");
    const seat = parts.find((part) => part.price?.kind === "seat" && part.quantity > 0);
    return { at: recurring[0]!.period.start, amount: Math.max(0, invoice.amount_due), state: stateFromLines(base, seat),
      subtotal: invoice.subtotal };
  }
  async applyUpgrade(quote: ChangeQuote, key: string): Promise<{ invoiceId: string }> {
    const changed = await this.stripe.subscriptions.update(quote.subscriptionId, {
      items: quote.updates as Stripe.SubscriptionUpdateParams.Item[],
      payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice", proration_date: quote.prorationDate,
      // Changing the recurring interval resets the anchor automatically.
      // Stripe rejects explicit anchor=now together with proration_date.
    }, { idempotencyKey: key });
    this.check(changed.livemode);
    const invoiceId = id(changed.latest_invoice);
    if (!invoiceId) throw new BillingError("BILLING_REVIEW_REQUIRED", "El cambio necesita revisión de soporte.");
    return { invoiceId };
  }
  async scheduleChange(quote: ChangeQuote, key: string): Promise<{ scheduleId: string }> {
    // Stable create/update keys recover a response lost between the two calls.
    const created = await this.stripe.subscriptionSchedules.create({ from_subscription: quote.subscriptionId }, { idempotencyKey: `${key}-create` });
    this.check(created.livemode);
    const current = created.phases.find((phase) => phase.start_date <= quote.prorationDate && phase.end_date > quote.prorationDate);
    if (!current || created.phases.length !== 1 ||
        !samePhaseItems(current.items.map((item) => ({ price: id(item.price)!, quantity: item.quantity ?? 0 })), quote.fromItems)) {
      throw new BillingError("BILLING_REVIEW_REQUIRED", "La programación requiere revisión de soporte.");
    }
    const first = copyPhase(current);
    first.end_date = quote.periodEnd;
    const next: Stripe.SubscriptionScheduleUpdateParams.Phase = { ...first, start_date: quote.periodEnd,
      end_date: undefined, duration: { interval: quote.to.interval === "annual" ? "year" : "month", interval_count: 1 },
      items: quote.targetItems.map((item) => ({ price: item.price, quantity: item.quantity })), billing_cycle_anchor: "phase_start" };
    await this.stripe.subscriptionSchedules.update(created.id, { end_behavior: "release", proration_behavior: "none",
      phases: [first, next], metadata: { trainfitChangeId: quote.quoteId, scope: "trainers" } }, { idempotencyKey: `${key}-update` });
    return { scheduleId: created.id };
  }
  async changePayment(account: Account, operation: ChangeOperation) {
    const invoice = await this.stripe.invoices.retrieve(operation.invoiceId!);
    this.check(invoice.livemode);
    const quote = operation.quote;
    if (id(invoice.customer) !== account.customerId || id(invoice.parent?.subscription_details?.subscription) !== quote.subscriptionId ||
        invoice.billing_reason !== "subscription_update" || invoice.currency !== "eur") {
      throw new BillingError("PAYMENT_NOT_OWNED", "La factura del cambio requiere revisión.");
    }
    const lines = invoice.lines.has_more ? await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 }) : invoice.lines;
    if (lines.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    const targetPrices = new Set(quote.targetItems.map((item) => item.price));
    const debit = lines.data.find((line) => line.amount > 0 && subscriptionItemLine(line) &&
      targetPrices.has(id(line.pricing?.price_details?.price) || ""));
    return { paid: invoice.status === "paid" && Boolean(debit), voided: invoice.status === "void" || invoice.status === "uncollectible",
      periodEnd: debit?.period.end || 0, url: invoiceUrl(invoice.hosted_invoice_url) };
  }
  async releaseSchedule(scheduleId: string, key: string): Promise<void> {
    const schedule = await this.stripe.subscriptionSchedules.retrieve(scheduleId);
    this.check(schedule.livemode);
    if (["released", "completed", "canceled"].includes(schedule.status)) return;
    await this.stripe.subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true }, { idempotencyKey: key });
  }
  async voidInvoice(invoiceId: string, key: string): Promise<void> {
    const invoice = await this.stripe.invoices.retrieve(invoiceId);
    this.check(invoice.livemode);
    if (invoice.status === "paid" || invoice.status === "void") return;
    await this.stripe.invoices.voidInvoice(invoiceId, {}, { idempotencyKey: key });
  }
  async setCancellation(subscriptionId: string, cancel: boolean, key: string): Promise<void> {
    const sub = await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel, proration_behavior: "none" }, { idempotencyKey: key });
    this.check(sub.livemode);
  }
  // Deshace una subida: vuelve al estado anterior sin prorrateo, así que no genera factura ni cobro.
  async revertState(sub: Subscription, state: PlanState, key: string): Promise<void> {
    const changed = await this.stripe.subscriptions.update(sub.id, {
      items: (await this.itemUpdates(sub, state)) as Stripe.SubscriptionUpdateParams.Item[], proration_behavior: "none" },
    { idempotencyKey: key });
    this.check(changed.livemode);
  }

  // ---- Webhooks y dinero ----

  verifyEvent(body: Buffer, signature: string): EventRecord | null {
    let event: Stripe.Event;
    try { event = this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret); }
    catch { throw new BillingError("INVALID_SIGNATURE", "Firma de webhook inválida.", 400); }
    this.check(event.livemode);
    return eventRecord(event, this.config.mode);
  }
  // Recupera eventos recientes de la API (firmados por el propio acceso de la clave), p. ej. tras una caída del webhook.
  async recentEvents(types: string[], since: number): Promise<EventRecord[]> {
    const records: EventRecord[] = [];
    for await (const event of this.stripe.events.list({ types, created: { gte: since }, limit: 100 })) {
      this.check(event.livemode);
      const record = eventRecord(event, this.config.mode);
      if (record) records.push(record);
      if (records.length >= 500) break;
    }
    return records.reverse();
  }
  // Cargo → PaymentIntent → factura con sus líneas. Siempre desde Stripe, nunca desde el payload del evento.
  async paymentContext(ref: { chargeId?: string | null; paymentIntentId?: string | null }): Promise<PaymentContext | null> {
    let charge: Stripe.Charge | null = ref.chargeId ? await this.stripe.charges.retrieve(ref.chargeId) : null;
    let paymentIntentId = ref.paymentIntentId || (charge ? id(charge.payment_intent) : null);
    if (!charge && paymentIntentId) charge = (await this.stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 })).data[0] || null;
    if (charge) { this.check(charge.livemode); paymentIntentId ||= id(charge.payment_intent); }
    if (!paymentIntentId) return null;
    let financing: FinancingInvoice | null = null;
    const payments = await this.stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1 });
    const invoiceId = id(payments.data[0]?.invoice as string | { id: string } | null | undefined);
    if (invoiceId) {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      this.check(invoice.livemode);
      const lines = invoice.lines.has_more ? await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 }) : invoice.lines;
      if (!lines.has_more) {
        financing = { id: invoice.id, subscriptionId: id(invoice.parent?.subscription_details?.subscription), customerId: id(invoice.customer),
          billingReason: invoice.billing_reason || null, amountPaid: invoice.amount_paid, currency: invoice.currency,
          lines: await Promise.all(lines.data.filter(subscriptionItemLine).map(async (line) => ({
            amount: line.amount, price: await this.priceInfo(id(line.pricing?.price_details?.price)), quantity: line.quantity ?? 0,
            proration: prorationLine(line), subscriptionItem: line.parent?.subscription_item_details?.subscription_item || null,
            periodStart: line.period.start, periodEnd: line.period.end }))) };
      }
    }
    const refunds = charge ? (await this.stripe.refunds.list({ charge: charge.id, limit: 100 })).data.map(refundView) : [];
    return { chargeId: charge?.id || null, paymentIntentId, customerId: (charge ? id(charge.customer) : null) || financing?.customerId || null,
      amount: charge?.amount || 0, amountRefunded: charge?.amount_refunded || 0, refunded: charge?.refunded === true,
      currency: charge?.currency || financing?.currency || "eur", refunds, invoice: financing };
  }
  async getDispute(disputeId: string): Promise<DisputeView> {
    const dispute = await this.stripe.disputes.retrieve(disputeId);
    this.check(dispute.livemode);
    const due = dispute.evidence_details?.due_by;
    return { id: dispute.id, status: dispute.status, amount: dispute.amount, currency: dispute.currency, reason: dispute.reason || null,
      chargeId: id(dispute.charge), paymentIntentId: id(dispute.payment_intent), dueBy: due ? new Date(due * 1000) : null,
      createdAt: new Date(dispute.created * 1000) };
  }
  async getFraudWarning(warningId: string): Promise<FraudWarningView> {
    const warning = await this.stripe.radar.earlyFraudWarnings.retrieve(warningId);
    this.check(warning.livemode);
    return { id: warning.id, chargeId: id(warning.charge), paymentIntentId: id(warning.payment_intent), fraudType: warning.fraud_type || null,
      actionable: warning.actionable, createdAt: new Date(warning.created * 1000) };
  }
  // Disputa (decisión 2026-09-28): sin cobros nuevos mientras se resuelve. Las facturas nuevas quedan en
  // borrador y las abiertas dejan de reintentarse; el acceso ya pagado no cambia.
  async pauseCollection(subscriptionId: string, key: string): Promise<{ pausedInvoiceIds: string[] }> {
    const sub = await this.stripe.subscriptions.update(subscriptionId, { pause_collection: { behavior: "keep_as_draft" } }, { idempotencyKey: key });
    this.check(sub.livemode);
    const pausedInvoiceIds: string[] = [];
    for (const invoice of (await this.stripe.invoices.list({ subscription: subscriptionId, status: "open", limit: 100 })).data) {
      if (!invoice.auto_advance) continue;
      await this.stripe.invoices.update(invoice.id, { auto_advance: false }, { idempotencyKey: `${key}-${invoice.id}` });
      pausedInvoiceIds.push(invoice.id);
    }
    return { pausedInvoiceIds };
  }
  // Reanuda cobros. Solo vuelve a cobrarse el borrador del periodo vigente: nunca periodos ya pasados
  // durante la pausa (el entrenador no tuvo acceso de pago en ellos). Los reintentos pausados se reactivan.
  async resumeCollection(subscriptionId: string, pausedInvoiceIds: string[], key: string, now: number): Promise<void> {
    const sub = await this.stripe.subscriptions.update(subscriptionId, { pause_collection: "" }, { idempotencyKey: key });
    this.check(sub.livemode);
    for (const draft of (await this.stripe.invoices.list({ subscription: subscriptionId, status: "draft", limit: 100 })).data) {
      const line = draft.lines.data.find(subscriptionItemLine);
      if (draft.auto_advance || !line || line.period.end <= now) continue;
      await this.stripe.invoices.update(draft.id, { auto_advance: true }, { idempotencyKey: `${key}-${draft.id}` });
    }
    for (const invoiceId of pausedInvoiceIds) {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      if (invoice.status !== "open" || invoice.auto_advance) continue;
      await this.stripe.invoices.update(invoiceId, { auto_advance: true }, { idempotencyKey: `${key}-${invoiceId}` });
    }
  }
  async invoiceForPayment(paymentIntentId: string) {
    const payments = await this.stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1 });
    const invoiceId = id(payments.data[0]?.invoice as string | { id: string } | null | undefined);
    if (!invoiceId) return null;
    const invoice = await this.stripe.invoices.retrieve(invoiceId);
    this.check(invoice.livemode);
    return { invoiceId, subscriptionId: id(invoice.parent?.subscription_details?.subscription), customerId: id(invoice.customer) };
  }
}

export function checkoutKey(): string { return `trainers-checkout-${randomBytes(20).toString("hex")}`; }