// Contratos del dominio de cobros entre entrenador y cliente (dinero externo:
// Bizum, transferencia, efectivo...). Nada de aquí mueve dinero ni toca
// trainerBilling, que es lo que el ENTRENADOR paga a TrainFit.

export type CivilDay = string; // "YYYY-MM-DD", día civil completo
export type TimeOfDay = string; // "HH:mm"

export type ChargeOrigin = "one_off" | "recurring";
export type ChargeStatus = "open" | "settled" | "cancelled" | "void";
export type PaymentMethod = "bizum" | "transfer" | "cash" | "card_external" | "other" | "unknown";
export type MovementStatus = "valid" | "voided";
// "migration": pago creado al convertir un cobro anterior al libro de pagos.
export type MovementSource = "app" | "migration";
// "marked_paid": cobro anterior al libro de pagos; el día es cuándo se MARCÓ pagado,
// no necesariamente cuándo llegó el dinero.
export type ReceivedDaySource = "entered" | "marked_paid";
export type TemporalState = "overdue" | "due_today" | "upcoming" | "closed";
export type Recipient = "trainer" | "client";
export type RecurrenceUnit = "week" | "month";
export type PlanStatus = "active" | "paused" | "ended";
export type VoidReason = "plan_paused" | "plan_ended" | "plan_rescheduled" | "relation_ended";

export class PaymentsError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PaymentsError";
  }
}

export interface Movement {
  id: string;
  amountCents: number;
  receivedDay: CivilDay;
  receivedDaySource: ReceivedDaySource;
  method: PaymentMethod;
  note: string | null;
  // Cuándo y quién lo anotó. null solo en movimientos derivados de datos
  // antiguos, donde ese dato nunca existió (no se inventa).
  recordedAt: Date | null;
  recordedBy: string | null;
  source: MovementSource;
  operationId: string;
  payloadHash: string | null;
  status: MovementStatus;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  correctionOf: string | null;
}

export type AdjustmentType =
  | "amount_changed"
  | "due_changed"
  | "concept_changed"
  | "note_changed"
  | "price_change"
  | "cancel_balance"
  | "restore_balance"
  | "payment_corrected"
  | "voided";
export type AdjustmentValue = string | number | null;

export interface Adjustment {
  id: string;
  type: AdjustmentType;
  at: Date;
  by: string | null;
  reason: string | null;
  from: AdjustmentValue;
  to: AdjustmentValue;
  operationId: string | null;
}

export interface OperationRecord {
  operationId: string;
  kind: string;
  payloadHash: string;
  at: Date;
}

export interface ReminderLogEntry {
  key: string;
  recipient: Recipient;
  dueRevision: number;
  offset: number;
  state: "sent" | "skipped";
  at: Date;
}

// Un cobro (obligación) tal como lo maneja el núcleo.
export interface Charge {
  id: string;
  trainerId: string;
  clientId: string;
  origin: ChargeOrigin;
  concept: string | null; // público: puede llegar al cliente en un aviso
  note: string | null; // privada del entrenador, nunca sale hacia el cliente
  currency: string;
  dueDay: CivilDay;
  amountCents: number; // importe vigente de la obligación
  originalAmountCents: number;
  receivedCents: number; // agregado de pagos válidos, se escribe junto a ellos
  cancelledCents: number; // saldo anulado (no es dinero recibido)
  status: ChargeStatus;
  settledAt: Date | null;
  cancelledAt: Date | null;
  voidedAt: Date | null;
  voidReason: VoidReason | null;
  historical: boolean; // cobro puntual con vencimiento pasado (deuda anterior)
  manualOverride: boolean; // recurrente editado a mano: el cambio de precio no lo pisa
  planOccurrenceKey: string | null;
  planSegment: number | null;
  payments: Movement[];
  adjustments: Adjustment[];
  operations: OperationRecord[];
  revision: number;
  dueRevision: number;
  remindersFrom: Date; // ningún hito anterior a este instante se envía
  reminderLog: ReminderLogEntry[];
  createdAt: Date;
  // Datos que el entrenador debe revisar (cobros convertidos con importe o
  // fecha dudosos). Nunca se escriben desde la app.
  anomalies: string[];
}

// Documento tal y como llega de Mongo (ids ya como string).
export interface ChargeRecord {
  id: string;
  trainerId: string;
  clientId: string;
  currency?: string | null;
  note?: string | null;
  createdAt?: Date | null;
  origin?: ChargeOrigin | null;
  concept?: string | null;
  dueDay?: string | null;
  amountCents?: number | null;
  originalAmountCents?: number | null;
  receivedCents?: number | null;
  cancelledCents?: number | null;
  status?: ChargeStatus | null;
  settledAt?: Date | null;
  cancelledAt?: Date | null;
  voidedAt?: Date | null;
  voidReason?: VoidReason | null;
  historical?: boolean | null;
  manualOverride?: boolean | null;
  planOccurrenceKey?: string | null;
  planSegment?: number | null;
  payments?: Movement[] | null;
  adjustments?: Adjustment[] | null;
  operations?: OperationRecord[] | null;
  revision?: number | null;
  dueRevision?: number | null;
  remindersFrom?: Date | null;
  reminderLog?: ReminderLogEntry[] | null;
  anomalies?: string[] | null;
}

// Contexto de toda operación: el reloj y la zona se inyectan, nunca se leen
// dentro del dominio (tests deterministas, mismo "hoy" en avisos, ficha y global).
export interface OpContext {
  now: Date;
  today: CivilDay; // hoy en la zona del entrenador
  actorId: string | null;
}

export interface ReminderSettings {
  timeZone: string;
  time: TimeOfDay;
  offsets: number[]; // días respecto al vencimiento: -3 = tres días antes
}

export interface PriceEntry {
  fromDay: CivilDay;
  amountCents: number;
  at: Date;
  by: string | null;
}

export type PlanAction =
  | "created"
  | "reactivated"
  | "price_changed"
  | "concept_changed"
  | "rescheduled"
  | "paused"
  | "resumed"
  | "ended";

export interface PlanHistoryEntry {
  at: Date;
  by: string | null;
  action: PlanAction;
  details: Record<string, string | number | boolean | null>;
}

export interface FeePlan {
  status: PlanStatus;
  concept: string;
  currency: "EUR";
  unit: RecurrenceUnit;
  interval: number;
  anchorDay: CivilDay; // primer vencimiento del segmento vigente
  segment: number; // sube al reanudar o recalendarizar: claves nuevas, sin duplicar
  prices: PriceEntry[];
  // Cursor de materialización del segmento vigente (optimización: la unicidad
  // real la garantiza el índice de la clave de ocurrencia).
  materializedThrough: CivilDay | null;
  startedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  endReason: "trainer" | "relation_ended" | null;
  history: PlanHistoryEntry[];
}

export interface ClientReminderPref {
  enabled: boolean;
  enabledAt: Date | null;
  disabledAt: Date | null;
  disabledReason: "trainer" | "relation_ended" | null;
}

// Una por pareja entrenador–cliente, sea cual sea el número de scopes.
export interface PaymentProfile {
  id: string;
  trainerId: string;
  clientId: string;
  plan: FeePlan | null;
  clientReminders: ClientReminderPref;
  reminderOffsets: number[] | null; // null = hereda los del entrenador
  operations: OperationRecord[];
  revision: number;
}
