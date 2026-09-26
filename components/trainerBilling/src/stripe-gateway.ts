import Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { API_VERSION } from "./config";
import { Account, BillingDetails, BillingError, ChangeOperation, ChangeQuote, Config, EventRecord, Gateway, InvoiceView, Mode, PaymentMethodView, PlanPrice, QuoteLine, Session, Subscription, User } from "./types";

function id(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id || null;
}
// Every Stripe object must belong to the configured mode: a live key never
// touches test objects and the sandbox never accepts a live one.
function assertMode(livemode: boolean, mode: Mode): void {
  if (livemode !== (mode === "live")) throw new BillingError("MODE_MISMATCH", "Se ha rechazado un recurso de otro entorno de pagos.", 409);
}
function sessionView(session: Stripe.Checkout.Session, mode: Mode): Session {
  assertMode(session.livemode, mode);
  return { id: session.id, customerId: id(session.customer), subscriptionId: id(session.subscription),
    status: session.status, url: session.url, livemode: session.livemode,
    userId: session.metadata?.trainfitUserId, scope: session.metadata?.scope,
    attempt: session.metadata?.attempt, priceId: session.metadata?.priceId };
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

// Reuse existing discount IDs instead of restarting coupon durations. Fail closed
// on advanced billing settings that this single-item SaaS does not implement.
function copyPhase(phase: Stripe.SubscriptionSchedule.Phase): Stripe.SubscriptionScheduleUpdateParams.Phase {
  if (phase.items.length !== 1 || phase.add_invoice_items.length || phase.application_fee_percent ||
      phase.billing_thresholds || phase.on_behalf_of || phase.transfer_data || phase.trial_end || phase.trial ||
      phase.items[0]!.billing_thresholds || phase.collection_method === "send_invoice") {
    throw new BillingError("UNSUPPORTED_SUBSCRIPTION", "Esta configuración requiere revisión de soporte.");
  }
  const item = phase.items[0]!;
  const settings = phase.invoice_settings;
  return { start_date: phase.start_date, end_date: phase.end_date, currency: phase.currency,
    collection_method: phase.collection_method || "charge_automatically",
    automatic_tax: phase.automatic_tax ? { enabled: phase.automatic_tax.enabled } : undefined,
    billing_cycle_anchor: phase.billing_cycle_anchor || "automatic",
    default_payment_method: id(phase.default_payment_method) || undefined,
    default_tax_rates: phase.default_tax_rates?.map((rate) => rate.id) || [],
    description: phase.description || undefined, discounts: discountIds(phase.discounts),
    metadata: phase.metadata || undefined, proration_behavior: "none",
    invoice_settings: settings ? { account_tax_ids: settings.account_tax_ids?.map((tax) => id(tax)!) || undefined,
      days_until_due: settings.days_until_due || undefined, issuer: settings.issuer ? {
        type: settings.issuer.type, account: id(settings.issuer.account) || undefined } : undefined } : undefined,
    items: [{ price: id(item.price)!, quantity: item.quantity || 1,
      discounts: discountIds(item.discounts), tax_rates: item.tax_rates?.map((rate) => rate.id) || [],
      metadata: item.metadata || undefined }] };
}

export class StripeGateway implements Gateway {
  readonly stripe: Stripe;
  constructor(private config: Config) {
    this.stripe = new Stripe(config.key, { apiVersion: API_VERSION, timeout: 10000, maxNetworkRetries: 2 });
  }
  private check(livemode: boolean): void { assertMode(livemode, this.config.mode); }
  // IVA aparte (decisión 2026-09-21): Stripe Tax calcula el impuesto sobre precios sin IVA.
  private get stripeTax(): boolean { return this.config.taxPolicy === "stripe_tax"; }
  private taxOf(invoice: Stripe.Invoice): number {
    return (invoice.total_taxes || []).reduce((sum, tax) => sum + (tax.amount || 0), 0);
  }
  async createCustomer(user: User, idempotencyKey: string): Promise<string> {
    const customer = await this.stripe.customers.create({ email: user.email,
      metadata: { trainfitUserId: user.id, scope: "trainers" } }, { idempotencyKey });
    this.check(customer.livemode);
    return customer.id;
  }
  async validatePrice(price: PlanPrice): Promise<void> {
    const current = await this.stripe.prices.retrieve(price.id);
    this.check(current.livemode);
    if (!current.active || current.type !== "recurring" || current.currency !== "eur" ||
        current.unit_amount !== price.amount || current.recurring?.interval !== (price.interval === "annual" ? "year" : "month") ||
        current.recurring.interval_count !== 1 || current.recurring.usage_type !== "licensed" ||
        (this.stripeTax && current.tax_behavior !== "exclusive")) {
      throw new BillingError("PRICE_MISMATCH", "El precio configurado no coincide con el catálogo.", 503);
    }
  }
  async listSubscriptions(customerId: string): Promise<Subscription[]> {
    const list = await this.stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100,
      expand: ["data.latest_invoice", "data.test_clock"] });
    if (list.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "Contacta con soporte para revisar tu suscripción.");
    return Promise.all(list.data.map(async (sub): Promise<Subscription> => {
      this.check(sub.livemode);
      const testClock = sub.test_clock;
      if (testClock && (typeof testClock === "string" || testClock.status !== "ready")) {
        throw new BillingError("TEST_CLOCK_NOT_READY", "Espera a que termine de avanzar el reloj de pruebas.", 503);
      }
      if (testClock && typeof testClock !== "string") this.check(testClock.livemode);
      const item = sub.items.data[0];
      if (!item || sub.items.has_more || sub.items.data.length !== 1) {
        throw new BillingError("UNSUPPORTED_SUBSCRIPTION", "La suscripción requiere revisión de soporte.");
      }
      let invoice = sub.latest_invoice;
      if (typeof invoice === "string") invoice = await this.stripe.invoices.retrieve(invoice);
      if (invoice) this.check(invoice.livemode);
      const lines = invoice?.lines.has_more
        ? await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 }) : invoice?.lines;
      if (lines?.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
      const paidLine = lines?.data.find((line) => id(line.pricing?.price_details?.price) === item.price.id &&
        line.parent?.type === "subscription_item_details" && !line.parent.subscription_item_details?.proration &&
        line.parent.subscription_item_details?.subscription_item === item.id);
      return { id: sub.id, customerId: id(sub.customer) || "", status: sub.status, priceId: item.price.id,
        quantity: item.quantity || 0, currentPeriodEnd: item.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end, paid: invoice?.status === "paid",
        paidPriceId: id(paidLine?.pricing?.price_details?.price), paidPeriodEnd: paidLine?.period.end || 0,
        livemode: sub.livemode, userId: sub.metadata.trainfitUserId, scope: sub.metadata.scope,
        itemId: item.id, currentPeriodStart: item.current_period_start, scheduleId: id(sub.schedule),
        latestInvoiceId: id(invoice), latestInvoiceStatus: invoice?.status,
        latestInvoiceUrl: invoiceUrl(invoice?.hosted_invoice_url), latestInvoiceAmountDue: invoice?.amount_due,
        pendingUpdate: Boolean(sub.pending_update), pendingUpdateExpiresAt: sub.pending_update?.expires_at,
        collectionMethod: sub.collection_method,
        billingNow: testClock && typeof testClock !== "string" ? testClock.frozen_time : undefined,
        fingerprint: createHash("sha256").update(JSON.stringify({ id: sub.id, price: item.price.id,
          item: item.id, quantity: item.quantity, start: item.current_period_start, end: item.current_period_end,
          status: sub.status, cancel: sub.cancel_at_period_end, cancelAt: sub.cancel_at, schedule: id(sub.schedule),
          pending: sub.pending_update, invoice: id(invoice), invoiceStatus: invoice?.status,
          discounts: sub.discounts, itemDiscounts: item.discounts, tax: sub.default_tax_rates,
          itemTax: item.tax_rates, mode: sub.billing_mode, collection: sub.collection_method })).digest("hex") };
    }));
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
  async createCheckout(user: User, account: Account, price: PlanPrice, key: string): Promise<Session> {
    const metadata = { trainfitUserId: user.id, scope: "trainers", attempt: key, priceId: price.id };
    // Label remains stable for retries sharing the same Stripe idempotency key.
    const suffix = key.slice(-8).replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)));
    const session = await this.stripe.checkout.sessions.create({ mode: "subscription", customer: account.customerId,
      client_reference_id: user.id, metadata, subscription_data: { metadata },
      line_items: [{ price: price.id, quantity: 1 }], automatic_tax: { enabled: this.stripeTax },
      // Stripe Tax necesita la dirección de facturación; el NIF permite la inversión
      // del sujeto pasivo a empresas de la UE y figura en la factura.
      ...(this.stripeTax ? { billing_address_collection: "required" as const, tax_id_collection: { enabled: true },
        customer_update: { address: "auto" as const, name: "auto" as const } } : {}),
      allow_promotion_codes: true,
      success_url: `${this.config.frontendUrl}/tabs/subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.frontendUrl}/tabs/subscription?checkout=cancelled`,
      expires_at: Math.floor(account.checkout!.startedAt.getTime() / 1000) + 3600,
      integration_identifier: `trainfit_trainers_${suffix}`,
    }, { idempotencyKey: key });
    return sessionView(session, this.config.mode);
  }
  async createPortal(customerId: string): Promise<string> {
    if (!this.config.portalConfiguration) throw new BillingError("PORTAL_NOT_READY", "El portal de facturación todavía no está disponible.", 503);
    const configuration = await this.stripe.billingPortal.configurations.retrieve(this.config.portalConfiguration);
    this.check(configuration.livemode);
    const features = configuration.features;
    if (!configuration.active || features.subscription_update?.enabled || !features.invoice_history?.enabled ||
        !features.payment_method_update?.enabled || !features.subscription_cancel?.enabled ||
        features.subscription_cancel.mode !== "at_period_end") {
      throw new BillingError("PORTAL_NOT_READY", "El portal requiere una configuración compatible.", 503);
    }
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId,
      configuration: configuration.id, return_url: `${this.config.frontendUrl}/tabs/subscription?from=portal` });
    return session.url;
  }
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
  }
  async expireSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }
  async previewChange(sub: Subscription, price: PlanPrice, kind: ChangeQuote["kind"], prorationDate: number) {
    const current = this.config.plans.flatMap((plan) => Object.values(plan.prices)).find((entry) => entry.id === sub.priceId);
    const intervalChanges = current?.interval !== price.interval;
    // No invoice is generated today for an annual-to-monthly change. The amount
    // at the future renewal is an explicit tariff estimate; coupons and credit
    // balances may expire or change before that date.
    if (kind === "scheduled" && intervalChanges) return { amountDueNow: 0, renewalAmount: price.amount,
      renewalAt: sub.currentPeriodEnd, creditBalance: 0, renewalExcludesTax: this.stripeTax };
    // With a schedule attached (a change being replaced, or a completed schedule
    // still owning its last phase) Stripe previews the schedule's next phase and
    // ignores subscription_details.items for the renewal: verified in sandbox,
    // it returned the old scheduled price. The tariff is the honest estimate.
    if (kind === "scheduled" && sub.scheduleId) return { amountDueNow: 0, renewalAmount: price.amount,
      renewalAt: sub.currentPeriodEnd, creditBalance: 0, renewalExcludesTax: this.stripeTax };
    const details: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails = {
      items: [{ id: sub.itemId, price: price.id, quantity: 1 }],
      proration_behavior: kind === "immediate" ? "always_invoice" : "none",
      ...(kind === "immediate" ? { proration_date: prorationDate } : {}),
    };
    const tax = this.stripeTax ? { automatic_tax: { enabled: true } } : {};
    const invoice = await this.stripe.invoices.createPreview({ subscription: sub.id, subscription_details: details, ...tax });
    this.check(invoice.livemode);
    if (invoice.currency !== "eur" || invoice.lines.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    const targetLine = invoice.lines.data.find((line) => id(line.pricing?.price_details?.price) === price.id && line.amount >= 0);
    let renewalAmount = price.amount;
    if (!intervalChanges && !sub.scheduleId) {
      const renewal = kind === "scheduled" ? invoice : await this.stripe.invoices.createPreview({ subscription: sub.id,
        subscription_details: { items: details.items, proration_behavior: "none" }, ...tax });
      this.check(renewal.livemode);
      renewalAmount = Math.max(0, renewal.amount_due);
    }
    return { amountDueNow: kind === "immediate" ? Math.max(0, invoice.amount_due) : 0, renewalAmount,
      renewalAt: intervalChanges ? targetLine?.period.end : sub.currentPeriodEnd,
      creditBalance: kind === "immediate" ? Math.max(0, -(invoice.ending_balance || 0)) : 0,
      lines: kind === "immediate" ? this.quoteLines(invoice.lines.data) : [],
      taxAmount: kind === "immediate" ? this.taxOf(invoice) : 0,
      // Tras cambiar de periodicidad no hay previsualización de la renovación: la tarifa va sin IVA.
      renewalExcludesTax: this.stripeTax && intervalChanges };
  }
  // Desglose del cobro de hoy (crédito del plan actual y cargo del nuevo), como
  // el resumen de confirmación del portal. Importes de Stripe; etiquetas nuestras.
  private quoteLines(lines: Stripe.InvoiceLineItem[]): QuoteLine[] {
    const result: QuoteLine[] = [];
    for (const line of lines) {
      const priceId = id(line.pricing?.price_details?.price);
      const plan = this.config.plans.find((entry) => Object.values(entry.prices).some((price) => price.id === priceId));
      const price = plan && Object.values(plan.prices).find((entry) => entry.id === priceId);
      if (!plan || !price || line.parent?.type !== "subscription_item_details") continue;
      const proration = Boolean(line.parent.subscription_item_details?.proration);
      result.push({ kind: line.amount < 0 ? "credit" : proration ? "charge" : "recurring", tier: plan.tier,
        interval: price.interval, amount: line.amount, periodStart: new Date(line.period.start * 1000),
        periodEnd: new Date(line.period.end * 1000) });
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
      const line = invoice.lines.data.find((entry) => entry.parent?.type === "subscription_item_details");
      invoices.push({ id: invoice.id, number: invoice.number || null, status: invoice.status || "open",
        createdAt: new Date(invoice.created * 1000), total: invoice.total, amountPaid: invoice.amount_paid,
        amountDue: invoice.amount_due, currency: invoice.currency,
        reason: reason || "other",
        periodStart: line ? new Date(line.period.start * 1000) : null, periodEnd: line ? new Date(line.period.end * 1000) : null,
        hostedUrl: invoiceUrl(invoice.hosted_invoice_url), pdfUrl: pdfUrl(invoice.invoice_pdf) });
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
      if (!method || typeof method === "string" || method.type !== "card" || !method.card) return null;
      return { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year };
    } catch { return null; }
  }
  async upcomingRenewal(sub: Subscription): Promise<{ at: number; amount: number; priceId: string | null; subtotal: number } | null> {
    if (sub.cancelAtPeriodEnd || sub.pendingUpdate || !["active", "past_due"].includes(sub.status)) return null;
    const invoice = await this.stripe.invoices.createPreview({ subscription: sub.id,
      ...(this.stripeTax ? { automatic_tax: { enabled: true } } : {}) });
    this.check(invoice.livemode);
    if (invoice.currency !== "eur") throw new BillingError("BILLING_REVIEW_REQUIRED", "La factura requiere revisión de soporte.");
    const recurring = invoice.lines.data.find((line) => line.parent?.type === "subscription_item_details" &&
      !line.parent.subscription_item_details?.proration);
    if (!recurring) return null;
    // priceId dice qué plan se cobrará (incluida una fase programada); subtotal
    // antes de descuentos permite saber si el importe lleva descuento o saldo.
    return { at: recurring.period.start, amount: Math.max(0, invoice.amount_due),
      priceId: id(recurring.pricing?.price_details?.price), subtotal: invoice.subtotal };
  }
  async applyUpgrade(quote: ChangeQuote, key: string): Promise<{ invoiceId: string }> {
    const changed = await this.stripe.subscriptions.update(quote.subscriptionId, {
      items: [{ id: quote.itemId, price: quote.targetPriceId, quantity: 1 }],
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
    if (!current || created.phases.length !== 1 || id(current.items[0]?.price) !== quote.priceId) {
      throw new BillingError("BILLING_REVIEW_REQUIRED", "La programación requiere revisión de soporte.");
    }
    const first = copyPhase(current);
    first.end_date = quote.periodEnd;
    const next: Stripe.SubscriptionScheduleUpdateParams.Phase = { ...first, start_date: quote.periodEnd,
      end_date: undefined, duration: { interval: quote.to.interval === "annual" ? "year" : "month", interval_count: 1 },
      items: [{ ...first.items[0]!, price: quote.targetPriceId }], billing_cycle_anchor: "phase_start" };
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
    const debit = lines.data.find((line) => line.amount >= 0 && id(line.pricing?.price_details?.price) === quote.targetPriceId &&
      line.parent?.type === "subscription_item_details" && line.parent.subscription_item_details?.subscription_item === quote.itemId);
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
  verifyEvent(body: Buffer, signature: string): EventRecord | null {
    let event: Stripe.Event;
    try { event = this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret); }
    catch { throw new BillingError("INVALID_SIGNATURE", "Firma de webhook inválida.", 400); }
    this.check(event.livemode);
    const supported = new Set(["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed", "customer.subscription.created", "customer.subscription.updated",
      "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
      "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired",
      "subscription_schedule.updated", "subscription_schedule.released", "subscription_schedule.completed", "subscription_schedule.canceled",
      "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.finalization_failed",
      "charge.refunded", "charge.dispute.created"]);
    if (!supported.has(event.type)) return null;
    const object = event.data.object as unknown as { id?: string; customer?: string | { id: string } | null;
      payment_intent?: string | { id: string } | null; refunded?: boolean; charge?: string | { id: string } | null };
    const record: EventRecord = { eventId: event.id, type: event.type, customerId: id(object.customer),
      mode: this.config.mode, status: "pending", attempts: 0 };
    if (event.type === "charge.refunded") {
      record.detail = { chargeId: object.id, paymentIntentId: id(object.payment_intent), fullyRefunded: object.refunded === true };
    }
    // A Dispute carries no customer: the service resolves it through its payment.
    if (event.type === "charge.dispute.created") {
      record.detail = { disputeId: object.id, chargeId: id(object.charge) || undefined, paymentIntentId: id(object.payment_intent) };
    }
    return record;
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
