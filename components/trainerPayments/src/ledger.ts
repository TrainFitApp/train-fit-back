import {
  Adjustment,
  AdjustmentType,
  AdjustmentValue,
  Charge,
  ChargeRecord,
  ChargeStatus,
  CivilDay,
  LegacyDueDaySource,
  Movement,
  MovementSource,
  OpContext,
  OperationRecord,
  PaymentMethod,
  PaymentsError,
  ReceivedDaySource,
  TemporalState,
  VoidReason,
} from "./types";
import { DEFAULT_TIME_ZONE, civilDayInZone, instantForZonedTime, isCivilDay, parseCivilDay } from "./calendar";
import { MAX_AMOUNT_CENTS, cleanText, legacyAmountToCents, parseAmountToCents, parseOperationId, payloadHash } from "./money";

// PURO — el libro de un cobro. Toda operación recibe el cobro normalizado y
// devuelve el cobro siguiente; la capa de datos lo escribe con compare-and-swap
// sobre `revision`, así que dos pagos simultáneos nunca pueden superar el saldo.
//
// saldo = importe vigente - pagos válidos - saldo anulado
// `receivedCents` y `cancelledCents` se guardan junto a los movimientos en el
// MISMO documento y en la MISMA escritura: no son autoridades independientes
// (verifyCharge comprueba la equivalencia).

// Los cobros antiguos se crearon desde la app en España: su día civil se
// interpreta siempre en esta zona, aunque el entrenador cambie la suya después.
export const LEGACY_TIME_ZONE = DEFAULT_TIME_ZONE;
export const ENTERED_METHODS: ReadonlyArray<PaymentMethod> = ["bizum", "transfer", "cash", "card_external", "other"];
export const CONCEPT_MAX = 80;
export const NOTE_MAX = 500;
export const REASON_MAX = 300;

export type OpContextWithIds = OpContext & { newId: () => string };

export function balanceOf(charge: Pick<Charge, "amountCents" | "receivedCents" | "cancelledCents">): number {
  return charge.amountCents - charge.receivedCents - charge.cancelledCents;
}

export function deriveStatus(amountCents: number, receivedCents: number, cancelledCents: number): Exclude<ChargeStatus, "void"> {
  if (amountCents - receivedCents - cancelledCents > 0) return "open";
  return cancelledCents > 0 ? "cancelled" : "settled";
}

export function validMovements(charge: Pick<Charge, "payments">): Movement[] {
  return charge.payments.filter((movement) => movement.status === "valid");
}

// Previsión = cuota recurrente futura, materializada solo por anticipación
// técnica y sin dinero. No es deuda consolidada: no suma en "pendiente".
export function isForecast(charge: Charge, today: CivilDay): boolean {
  return (
    charge.origin === "recurring" &&
    charge.status === "open" &&
    charge.dueDay > today &&
    charge.receivedCents === 0 &&
    charge.cancelledCents === 0
  );
}

// Temporalidad y estado de pago son ejes distintos: un cobro puede ser
// parcial Y vencido. Vencido = su día ya terminó en la zona del entrenador.
export function temporalState(charge: Charge, today: CivilDay): TemporalState {
  if (charge.status !== "open") return "closed";
  if (charge.dueDay < today) return "overdue";
  if (charge.dueDay === today) return "due_today";
  return "upcoming";
}

export function isOverdue(charge: Charge, today: CivilDay): boolean {
  return temporalState(charge, today) === "overdue" && balanceOf(charge) > 0;
}

// dueDate de compatibilidad: mediodía UTC del día civil. Las apps antiguas lo
// pintan con `| date` o `new Date()` y así sale el mismo día en casi cualquier zona.
export function compatDueDate(day: CivilDay): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// --- Lectura de cobros antiguos ---------------------------------------------

export interface LegacyDueDay {
  day: CivilDay;
  source: LegacyDueDaySource;
  ambiguous: boolean;
  invalid: boolean;
}

