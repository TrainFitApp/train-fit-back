import {
  AdjustmentType,
  AdjustmentValue,
  Charge,
  ChargeOrigin,
  ChargeStatus,
  CivilDay,
  FeePlan,
  MovementSource,
  PaymentMethod,
  PlanStatus,
  ReceivedDaySource,
  RecurrenceUnit,
  TemporalState,
  PlanHistoryEntry,
} from "./types";
import { addDays } from "./calendar";
import { balanceOf, isForecast, temporalState, validMovements } from "./ledger";
import { nextPlanDue, priceForDay } from "./plan";

// PURO — contratos de salida. Dos audiencias distintas:
// - entrenador (todo, notas incluidas),
// - cliente (saldo restante, fecha y concepto; nunca notas ni movimientos).

export interface ChargeView {
  id: string;
  clientId: string;
  origin: ChargeOrigin;
  concept: string | null;
  note: string | null;
  currency: string;
  dueDay: CivilDay;
  amountCents: number;
  originalAmountCents: number;
  receivedCents: number;
  cancelledCents: number;
  balanceCents: number;
  status: ChargeStatus;
  voidReason: string | null;
  temporal: TemporalState;
  forecast: boolean;
  historical: boolean;
  manualOverride: boolean;
  paymentsCount: number;
  lastReceivedDay: CivilDay | null;
  settledAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  revision: number;
  anomalies: string[];
}

export function chargeView(charge: Charge, today: CivilDay): ChargeView {
  const valid = validMovements(charge);
  return {
    id: charge.id,
    clientId: charge.clientId,
    origin: charge.origin,
    concept: charge.concept,
    note: charge.note,
    currency: charge.currency,
    dueDay: charge.dueDay,
    amountCents: charge.amountCents,
    originalAmountCents: charge.originalAmountCents,
    receivedCents: charge.receivedCents,
    cancelledCents: charge.cancelledCents,
    balanceCents: Math.max(0, balanceOf(charge)),
    status: charge.status,
    voidReason: charge.voidReason,
    temporal: temporalState(charge, today),
    forecast: isForecast(charge, today),
    historical: charge.historical,
    manualOverride: charge.manualOverride,
    paymentsCount: valid.length,
    lastReceivedDay: valid.reduce<CivilDay | null>((last, movement) => (!last || movement.receivedDay > last ? movement.receivedDay : last), null),
    settledAt: charge.settledAt,
    cancelledAt: charge.cancelledAt,
    createdAt: charge.createdAt,
    revision: charge.revision,
    anomalies: charge.anomalies,
  };
}

export interface MovementView {
  id: string;
  amountCents: number;
  receivedDay: CivilDay;
  receivedDaySource: ReceivedDaySource;
  method: PaymentMethod;
  note: string | null;
  recordedAt: Date | null;
  source: MovementSource;
  status: "valid" | "voided";
  voidedAt: Date | null;
  voidReason: string | null;
  correctionOf: string | null;
}

export interface AdjustmentView {
  id: string;
  type: AdjustmentType;
  at: Date;
  reason: string | null;
  from: AdjustmentValue;
  to: AdjustmentValue;
}

export interface ChargeDetailView extends ChargeView {
  payments: MovementView[];
  adjustments: AdjustmentView[];
}

export function chargeDetailView(charge: Charge, today: CivilDay): ChargeDetailView {
  return {
    ...chargeView(charge, today),
    payments: charge.payments.map((movement) => ({
      id: movement.id,
      amountCents: movement.amountCents,
      receivedDay: movement.receivedDay,
      receivedDaySource: movement.receivedDaySource,
      method: movement.method,
      note: movement.note,
      recordedAt: movement.recordedAt,
      source: movement.source,
      status: movement.status,
      voidedAt: movement.voidedAt,
      voidReason: movement.voidReason,
      correctionOf: movement.correctionOf,
    })),
    adjustments: charge.adjustments.map((item) => ({
      id: item.id,
      type: item.type,
      at: item.at,
      reason: item.reason,
      // La nota es privada pero su contenido no se duplica en el historial.
      from: item.type === "note_changed" ? null : item.from,
      to: item.type === "note_changed" ? null : item.to,
    })),
  };
}

// Pendiente informativo del tab Coach (cliente): el saldo que le queda, sin
// notas, métodos ni movimientos.
export interface CoachPendingItem {
  chargeId: string;
  balanceCents: number;
  currency: string;
  dueDay: CivilDay;
  concept: string | null;
  trainerName: string;
}

export function coachPendingItem(charge: Charge, trainerName: string): CoachPendingItem {
  return {
    chargeId: charge.id,
    balanceCents: Math.max(0, balanceOf(charge)),
    currency: charge.currency,
    dueDay: charge.dueDay,
    concept: charge.concept,
    trainerName,
  };
}

// Estado vigente de un cobro para pintar un aviso antiguo: el saldo de ahora,
// no el que había al emitirlo.
export interface NotificationChargeState {
  status: ChargeStatus;
  balanceCents: number;
  dueDay: CivilDay;
  currency: string;
}

export function notificationChargeState(charge: Charge): NotificationChargeState {
  return { status: charge.status, balanceCents: Math.max(0, balanceOf(charge)), dueDay: charge.dueDay, currency: charge.currency };
}

// --- Cuota -------------------------------------------------------------------

