import {
  Adjustment,
  AdjustmentType,
  AdjustmentValue,
  Charge,
  ChargeRecord,
  ChargeStatus,
  CivilDay,
  Movement,
  OpContext,
  OperationRecord,
  PaymentMethod,
  PaymentsError,
  TemporalState,
  VoidReason,
} from "./types";
import { isCivilDay, parseCivilDay } from "./calendar";
import { MAX_AMOUNT_CENTS, cleanText, parseAmountToCents, parseOperationId, payloadHash } from "./money";

// PURO — el libro de un cobro. Toda operación recibe el cobro normalizado y
// devuelve el cobro siguiente; la capa de datos lo escribe con compare-and-swap
// sobre `revision`, así que dos pagos simultáneos nunca pueden superar el saldo.
//
// saldo = importe vigente - pagos válidos - saldo anulado
// `receivedCents` y `cancelledCents` se guardan junto a los movimientos en el
// MISMO documento y en la MISMA escritura: no son autoridades independientes
// (verifyCharge comprueba la equivalencia).

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

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// Documento → cobro. Los valores que falten toman su valor neutro.
export function normalizeCharge(record: ChargeRecord): Charge {
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
  if (reopened && remindersFrom.getTime() < ctx.now.getTime()) remindersFrom = ctx.now;
  return {
    ...next,
    status,
    settledAt: status === "settled" ? (charge.status === "settled" && charge.settledAt ? charge.settledAt : ctx.now) : null,
    cancelledAt: status === "cancelled" ? (charge.status === "cancelled" && charge.cancelledAt ? charge.cancelledAt : ctx.now) : null,
    remindersFrom,
    revision: charge.revision + 1,
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

export function registerPayment(charge: Charge, input: PaymentInput, ctx: OpContextWithIds): PaymentResult {
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
    receivedDaySource: "entered",
    method: input.method,
    note: input.note,
    recordedAt: ctx.now,
    recordedBy: ctx.actorId,
    source: "app",
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
      anomalies: [],
    },
  };
}