// El formulario antiguo mandaba "YYYY-MM-DD" (medianoche UTC) y los seeds
// usan horas sueltas: no vale `toISOString().slice(0, 10)` a ciegas. Se
// admite medianoche UTC o medianoche local; cualquier otra hora se resuelve
// en la zona legacy y se marca ambigua si el día UTC y el local difieren.
export function legacyDueDay(dueDate: unknown, createdAt: unknown, timeZone = LEGACY_TIME_ZONE): LegacyDueDay {
  if (!validDate(dueDate)) {
    const fallback = validDate(createdAt) ? civilDayInZone(createdAt, timeZone) : "1970-01-01";
    return { day: fallback, source: "created_at_fallback", ambiguous: true, invalid: true };
  }
  const utcDay = dueDate.toISOString().slice(0, 10);
  if (dueDate.getTime() === new Date(`${utcDay}T00:00:00.000Z`).getTime()) {
    return { day: utcDay, source: "utc_midnight", ambiguous: false, invalid: false };
  }
  const zoneDay = civilDayInZone(dueDate, timeZone);
  if (instantForZonedTime(zoneDay, "00:00", timeZone).getTime() === dueDate.getTime()) {
    return { day: zoneDay, source: "zone_midnight", ambiguous: false, invalid: false };
  }
  return { day: zoneDay, source: "zone_date", ambiguous: zoneDay !== utcDay, invalid: false };
}

export function legacyPaymentOperationId(chargeId: string): string {
  return `legacy-paid:${chargeId}`;
}

function normalizeLegacy(record: ChargeRecord): Charge {
  const anomalies: string[] = [];
  const { cents, anomaly } = legacyAmountToCents(record.amount);
  if (anomaly) anomalies.push(anomaly);
  const currency = (record.currency || "EUR").toUpperCase();
  if (currency !== "EUR") anomalies.push("non_eur_currency");
  const due = legacyDueDay(record.dueDate, record.createdAt);
  if (due.invalid) anomalies.push("invalid_due_date");
  else if (due.ambiguous) anomalies.push("ambiguous_due_date");
  const paidAt = validDate(record.paidAt) ? record.paidAt : null;
  if (record.paidAt && !paidAt) anomalies.push("invalid_paid_at");
  const createdAt = validDate(record.createdAt) ? record.createdAt : paidAt ?? new Date(0);

  // Un cobro marcado pagado pasa a tener su movimiento equivalente: mismo
  // importe, día derivado de paidAt (marcado, no recepción), método desconocido.
  const payments: Movement[] =
    paidAt && cents > 0
      ? [
          {
            id: record.id,
            amountCents: cents,
            receivedDay: civilDayInZone(paidAt, LEGACY_TIME_ZONE),
            receivedDaySource: "legacy_marked_paid",
            method: "unknown",
            note: null,
            recordedAt: null,
            recordedBy: null,
            source: "migration",
            operationId: legacyPaymentOperationId(record.id),
            payloadHash: null,
            status: "valid",
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            correctionOf: null,
          },
        ]
      : [];
  const receivedCents = payments.length ? cents : 0;
  const status: ChargeStatus = cents > 0 ? deriveStatus(cents, receivedCents, 0) : "open";

  return {
    id: record.id,
    trainerId: record.trainerId,
    clientId: record.clientId,
    origin: "legacy",
    concept: null,
    note: record.note ?? null,
    currency,
    dueDay: due.day,
    amountCents: cents,
    originalAmountCents: cents,
    receivedCents,
    cancelledCents: 0,
    status,
    settledAt: status === "settled" ? paidAt : null,
    cancelledAt: null,
    voidedAt: null,
    voidReason: null,
    historical: false,
    manualOverride: false,
    planOccurrenceKey: null,
    planSegment: null,
    payments,
    adjustments: [],
    operations: [],
    revision: 0,
    dueRevision: 0,
    remindersFrom: createdAt,
    reminderLog: [],
    createdAt,
    persistedV2: false,
    legacy: {
      sourceAmount: typeof record.amount === "number" ? record.amount : null,
      sourceCurrency: record.currency ?? null,
      sourceDueDate: validDate(record.dueDate) ? record.dueDate : null,
      sourcePaidAt: paidAt,
      dueDaySource: due.source,
      dueDayAmbiguous: due.ambiguous,
      timeZone: LEGACY_TIME_ZONE,
      migratedAt: null,
      migratedBy: null,
    },
    anomalies,
  };
}

