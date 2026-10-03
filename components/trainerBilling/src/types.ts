import type { Interval, Mode, PlanState, PriceKind, Tier } from "./catalog";

export type { Interval, Mode, PlanState, PriceKind, Tier };

export class BillingError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
    this.name = "BillingError";
  }
}

export interface Config {
  // Con STRIPE_KEY la facturación está activa; su prefijo decide el modo.
  enabled: boolean;
  mode: Mode;
  key: string;
  webhookSecret: string;
  // Web de Trainers: retorno de Checkout y del portal y enlaces de los avisos.
  returnUrl: string;
  // Condiciones de contratación: con URL, Checkout exige aceptarlas y la app las enlaza.
  termsUrl: string;
  // Buzón de facturación que se muestra al entrenador (la app, los avisos y Checkout).
  supportEmail: string;
  errors: string[];
}
// Precio de Stripe clasificado por sus metadatos (pieza, plan y periodicidad).
export interface PriceRef { id: string; kind: PriceKind; tier: Tier; interval: Interval; amount: number }
export interface User {
  id: string;
  email: string;
}
// Estado contratado con su capacidad e importe recurrente (sin IVA).
export interface StateView extends PlanState { seats: number; amount: number }
export interface Checkout {
  key: string; target: PlanState; startedAt: Date; sessionId?: string; url?: string | null;
}
export interface QuoteLine {
  kind: "credit" | "charge" | "recurring"; item: PriceKind; tier: Tier; interval: Interval; quantity: number;
  amount: number; periodStart: Date; periodEnd: Date;
}
// immediate: se cobra ahora y se aplica al pagar. scheduled: se aplica en la renovación.
export type ChangeKind = "immediate" | "scheduled";
export interface ChangeQuote {
  quoteId: string; expiresAt: Date; kind: ChangeKind;
  from: StateView; to: StateView; effectiveAt: Date; amountDueNow: number; currency: "eur";
  nextRenewal: { at: Date; amount: number; estimated?: boolean; excludesTax?: boolean };
  seats: { occupied: number; reserved: number };
  // Clientes que quedarían en solo lectura cuando se aplique (bajadas con más clientes que plazas).
  readOnlyAfter: number;
  // Condiciones vigentes que se aceptan al confirmar (null si no hay condiciones publicadas).
  termsUrl: string | null;
  creditBalance?: number;
  taxAmount?: number;
  lines?: QuoteLine[];
  subscriptionId: string; snapshot: string; prorationDate: number; periodEnd: number;
  previousScheduleId?: string;
  // Calculados al proponer y reutilizados al aplicar: los reintentos envían lo mismo a Stripe
  // con la misma clave de idempotencia. fromItems/targetItems: elementos con cantidad > 0.
  updates: ItemUpdate[]; fromItems: PhaseItem[]; targetItems: PhaseItem[];
}
// Cambio de un elemento de la suscripción (sin id: elemento nuevo).
export interface ItemUpdate { id?: string; price?: string; quantity?: number; deleted?: boolean }
export interface PhaseItem { price: string; quantity: number }
export interface ChangeOperation {
  quote: ChangeQuote; startedAt: Date;
  // reverted: subida deshecha (reembolso o disputa perdida); vuelve el estado anterior sin prorrateo.
  status: "processing" | "payment_pending" | "scheduled" | "applied" | "discarded" | "reverted";
  invoiceId?: string; scheduleId?: string;
}
export interface ControlOperation {
  id: string; kind: "cancel" | "resume" | "discard"; startedAt: Date; done?: boolean;
  invoiceId?: string; scheduleId?: string;
}
export interface PaymentState { url?: string; expiresAt?: Date }
// Next recurring charge as Stripe itself computes it (coupons, credit balance
// and any scheduled phase included). Cached against the subscription fingerprint.
export interface RenewalState { at: Date; amount: number; fingerprint: string; state?: PlanState | null; subtotal?: number }
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
  // Último estado pagado (plan, periodicidad y plazas adicionales).
  tier?: Tier | null;
  interval?: Interval | null;
  extraSeats?: number | null;
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
  // Cobros en pausa por una disputa o por decisión de un administrador.
  hold?: BillingHold | null;
  // Ajustes de acceso registrados (retirada de un periodo, excepción hasta una fecha).
  adjustments?: AccessAdjustment[] | null;
  reminders?: RenewalReminders | null;
  // Última aceptación de las condiciones y el historial de todas (la URL identifica la versión).
  termsAcceptance?: TermsAcceptance | null;
  termsHistory?: TermsAcceptance[] | null;
}
// Qué compró un pago, deducido de las líneas de su factura (financing.ts).
// upgrade: más capacidad a mitad de periodo (plan superior o más plazas), con el estado anterior.
export type FinancedKind = "period" | "upgrade" | "interval_change" | "unknown";
export interface Financed {
  kind: FinancedKind; invoiceId: string | null; subscriptionId: string | null; customerId: string | null;
  // Estado financiado; en subidas y cambios de periodicidad, el de destino.
  state: PlanState | null;
  // Estado anterior abonado en la misma factura (subidas y cambios de periodicidad).
  fromState: PlanState | null;
  periodStart: number; periodEnd: number; amountPaid: number; currency: string;
}
// Relación del pago con el acceso de hoy.
export type FundingRole = "current_period" | "current_upgrade" | "past" | "unknown";
export interface RefundView {
  id: string; amount: number; status: string; reason: string | null; failureReason: string | null; createdAt: Date;
}
// Factura de un cobro con sus líneas de suscripción, para saber qué financiaba (financing.ts).
export interface FinancingLine {
  amount: number; price: PriceRef | null; quantity: number; proration: boolean;
  subscriptionItem: string | null; periodStart: number; periodEnd: number;
}
export interface FinancingInvoice {
  id: string; subscriptionId: string | null; customerId: string | null; billingReason: string | null;
  amountPaid: number; currency: string; lines: FinancingLine[];
}
export interface PaymentContext {
  chargeId: string | null; paymentIntentId: string | null; customerId: string | null;
  amount: number; amountRefunded: number; refunded: boolean; currency: string;
  refunds: RefundView[];
  // null si el cobro no corresponde a una factura legible (o tiene demasiadas líneas).
  invoice: FinancingInvoice | null;
}
export interface DisputeView {
  id: string; status: string; amount: number; currency: string; reason: string | null;
  chargeId: string | null; paymentIntentId: string | null; dueBy: Date | null; createdAt: Date;
}
export interface FraudWarningView {
  id: string; chargeId: string | null; paymentIntentId: string | null; fraudType: string | null; actionable: boolean; createdAt: Date;
}
export interface Actor { id: string; email: string | null }
export type AdminAction = "resolve_case" | "end_service_now" | "cancel_renewal" | "resume_renewal" | "revert_upgrade" |
  "grant_access" | "end_grant" | "restore_period_access" | "pause_collection" | "resume_collection";