export interface PlanView {
  status: PlanStatus;
  concept: string;
  currency: "EUR";
  unit: RecurrenceUnit;
  interval: number;
  amountCents: number; // precio del próximo vencimiento (o el último vigente)
  nextDueDay: CivilDay | null;
  anchorDay: CivilDay;
  scheduledPrice: { fromDay: CivilDay; amountCents: number } | null;
  startedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  history: PlanHistoryEntry[];
}

export function planView(plan: FeePlan | null, today: CivilDay): PlanView | null {
  if (!plan) return null;
  const nextDueDay = nextPlanDue(plan, today);
  const reference = nextDueDay ?? plan.prices[plan.prices.length - 1]?.fromDay ?? plan.anchorDay;
  const future = plan.prices.find((entry) => entry.fromDay > reference);
  return {
    status: plan.status,
    concept: plan.concept,
    currency: plan.currency,
    unit: plan.unit,
    interval: plan.interval,
    amountCents: priceForDay(plan, reference),
    nextDueDay,
    anchorDay: plan.anchorDay,
    scheduledPrice: future ? { fromDay: future.fromDay, amountCents: future.amountCents } : null,
    startedAt: plan.startedAt,
    pausedAt: plan.pausedAt,
    endedAt: plan.endedAt,
    endReason: plan.endReason,
    history: plan.history.slice(-20),
  };
}

// --- Tarjeta "Cobros" del Resumen de UN cliente --------------------------------

export type CardState = "overdue" | "due_today" | "paused" | "upcoming" | "no_fee" | "no_pending";

export interface ClientPaymentsSummary {
  state: CardState;
  currency: "EUR";
  overdue: { balanceCents: number; count: number; oldestDueDay: CivilDay } | null;
  dueToday: { balanceCents: number; count: number; chargeId: string | null } | null;
  next: { dueDay: CivilDay; amountCents: number; chargeId: string | null; origin: ChargeOrigin | "plan" } | null;
  pendingCents: number; // deuda consolidada abierta (vencida incluida), sin previsiones
  openCount: number;
  plan: { status: PlanStatus; unit: RecurrenceUnit; interval: number; amountCents: number; nextDueDay: CivilDay | null } | null;
  otherCurrencies: Array<{ currency: string; balanceCents: number }>;
  needsReview: number;
  hasCharges: boolean;
}

// La deuda manda sobre el estado de la cuota: pausar nunca esconde un pendiente.
export function clientPaymentsSummary(charges: Charge[], plan: FeePlan | null, today: CivilDay): ClientPaymentsSummary {
  const live = charges.filter((charge) => charge.status !== "void");
  const open = live.filter((charge) => charge.status === "open" && balanceOf(charge) > 0);
  const eur = open.filter((charge) => charge.currency === "EUR");
  const overdueCharges = eur.filter((charge) => charge.dueDay < today);
  const todayCharges = eur.filter((charge) => charge.dueDay === today);
  const sum = (list: Charge[]) => list.reduce((total, charge) => total + balanceOf(charge), 0);

  const others = new Map<string, number>();
  for (const charge of open) {
    if (charge.currency !== "EUR") others.set(charge.currency, (others.get(charge.currency) ?? 0) + balanceOf(charge));
  }

  const upcomingCharge = eur
    .filter((charge) => charge.dueDay > today)
    .sort((a, b) => (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0))[0];
  const planNext = nextPlanDue(plan, addDays(today, 1));
  let next: ClientPaymentsSummary["next"] = upcomingCharge
    ? { dueDay: upcomingCharge.dueDay, amountCents: balanceOf(upcomingCharge), chargeId: upcomingCharge.id, origin: upcomingCharge.origin }
    : null;
  if (plan && planNext && (!next || planNext < next.dueDay)) {
    next = { dueDay: planNext, amountCents: priceForDay(plan, planNext), chargeId: null, origin: "plan" };
  }

  let state: CardState;
  if (overdueCharges.length) state = "overdue";
  else if (todayCharges.length) state = "due_today";
  else if (plan?.status === "paused") state = "paused";
  else if (next) state = "upcoming";
  else if (!live.length && (!plan || plan.status === "ended")) state = "no_fee";
  else state = "no_pending";

  const oldest = overdueCharges.map((charge) => charge.dueDay).sort()[0];
  const planSummary = plan ? planView(plan, today) : null;
  return {
    state,
    currency: "EUR",
    overdue: overdueCharges.length && oldest ? { balanceCents: sum(overdueCharges), count: overdueCharges.length, oldestDueDay: oldest } : null,
    dueToday: todayCharges.length
      ? { balanceCents: sum(todayCharges), count: todayCharges.length, chargeId: todayCharges.length === 1 ? todayCharges[0]?.id ?? null : null }
      : null,
    next,
    pendingCents: sum(eur.filter((charge) => !isForecast(charge, today))),
    openCount: open.length,
    plan: planSummary
      ? {
          status: planSummary.status,
          unit: planSummary.unit,
          interval: planSummary.interval,
          amountCents: planSummary.amountCents,
          nextDueDay: planSummary.nextDueDay,
        }
      : null,
    otherCurrencies: [...others.entries()].map(([currency, balanceCents]) => ({ currency, balanceCents })),
    needsReview: live.filter((charge) => charge.anomalies.length > 0).length,
    hasCharges: live.length > 0,
  };
}