export function normalizeCharge(record: ChargeRecord): Charge {
  if ((record.schemaVersion ?? 0) < 2) return normalizeLegacy(record);
  const amountCents = record.amountCents ?? 0;
  const receivedCents = record.receivedCents ?? 0;
  const cancelledCents = record.cancelledCents ?? 0;
  const createdAt = validDate(record.createdAt) ? record.createdAt : new Date(0);
  const dueDay = isCivilDay(record.dueDay) ? record.dueDay : "1970-01-01";
  return {
    id: record.id,
    trainerId: record.trainerId,
    clientId: record.clientId,
    origin: record.origin ?? "one_off",
    concept: record.concept ?? null,
    note: record.note ?? null,
    currency: (record.currency || "EUR").toUpperCase(),
    dueDay,
    amountCents,
    originalAmountCents: record.originalAmountCents ?? amountCents,
    receivedCents,
    cancelledCents,
    status: record.status ?? deriveStatus(amountCents, receivedCents, cancelledCents),
    settledAt: record.settledAt ?? null,
    cancelledAt: record.cancelledAt ?? null,
    voidedAt: record.voidedAt ?? null,
    voidReason: record.voidReason ?? null,
    historical: Boolean(record.historical),
    manualOverride: Boolean(record.manualOverride),
    planOccurrenceKey: record.planOccurrenceKey ?? null,
    planSegment: record.planSegment ?? null,
    payments: record.payments ?? [],
    adjustments: record.adjustments ?? [],
    operations: record.operations ?? [],
    revision: record.revision ?? 1,
    dueRevision: record.dueRevision ?? 1,
    remindersFrom: validDate(record.remindersFrom) ? record.remindersFrom : createdAt,
    reminderLog: record.reminderLog ?? [],
    createdAt,
    persistedV2: true,
    legacy: record.legacy ?? null,
    anomalies: record.anomalies ?? (isCivilDay(record.dueDay) ? [] : ["invalid_due_date"]),
  };
}

// Equivalencia agregado ↔ movimientos. Vacío = coherente.
export function verifyCharge(charge: Charge): string[] {
  const problems: string[] = [];
  const sum = validMovements(charge).reduce((total, movement) => total + movement.amountCents, 0);
  if (sum !== charge.receivedCents) problems.push("received_mismatch");
  if (charge.receivedCents < 0 || charge.cancelledCents < 0) problems.push("negative_amounts");
  if (balanceOf(charge) < 0) problems.push("negative_balance");
  if (charge.status !== "void" && charge.amountCents > 0 && charge.status !== deriveStatus(charge.amountCents, charge.receivedCents, charge.cancelledCents)) {
    problems.push("status_mismatch");
  }
  if (charge.status === "void" && (charge.receivedCents > 0 || charge.cancelledCents > 0)) problems.push("void_with_movements");
  return problems;
}

// --- Escritura -------------------------------------------------------------

function assertWritable(charge: Charge): void {
  if (charge.status === "void") {
    throw new PaymentsError(
      "CHARGE_VOID",
      "Este cobro era una previsión de la cuota y se anuló al pausarla o finalizarla: no admite cambios.",
      409,
    );
  }
}

function requireReason(value: unknown): string {
  return cleanText(value, REASON_MAX, "motivo", { required: true, min: 3 }) as string;
}

function adjustment(
  ctx: OpContextWithIds,
  type: AdjustmentType,
  from: AdjustmentValue,
  to: AdjustmentValue,
  reason: string | null,
  operationId: string | null,
): Adjustment {
  return { id: ctx.newId(), type, at: ctx.now, by: ctx.actorId, reason, from, to, operationId };
}

// Una operación repetida con el mismo operationId y la misma carga devuelve
// el estado actual; con otra carga, conflicto explícito.
function replayed(existingHash: string | null, hash: string): true {
  if (existingHash !== hash) {
    throw new PaymentsError(
      "IDEMPOTENCY_CONFLICT",
      "Esta operación ya se registró con otros datos. Recarga el cobro antes de repetirla.",
      409,
    );
  }
  return true;
}

function findOperation(charge: Charge, operationId: string): OperationRecord | undefined {
  return charge.operations.find((operation) => operation.operationId === operationId);
}