export type CaseKind = "refund" | "dispute" | "early_fraud_warning";
export type CaseSuggestion = "decide_end_or_keep" | "revert_upgrade" | "keep_access" | "check_failed_refund" |
  "respond_dispute" | "decide_collection" | "review_fraud_warning" | "manual_review";
export interface CaseResolution { action: AdminAction; reason: string; note: string | null; by: Actor; at: Date; interventionId: string }
// Incidencia de dinero que exige una decisión humana: reembolso, disputa o aviso de fraude.
export interface BillingCase {
  caseId: string; userId: string; mode: Mode; kind: CaseKind; status: "open" | "resolved"; priority: "high" | "normal";
  chargeId: string | null; paymentIntentId: string | null; financed: Financed | null; role: FundingRole;
  amount: number; currency: string;
  fullyRefunded?: boolean; refunds?: RefundView[];
  disputeId?: string | null; disputeStatus?: string | null; disputeReason?: string | null; dueBy?: Date | null;
  warningId?: string | null; fraudType?: string | null;
  // Efectos automáticos ya aplicados (idempotencia): collection_paused, rights_withdrawn:period…
  effects: string[]; suggestion: CaseSuggestion; notes: string[];
  openedAt: Date; updatedAt?: Date; resolution?: CaseResolution | null;
}
// Capa de acceso sobre lo que dice Stripe. Nunca finge un cobro: queda registrada y se puede retirar.
export interface AccessAdjustment {
  id: string; kind: "revoke_period" | "grant";
  from: Date | null; until: Date | null; tier: Tier | null; interval: Interval | null;
  invoiceId: string | null; reason: string; source: "admin" | "dispute_lost";
  caseId: string | null; interventionId: string | null; createdAt: Date; liftedAt: Date | null;
}
// Espejo de pause_collection de la suscripción en Stripe, con su contexto (casos y reintentos pausados).
export interface BillingHold {
  kind: "dispute" | "admin"; since: Date; caseIds: string[]; pausedInvoiceIds: string[]; subscriptionId: string;
}
export interface RenewalReminders { periodEnd: Date; sent30At: Date | null; sent7At: Date | null }
// via checkout: al contratar (Stripe guarda la casilla en la sesión); via change: al confirmar un cambio
// en la app. ref: la sesión de Checkout o la propuesta aceptada. Publicar cada versión de las
// condiciones en su propia URL permite saber qué texto aceptó cada entrenador.
export interface TermsAcceptance { at: Date; via: "checkout" | "change"; ref: string; termsUrl: string | null }
export interface AccessSnapshot {
  status: string; tier: Tier | null; interval: Interval | null; extraSeats: number; seats: number;
  paidUntil: Date | null; cancelAtPeriodEnd: boolean;
  entitled: boolean; expiresAt: Date | null; collectionPaused: boolean;
}
// Registro de una intervención administrativa (solo se añade; nunca se edita salvo su resultado).
export interface Intervention {
  interventionId: string; userId: string; mode: Mode; action: AdminAction; reason: string; note: string | null;
  caseId: string | null; by: Actor; at: Date; status: "pending" | "applied" | "failed"; error: string | null;
  before: AccessSnapshot | null; after: AccessSnapshot | null; params: Record<string, unknown>;
}
export interface RenewalReminderInput {
  email: string; stage: 30 | 7; at: Date; amount: number | null; tier: Tier; seats: number;
  manageUrl: string; supportEmail: string | null;
}
export interface Notifier { renewalReminder(input: RenewalReminderInput): Promise<void> }
// Lo que se proyecta en User.professionalPremium: de aquí leen el cupo de clientes y la biblioteca.
export interface Projection {
  entitled: boolean; tier: Tier | null; interval: Interval | null; seats: number;
  expiresAt: Date | null; lastSyncAt: Date; stripeRevision: number; stripeMode: Mode;
}
export interface Session {
  id: string; customerId: string | null; subscriptionId: string | null;
  status: string | null; url: string | null; userId?: string; attempt?: string;
  target?: string; scope?: string; livemode: boolean;
  // El comprador marcó la aceptación de las condiciones en Checkout.
  termsAccepted?: boolean;
}
export interface SubscriptionItemView { id: string; price: PriceRef; quantity: number }
export interface Subscription {
  id: string; customerId: string; status: string;
  // Estado que describen los elementos (null si no encaja en el catálogo: revisión de soporte).
  state: PlanState | null;
  // Elementos de la suscripción; los de cantidad 0 no cuentan para el estado.
  items: SubscriptionItemView[];
  currentPeriodEnd: number; cancelAtPeriodEnd: boolean;
  // La última factura está pagada y cubre los elementos actuales hasta paidPeriodEnd.
  paid: boolean; paidPeriodEnd: number;
  livemode: boolean; userId?: string; scope?: string;
  currentPeriodStart?: number; scheduleId?: string | null;
  latestInvoiceId?: string | null; latestInvoiceStatus?: string | null;
  latestInvoiceUrl?: string; latestInvoiceAmountDue?: number;
  pendingUpdate?: boolean; pendingUpdateExpiresAt?: number;
  collectionMethod?: string; fingerprint?: string;
  billingNow?: number;
  // pause_collection activo en Stripe (disputa o decisión administrativa).
  collectionPaused?: boolean;
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
  // Devuelto al entrenador (reembolsos registrados) y abonado con notas de crédito de Stripe.
  refundedAmount?: number; creditedAmount?: number;
}
// kind "link": pago guardado con Link (sin marca ni últimos 4); wallet: Apple Pay / Google Pay sobre tarjeta.
export interface PaymentMethodView {
  brand: string; last4: string; expMonth: number; expYear: number; kind?: "card" | "link"; wallet?: string | null;
}
export interface BillingDetails { invoices: InvoiceView[]; paymentMethod: PaymentMethodView | null }
export interface EventRecord {
  eventId: string; type: string; customerId: string | null; mode: Mode;
  status: "pending" | "processed" | "failed"; attempts: number;
  // Solo identificadores para releer Stripe (reembolsos, disputas, avisos de fraude, Checkout): sin datos de tarjeta.
  detail?: {
    chargeId?: string; paymentIntentId?: string | null; fullyRefunded?: boolean; disputeId?: string;
    refundId?: string; warningId?: string; sessionId?: string;
  } | null;
}
export interface ChangePreview {
  amountDueNow: number; renewalAmount: number; renewalAt?: number; creditBalance?: number;
  lines?: QuoteLine[]; taxAmount?: number; renewalExcludesTax?: boolean;
}
export interface Gateway {
  createCustomer(user: User, idempotencyKey: string): Promise<string>;
  // Comprueba que Stripe tiene a la venta las piezas del estado con los importes del catálogo.
  validateState(state: PlanState): Promise<void>;
  listSubscriptions(customerId: string): Promise<Subscription[]>;
  listSessions(customerId: string): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  createCheckout(user: User, account: Account, target: PlanState, key: string): Promise<Session>;
  createPortal(customerId: string): Promise<string>;
  cancelSubscription(id: string): Promise<void>;
  expireSession(id: string): Promise<void>;
  previewChange(sub: Subscription, target: PlanState, kind: ChangeKind, prorationDate: number): Promise<ChangePreview>;
  // Cambios de elementos para llegar al estado pedido, y los elementos (cantidad > 0) de origen y destino.
  changeItems(sub: Subscription, target: PlanState): Promise<{ updates: ItemUpdate[]; fromItems: PhaseItem[]; targetItems: PhaseItem[] }>;
  upcomingRenewal?(sub: Subscription): Promise<{ at: number; amount: number; state: PlanState | null; subtotal: number } | null>;
  billingDetails?(customerId: string, subscriptionId: string | null): Promise<BillingDetails>;
  applyUpgrade(quote: ChangeQuote, key: string): Promise<{ invoiceId: string }>;
  scheduleChange(quote: ChangeQuote, key: string): Promise<{ scheduleId: string }>;
  changePayment(account: Account, operation: ChangeOperation): Promise<ChangePayment>;
  releaseSchedule(id: string, key: string): Promise<void>;
  voidInvoice(id: string, key: string): Promise<void>;
  setCancellation(id: string, cancel: boolean, key: string): Promise<void>;
  // Factura de suscripción cobrada con ese PaymentIntent (para reembolsos).
  invoiceForPayment?(paymentIntentId: string): Promise<{ invoiceId: string; subscriptionId: string | null; customerId: string | null } | null>;
  // Cargo, reembolsos y qué financiaba el pago (releído de Stripe, nunca del payload).
  paymentContext?(ref: { chargeId?: string | null; paymentIntentId?: string | null }): Promise<PaymentContext | null>;
  getDispute?(id: string): Promise<DisputeView>;
  getFraudWarning?(id: string): Promise<FraudWarningView>;
  // Pausa los cobros (borradores) y los reintentos de facturas abiertas; devuelve las que pausó.
  pauseCollection?(subscriptionId: string, key: string): Promise<{ pausedInvoiceIds: string[] }>;
  resumeCollection?(subscriptionId: string, pausedInvoiceIds: string[], key: string, now: number): Promise<void>;
  // Vuelve a un estado anterior sin prorrateo ni factura (deshacer una subida).
  revertState?(sub: Subscription, state: PlanState, key: string): Promise<void>;
  // Eventos de dinero recientes, para recuperar webhooks perdidos.
  recentEvents?(types: string[], since: number): Promise<EventRecord[]>;
}
export interface SeatUsage { occupied: number; reserved: number }
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
  seatUsage(userId: string): Promise<SeatUsage>;
  getCase?(caseId: string): Promise<BillingCase | null>;
  saveCase?(entry: BillingCase): Promise<void>;
  listCases?(filter: { userId?: string; status?: "open" | "resolved"; limit: number }): Promise<BillingCase[]>;
  saveIntervention?(entry: Intervention): Promise<void>;
  updateIntervention?(interventionId: string, patch: Partial<Intervention>): Promise<void>;
  listInterventions?(userId: string, limit: number): Promise<Intervention[]>;
}
