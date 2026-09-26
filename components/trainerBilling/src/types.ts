export type Tier = "trainer_pro" | "trainer_growth" | "trainer_scale";
export type Interval = "monthly" | "annual";
export type Mode = "test" | "live";
// test_no_tax solo existe en el sandbox; en producción se cobra con Stripe Tax (IVA aparte).
export type TaxPolicy = "test_no_tax" | "stripe_tax" | "pending";

export class BillingError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
    this.name = "BillingError";
  }
}

export interface PlanPrice { id: string; amount: number; interval: Interval }
export interface Plan { tier: Tier; clientLimit: number; prices: Record<Interval, PlanPrice> }
export interface Config {
  enabled: boolean;
  mode: Mode;
  key: string;
  webhookSecret: string;
  frontendUrl: string;
  portalConfiguration: string;
  taxPolicy: TaxPolicy;
  errors: string[];
  plans: Plan[];
}
export interface User {
  id: string;
  email: string;
  professionalPremium?: {
    entitled?: boolean; expiresAt?: Date | string | null; source?: string | null;
  };
}
export interface Checkout {
  key: string; priceId: string; startedAt: Date; sessionId?: string; url?: string | null;
}
export interface PriceView { tier: Tier; interval: Interval; amount: number; clientLimit: number }
export interface ChangeQuote {
  quoteId: string; expiresAt: Date; kind: "immediate" | "scheduled";
  from: PriceView; to: PriceView; effectiveAt: Date; amountDueNow: number; currency: "eur";
  nextRenewal: { at: Date; amount: number; estimated?: boolean; excludesTax?: boolean }; usage: { clients: number; limit: number };
  creditBalance?: number;
  // IVA incluido en amountDueNow (Stripe Tax); 0 en el sandbox sin impuestos.
  taxAmount?: number;
  lines?: QuoteLine[];
  subscriptionId: string; itemId: string; priceId: string; targetPriceId: string;
  snapshot: string; prorationDate: number; periodEnd: number;
  previousScheduleId?: string;
}
export interface ChangeOperation {
  quote: ChangeQuote; startedAt: Date;
  status: "processing" | "payment_pending" | "scheduled" | "applied" | "discarded";
  invoiceId?: string; scheduleId?: string;
}
export interface ControlOperation {
  id: string; kind: "cancel" | "resume" | "discard"; startedAt: Date; done?: boolean;
  invoiceId?: string; scheduleId?: string;
}
export interface PaymentState { url?: string; expiresAt?: Date }
// Next recurring charge as Stripe itself computes it (coupons, credit balance
// and any scheduled phase included). Cached against the subscription fingerprint.
export interface RenewalState { at: Date; amount: number; fingerprint: string; priceId?: string | null; subtotal?: number }
// Open renewal invoice while Stripe retries a failed recurring payment.
export interface RenewalPaymentState { url?: string; amount: number; invoiceId: string }
export interface Account {
  userId: string;
  mode: Mode;
  customerId?: string;
  customerStartedAt?: Date;
  checkout?: Checkout | null;
  subscriptionId?: string | null;
  status: string;
  tier?: Tier | null;
  interval?: Interval | null;
  paidUntil?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  revision: number;
  deletedAt?: Date | null;
  updatedAt?: Date;
  provider?: Subscription;
  quote?: ChangeQuote | null;
  change?: ChangeOperation | null;
  control?: ControlOperation | null;
  pendingPayment?: PaymentState | null;
  renewal?: RenewalState | null;
  renewalPayment?: RenewalPaymentState | null;
  // Contracargo o reembolso parcial: no cambia el acceso, pide revisión humana.
  review?: ReviewFlag | null;
}
export interface ReviewFlag { reason: "dispute" | "refund"; at: Date; reference: string }
export interface Projection {
  entitled: boolean; source: "stripe"; tier: Tier | null; plan: Interval | null;
  expiresAt: Date | null; lastSyncAt: Date; stripeRevision: number; stripeMode: Mode;
}
export interface Session {
  id: string; customerId: string | null; subscriptionId: string | null;
  status: string | null; url: string | null; userId?: string; attempt?: string;
  priceId?: string; scope?: string; livemode: boolean;
}
export interface Subscription {
  id: string; customerId: string; status: string; priceId: string;
  quantity: number; currentPeriodEnd: number; cancelAtPeriodEnd: boolean;
  paid: boolean; paidPriceId: string | null; paidPeriodEnd: number;
  livemode: boolean; userId?: string; scope?: string;
  itemId?: string; currentPeriodStart?: number; scheduleId?: string | null;
  latestInvoiceId?: string | null; latestInvoiceStatus?: string | null;
  latestInvoiceUrl?: string; latestInvoiceAmountDue?: number;
  pendingUpdate?: boolean; pendingUpdateExpiresAt?: number;
  collectionMethod?: string; fingerprint?: string;
  billingNow?: number;
}
export interface ChangePayment {
  paid: boolean; voided: boolean; periodEnd: number; url?: string;
}
export interface InvoiceView {
  id: string; number: string | null; status: string; createdAt: Date;
  total: number; amountPaid: number; amountDue: number; currency: string;
  reason: "subscription_create" | "subscription_cycle" | "subscription_update" | "other";
  periodStart: Date | null; periodEnd: Date | null;
  hostedUrl?: string; pdfUrl?: string;
}
export interface PaymentMethodView { brand: string; last4: string; expMonth: number; expYear: number }
export interface BillingDetails { invoices: InvoiceView[]; paymentMethod: PaymentMethodView | null }
// Proration lines of a change preview, labelled by us (Stripe's descriptions are English).
export interface QuoteLine { kind: "credit" | "charge" | "recurring"; tier: Tier; interval: Interval; amount: number; periodStart: Date; periodEnd: Date }
export interface EventRecord {
  eventId: string; type: string; customerId: string | null; mode: Mode;
  status: "pending" | "processed" | "failed"; attempts: number;
  // Solo lo imprescindible de charge.refunded / charge.dispute.*: sin datos de tarjeta.
  detail?: { chargeId?: string; paymentIntentId?: string | null; fullyRefunded?: boolean; disputeId?: string } | null;
}
export interface Gateway {
  createCustomer(user: User, idempotencyKey: string): Promise<string>;
  validatePrice(price: PlanPrice): Promise<void>;
  listSubscriptions(customerId: string): Promise<Subscription[]>;
  listSessions(customerId: string): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  createCheckout(user: User, account: Account, price: PlanPrice, key: string): Promise<Session>;
  createPortal(customerId: string): Promise<string>;
  cancelSubscription(id: string): Promise<void>;
  expireSession(id: string): Promise<void>;
  previewChange(sub: Subscription, price: PlanPrice, kind: ChangeQuote["kind"], prorationDate: number): Promise<{ amountDueNow: number; renewalAmount: number; renewalAt?: number; creditBalance?: number; lines?: QuoteLine[]; taxAmount?: number; renewalExcludesTax?: boolean }>;
  upcomingRenewal?(sub: Subscription): Promise<{ at: number; amount: number; priceId: string | null; subtotal: number } | null>;
  billingDetails?(customerId: string, subscriptionId: string | null): Promise<BillingDetails>;
  applyUpgrade(quote: ChangeQuote, key: string): Promise<{ invoiceId: string }>;
  scheduleChange(quote: ChangeQuote, key: string): Promise<{ scheduleId: string }>;
  changePayment(account: Account, operation: ChangeOperation): Promise<ChangePayment>;
  releaseSchedule(id: string, key: string): Promise<void>;
  voidInvoice(id: string, key: string): Promise<void>;
  setCancellation(id: string, cancel: boolean, key: string): Promise<void>;
  // Factura de suscripción cobrada con ese PaymentIntent (para reembolsos).
  invoiceForPayment?(paymentIntentId: string): Promise<{ invoiceId: string; subscriptionId: string | null; customerId: string | null } | null>;
}
export interface Repository {
  get(userId: string): Promise<Account | null>;
  findCustomer(customerId: string): Promise<Account | null>;
  withLock<T>(userId: string, action: (account: Account, save: () => Promise<void>) => Promise<T>): Promise<T>;
  project(account: Account, projection: Projection): Promise<void>;
  getUser(userId: string): Promise<User | null>;
  saveEvent(record: EventRecord): Promise<EventRecord>;
  completeEvent(id: string): Promise<void>;
  failEvent(id: string): Promise<void>;
  pendingEvents(limit: number): Promise<EventRecord[]>;
  accountsForReconciliation(limit: number): Promise<Account[]>;
  clientUsage(userId: string): Promise<number>;
}