// Recalcula estado y marcas de tiempo. Reabrir una deuda cerrada nunca
// dispara hitos antiguos: la ventana de avisos empieza de nuevo ahora.
export function commit(charge: Charge, patch: Partial<Charge>, ctx: OpContext): Charge {
  const next: Charge = { ...charge, ...patch };
  const status = charge.status === "void" ? "void" : deriveStatus(next.amountCents, next.receivedCents, next.cancelledCents);
  const reopened = (charge.status === "settled" || charge.status === "cancelled") && status === "open";
  let remindersFrom = patch.remindersFrom ?? charge.remindersFrom;
  if ((reopened || !charge.persistedV2) && remindersFrom.getTime() < ctx.now.getTime()) remindersFrom = ctx.now;
  return {
    ...next,
    status,
    settledAt: status === "settled" ? (charge.status === "settled" && charge.settledAt ? charge.settledAt : ctx.now) : null,
    cancelledAt: status === "cancelled" ? (charge.status === "cancelled" && charge.cancelledAt ? charge.cancelledAt : ctx.now) : null,
    remindersFrom,
    revision: charge.revision + 1,
    persistedV2: true,
    legacy: charge.persistedV2 || !charge.legacy ? next.legacy : { ...charge.legacy, migratedAt: ctx.now, migratedBy: "write" },
  };
}

export function wasReopened(before: Charge, after: Charge): boolean {
  return (before.status === "settled" || before.status === "cancelled") && after.status === "open";
}

// --- Pagos -----------------------------------------------------------------

export interface PaymentInput {
  amountCents: number;
  receivedDay: CivilDay;
  method: PaymentMethod;
  note: string | null;
  operationId: string;
}

export interface PaymentBody {
  amount?: unknown;
  receivedDay?: unknown;
  method?: unknown;
  note?: unknown;
  operationId?: unknown;
}

export function parseMethod(value: unknown): PaymentMethod {
  if (typeof value !== "string" || !ENTERED_METHODS.includes(value as PaymentMethod)) {
    throw new PaymentsError("INVALID_METHOD", "Elige un método: Bizum, transferencia, efectivo, tarjeta externa u otro.", 400);
  }
  return value as PaymentMethod;
}

export function parsePaymentBody(body: PaymentBody): PaymentInput {
  return {
    amountCents: parseAmountToCents(body.amount),
    receivedDay: parseCivilDay(body.receivedDay, "fecha de recepción"),
    method: parseMethod(body.method),
    note: cleanText(body.note, NOTE_MAX, "nota"),
    operationId: parseOperationId(body.operationId),
  };
}

function paymentHash(input: Omit<PaymentInput, "operationId">): string {
  return payloadHash(["payment", input.amountCents, input.receivedDay, input.method, input.note]);
}

export interface PaymentResult {
  kind: "replay" | "applied";
  charge: Charge;
  movement: Movement;
}

export function registerPayment(
  charge: Charge,
  input: PaymentInput,
  ctx: OpContextWithIds,
  { source = "app", receivedDaySource = "entered" }: { source?: MovementSource; receivedDaySource?: ReceivedDaySource } = {},
): PaymentResult {
  const hash = paymentHash(input);
  const existing = charge.payments.find((movement) => movement.operationId === input.operationId);
  if (existing && replayed(existing.payloadHash, hash)) return { kind: "replay", charge, movement: existing };
  assertWritable(charge);
  if (charge.status !== "open") {
    throw new PaymentsError("CHARGE_CLOSED", "Este cobro ya está cerrado (liquidado o cancelado).", 409);
  }
  if (input.receivedDay > ctx.today) {
    throw new PaymentsError("FUTURE_RECEIVED_DAY", "La fecha de recepción no puede ser futura.", 422);
  }
  const balance = balanceOf(charge);
  if (input.amountCents > balance) {
    throw new PaymentsError("AMOUNT_EXCEEDS_BALANCE", "El importe supera el saldo pendiente del cobro.", 422, { balanceCents: balance });
  }
  const movement: Movement = {
    id: ctx.newId(),
    amountCents: input.amountCents,
    receivedDay: input.receivedDay,
    receivedDaySource,
    method: input.method,
    note: input.note,
    recordedAt: ctx.now,
    recordedBy: ctx.actorId,
    source,
    operationId: input.operationId,
    payloadHash: hash,
    status: "valid",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    correctionOf: null,
  };
  const next = commit(charge, { receivedCents: charge.receivedCents + input.amountCents, payments: [...charge.payments, movement] }, ctx);
  return { kind: "applied", charge: next, movement };
}

// Confirmación de saldo al reabrir una deuda cerrada o al anular: el
// entrenador confirma la cifra que ha visto; si otro pago la ha cambiado
// entretanto, la operación se rechaza en vez de aplicarse sobre otro saldo.
function parseConfirm(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export interface CorrectionBody {
  reason?: unknown;
  replacement?: PaymentBody | null;
  operationId?: unknown;
  confirmBalanceCents?: unknown;
}

export interface CorrectionResult {
  kind: "replay" | "applied";
  charge: Charge;
  reopened: boolean;
}

export function correctPayment(charge: Charge, movementId: string, body: CorrectionBody, ctx: OpContextWithIds): CorrectionResult {
  const operationId = parseOperationId(body.operationId);
  const reason = requireReason(body.reason);
  const replacement = body.replacement
    ? {
        amountCents: parseAmountToCents(body.replacement.amount),
        receivedDay: parseCivilDay(body.replacement.receivedDay, "fecha de recepción"),
        method: parseMethod(body.replacement.method),
        note: cleanText(body.replacement.note, NOTE_MAX, "nota"),
      }
    : null;
  const hash = payloadHash([
    "correct",
    movementId,
    reason,
    replacement?.amountCents ?? null,
    replacement?.receivedDay ?? null,
    replacement?.method ?? null,
    replacement?.note ?? null,
  ]);
  const previous = findOperation(charge, operationId);
  if (previous && replayed(previous.payloadHash, hash)) return { kind: "replay", charge, reopened: false };
  assertWritable(charge);

  const original = charge.payments.find((movement) => movement.id === movementId);
  if (!original) throw new PaymentsError("PAYMENT_NOT_FOUND", "Pago no encontrado en este cobro.", 404);
  if (original.status !== "valid") {
    throw new PaymentsError("PAYMENT_ALREADY_CORRECTED", "Este pago ya se corrigió; su rastro se conserva.", 409);
  }
  if (replacement && replacement.receivedDay > ctx.today) {
    throw new PaymentsError("FUTURE_RECEIVED_DAY", "La fecha de recepción no puede ser futura.", 422);
  }
  const receivedCents = charge.receivedCents - original.amountCents + (replacement?.amountCents ?? 0);
  if (receivedCents + charge.cancelledCents > charge.amountCents) {
    throw new PaymentsError(
      "AMOUNT_EXCEEDS_BALANCE",
      "Con esa corrección, lo recibido más lo anulado superaría el importe del cobro.",
      422,
      { maxCents: charge.amountCents - charge.cancelledCents - (charge.receivedCents - original.amountCents) },
    );
  }
  const balance = charge.amountCents - receivedCents - charge.cancelledCents;
  const reopening = charge.status !== "open" && balance > 0;
  if (reopening && parseConfirm(body.confirmBalanceCents) !== balance) {
    throw new PaymentsError(
      "REOPEN_CONFIRMATION_REQUIRED",
      "La corrección vuelve a dejar saldo pendiente. Confírmalo para reabrir el cobro.",
      409,
      { balanceCents: balance },
    );
  }

  const payments: Movement[] = charge.payments.map((movement) =>
    movement.id === original.id
      ? { ...movement, status: "voided", voidedAt: ctx.now, voidedBy: ctx.actorId, voidReason: reason }
      : movement,
  );
  if (replacement) {
    payments.push({
      id: ctx.newId(),
      ...replacement,
      receivedDaySource: "entered",
      recordedAt: ctx.now,
      recordedBy: ctx.actorId,
      source: "app",
      operationId: `${operationId}:replacement`,
      payloadHash: paymentHash(replacement),
      status: "valid",
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      correctionOf: original.id,
    });
  }
  const next = commit(
    charge,
    {
      receivedCents,
      payments,
      adjustments: [
        ...charge.adjustments,
        adjustment(ctx, "payment_corrected", original.amountCents, replacement?.amountCents ?? 0, reason, operationId),
      ],
      operations: [...charge.operations, { operationId, kind: "correct_payment", payloadHash: hash, at: ctx.now }],
    },
    ctx,
  );
  return { kind: "applied", charge: next, reopened: wasReopened(charge, next) };
}

// --- Anulación de saldo ----------------------------------------------------

export interface BalanceBody {
  reason?: unknown;
  operationId?: unknown;
  confirmBalanceCents?: unknown;
  amount?: unknown;
}

export interface SimpleResult {
  kind: "replay" | "applied";
  charge: Charge;
  reopened: boolean;
}

// Anula SOLO lo que falta: 100 con 30 recibidos → 70 anulados, 30 siguen
// siendo dinero recibido. No es un cobro ni una devolución.
export function cancelBalance(charge: Charge, body: BalanceBody, ctx: OpContextWithIds): SimpleResult {
  const operationId = parseOperationId(body.operationId);
  const reason = requireReason(body.reason);
  const confirm = parseConfirm(body.confirmBalanceCents);
  const hash = payloadHash(["cancel", reason, confirm]);
  const previous = findOperation(charge, operationId);
  if (previous && replayed(previous.payloadHash, hash)) return { kind: "replay", charge, reopened: false };
  assertWritable(charge);
  const balance = balanceOf(charge);
  if (charge.status !== "open" || balance <= 0) {
    throw new PaymentsError("CHARGE_CLOSED", "Este cobro no tiene saldo pendiente que anular.", 409);
  }
  if (confirm !== balance) {
    throw new PaymentsError("BALANCE_CHANGED", "El saldo ha cambiado desde que lo consultaste. Revísalo y confirma de nuevo.", 409, {
      balanceCents: balance,
    });
  }
  const next = commit(
    charge,
    {
      cancelledCents: charge.cancelledCents + balance,
      adjustments: [...charge.adjustments, adjustment(ctx, "cancel_balance", balance, 0, reason, operationId)],
      operations: [...charge.operations, { operationId, kind: "cancel_balance", payloadHash: hash, at: ctx.now }],
    },
    ctx,
  );
  return { kind: "applied", charge: next, reopened: false };
}

// Rectificar una anulación: siempre explícito, con motivo y confirmando el
// saldo que volverá a quedar pendiente.
export function restoreCancelled(charge: Charge, body: BalanceBody, ctx: OpContextWithIds): SimpleResult {
  const operationId = parseOperationId(body.operationId);
  const reason = requireReason(body.reason);
  const amountCents = parseAmountToCents(body.amount);
  const confirm = parseConfirm(body.confirmBalanceCents);
  const hash = payloadHash(["restore", amountCents, reason, confirm]);
  const previous = findOperation(charge, operationId);
  if (previous && replayed(previous.payloadHash, hash)) return { kind: "replay", charge, reopened: false };
  assertWritable(charge);
  if (amountCents > charge.cancelledCents) {
    throw new PaymentsError("AMOUNT_EXCEEDS_CANCELLED", "No puedes recuperar más saldo del que se anuló.", 422, {
      cancelledCents: charge.cancelledCents,
    });
  }
  const cancelledCents = charge.cancelledCents - amountCents;
  const balance = charge.amountCents - charge.receivedCents - cancelledCents;
  if (confirm !== balance) {
    throw new PaymentsError(
      "REOPEN_CONFIRMATION_REQUIRED",
      "Recuperar saldo anulado vuelve a dejar deuda pendiente. Confirma el nuevo saldo.",
      409,
      { balanceCents: balance },
    );
  }
  const next = commit(
    charge,
    {
      cancelledCents,
      adjustments: [...charge.adjustments, adjustment(ctx, "restore_balance", charge.cancelledCents, cancelledCents, reason, operationId)],
      operations: [...charge.operations, { operationId, kind: "restore_balance", payloadHash: hash, at: ctx.now }],
    },
    ctx,
  );
  return { kind: "applied", charge: next, reopened: wasReopened(charge, next) };
}

// --- Edición de un cobro concreto ------------------------------------------

export interface EditBody {
  amount?: unknown;
  dueDay?: unknown;
  concept?: unknown;
  note?: unknown;
  reason?: unknown;
  operationId?: unknown;
  confirmBalanceCents?: unknown;
}

export interface EditResult {
  kind: "replay" | "applied";
  charge: Charge;
  reopened: boolean;
  dueChanged: boolean;
}

export function editCharge(charge: Charge, body: EditBody, ctx: OpContextWithIds): EditResult {
  const operationId = parseOperationId(body.operationId);
  const amountCents = body.amount === undefined ? undefined : parseAmountToCents(body.amount);
  const dueDay = body.dueDay === undefined ? undefined : parseCivilDay(body.dueDay, "vencimiento");
  const concept = body.concept === undefined ? undefined : cleanText(body.concept, CONCEPT_MAX, "concepto");
  const note = body.note === undefined ? undefined : cleanText(body.note, NOTE_MAX, "nota");
  const reasonText = cleanText(body.reason, REASON_MAX, "motivo");
  const confirm = parseConfirm(body.confirmBalanceCents);
  const hash = payloadHash([
    "edit",
    amountCents ?? null,
    dueDay ?? null,
    concept === undefined ? "__keep" : concept,
    note === undefined ? "__keep" : note,
    reasonText,
    confirm,
  ]);
  const previous = findOperation(charge, operationId);
  if (previous && replayed(previous.payloadHash, hash)) return { kind: "replay", charge, reopened: false, dueChanged: false };
  assertWritable(charge);

  const amountChanged = amountCents !== undefined && amountCents !== charge.amountCents;
  const dueChanged = dueDay !== undefined && dueDay !== charge.dueDay;
  const conceptChanged = concept !== undefined && concept !== charge.concept;
  const noteChanged = note !== undefined && note !== charge.note;
  if (!amountChanged && !dueChanged && !conceptChanged && !noteChanged) {
    throw new PaymentsError("NO_CHANGES", "No hay cambios que guardar.", 400);
  }
  const reason = amountChanged || dueChanged ? requireReason(body.reason) : reasonText;
  if (amountChanged && amountCents !== undefined) {
    if (amountCents > MAX_AMOUNT_CENTS || amountCents < charge.receivedCents + charge.cancelledCents) {
      throw new PaymentsError(
        "AMOUNT_BELOW_RECORDED",
        "El importe no puede quedar por debajo de lo ya recibido más lo anulado. Corrige antes esos registros.",
        422,
        { receivedCents: charge.receivedCents, cancelledCents: charge.cancelledCents },
      );
    }
    const balance = amountCents - charge.receivedCents - charge.cancelledCents;
    if (charge.status !== "open" && balance > 0 && confirm !== balance) {
      throw new PaymentsError(
        "REOPEN_CONFIRMATION_REQUIRED",
        "El nuevo importe vuelve a dejar saldo pendiente. Confírmalo para reabrir el cobro.",
        409,
        { balanceCents: balance },
      );
    }
  }

  const adjustments = [...charge.adjustments];
  if (amountChanged) adjustments.push(adjustment(ctx, "amount_changed", charge.amountCents, amountCents ?? null, reason, operationId));
  if (dueChanged) adjustments.push(adjustment(ctx, "due_changed", charge.dueDay, dueDay ?? null, reason, operationId));
  if (conceptChanged) adjustments.push(adjustment(ctx, "concept_changed", charge.concept, concept ?? null, reason, operationId));
  if (noteChanged) adjustments.push(adjustment(ctx, "note_changed", null, null, reason, operationId));

  const patch: Partial<Charge> = {
    adjustments,
    operations: [...charge.operations, { operationId, kind: "edit_charge", payloadHash: hash, at: ctx.now }],
    manualOverride: charge.manualOverride || (charge.origin === "recurring" && (amountChanged || dueChanged)),
  };
  if (amountChanged && amountCents !== undefined) patch.amountCents = amountCents;
  if (conceptChanged) patch.concept = concept ?? null;
  if (noteChanged) patch.note = note ?? null;
  if (dueChanged && dueDay !== undefined) {
    // Nueva revisión de vencimiento: los hitos de la anterior quedan
    // invalidados y los nuevos solo cuentan desde ahora (sin ráfagas).
    patch.dueDay = dueDay;
    patch.dueRevision = charge.dueRevision + 1;
    patch.remindersFrom = ctx.now;
  }
  const next = commit(charge, patch, ctx);
  return { kind: "applied", charge: next, reopened: wasReopened(charge, next), dueChanged };
}

// --- Previsiones de la cuota -----------------------------------------------

// Solo una previsión sin dinero se puede anular por pausa/fin/baja; el resto
// (pasadas, con pagos) queda visible para resolverse explícitamente.
export function voidForecast(charge: Charge, reason: VoidReason, today: CivilDay, ctx: OpContextWithIds): Charge | null {
  if (!isForecast(charge, today)) return null;
  return {
    ...charge,
    status: "void",
    voidedAt: ctx.now,
    voidReason: reason,
    adjustments: [...charge.adjustments, adjustment(ctx, "voided", charge.amountCents, 0, reason, null)],
    revision: charge.revision + 1,
  };
}

// Cambio de precio sobre una previsión ya materializada: trazable y solo si
// no tiene pagos ni una edición manual encima.
export function repriceForecast(
  charge: Charge,
  amountCents: number,
  concept: string | null,
  today: CivilDay,
  ctx: OpContextWithIds,
): Charge | null {
  const untouched = charge.origin === "recurring" && charge.status === "open" && charge.receivedCents === 0 && charge.cancelledCents === 0;
  if (!untouched || charge.manualOverride || charge.dueDay < today) return null;
  const adjustments = [...charge.adjustments];
  if (amountCents !== charge.amountCents) adjustments.push(adjustment(ctx, "price_change", charge.amountCents, amountCents, null, null));
  if (concept !== charge.concept) adjustments.push(adjustment(ctx, "concept_changed", charge.concept, concept, null, null));
  if (adjustments.length === charge.adjustments.length) return null;
  return { ...charge, amountCents, concept, adjustments, revision: charge.revision + 1 };
}

// --- Alta de un cobro puntual ---------------------------------------------

export interface OneOffBody {
  amount?: unknown;
  dueDay?: unknown;
  concept?: unknown;
  note?: unknown;
  operationId?: unknown;
  confirmPastDue?: unknown;
}

export interface NewOneOff {
  charge: Charge;
  operationId: string;
  payloadHash: string;
}

// Un vencimiento pasado es deuda anterior que se incorpora a propósito: se
// exige confirmarlo, queda marcado como histórico y no genera avisos antiguos
// (la ventana de avisos empieza al darlo de alta).
export function newOneOffCharge(
  body: OneOffBody,
  ids: { id: string; trainerId: string; clientId: string },
  ctx: OpContext,
): NewOneOff {
  const amountCents = parseAmountToCents(body.amount);
  const dueDay = parseCivilDay(body.dueDay, "vencimiento");
  const concept = cleanText(body.concept, CONCEPT_MAX, "concepto");
  const note = cleanText(body.note, NOTE_MAX, "nota");
  const operationId = parseOperationId(body.operationId);
  const historical = dueDay < ctx.today;
  if (historical && body.confirmPastDue !== true) {
    throw new PaymentsError(
      "PAST_DUE_CONFIRMATION_REQUIRED",
      "El vencimiento es anterior a hoy. Confirma que incorporas una deuda pasada (no se enviarán avisos atrasados).",
      422,
    );
  }
  return {
    operationId,
    payloadHash: payloadHash(["one_off", amountCents, dueDay, concept, note]),
    charge: {
      ...ids,
      origin: "one_off",
      concept,
      note,
      currency: "EUR",
      dueDay,
      amountCents,
      originalAmountCents: amountCents,
      receivedCents: 0,
      cancelledCents: 0,
      status: "open",
      settledAt: null,
      cancelledAt: null,
      voidedAt: null,
      voidReason: null,
      historical,
      manualOverride: false,
      planOccurrenceKey: null,
      planSegment: null,
      payments: [],
      adjustments: [],
      operations: [],
      revision: 1,
      dueRevision: 1,
      remindersFrom: ctx.now,
      reminderLog: [],
      createdAt: ctx.now,
      persistedV2: true,
      legacy: null,
      anomalies: [],
    },
  };
}
