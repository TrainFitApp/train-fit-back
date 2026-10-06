import {
  Charge,
  CivilDay,
  FeePlan,
  OperationRecord,
  PaymentProfile,
  PaymentsError,
  PlanAction,
  PlanHistoryEntry,
  VoidReason,
} from "./types";
import { Recurrence, addDays, isOccurrence, nextOccurrences, occurrencesBetween, parseCivilDay, validateRecurrence } from "./calendar";
import { cleanText, parseAmountToCents, parseOperationId, payloadHash } from "./money";
import { CONCEPT_MAX, OpContextWithIds, isForecast, repriceForecast, voidForecast } from "./ledger";

// PURO — la cuota recurrente (regla) y su relación con los cobros concretos.
//
// - Una sola regla por pareja: vive en el perfil de pago, no en los scopes.
// - Clave de ocurrencia `perfil:segmento:día`, única en BD: generar dos veces
//   el mismo vencimiento es imposible. Reanudar o recalendarizar abre un
//   segmento nuevo (claves nuevas), un cambio de precio NO.
// - El precio de un día sale de la tabla `prices` (vigencia por fecha), así
//   que da igual si ese vencimiento ya estaba materializado: la
//   reconciliación deja la previsión con el precio que toca.
// - Solo se materializa hasta HOY + horizonte; más allá es previsión pura.

export const MATERIALIZATION_HORIZON_DAYS = 7;
export const DEFAULT_FEE_CONCEPT = "Cuota";
export const PREVIEW_COUNT = 3;
const PROFILE_OPERATIONS_KEPT = 50;

export function planRecurrence(plan: FeePlan): Recurrence {
  return { unit: plan.unit, interval: plan.interval, anchorDay: plan.anchorDay };
}

export function priceForDay(plan: FeePlan, day: CivilDay): number {
  let price = plan.prices[0]?.amountCents ?? 0;
  for (const entry of plan.prices) if (entry.fromDay <= day) price = entry.amountCents;
  return price;
}

// Inicio del segmento vigente (alta, reactivación, recalendarización o
// reanudación). Es la ventana de avisos de sus vencimientos: si nadie abrió
// la app y uno se materializa tarde, aún puede emitir su hito más reciente.
export function segmentStartedAt(plan: FeePlan): Date {
  const starts: PlanAction[] = ["created", "reactivated", "rescheduled", "resumed"];
  for (let index = plan.history.length - 1; index >= 0; index -= 1) {
    const entry = plan.history[index];
    if (entry && starts.includes(entry.action)) return entry.at;
  }
  return plan.startedAt;
}

// Vencimiento de la cuota listo para insertar (la clave única evita duplicados).
export function newRecurringCharge(
  profile: PaymentProfile,
  target: MaterializationTarget,
  id: string,
  now: Date,
): Charge {
  const remindersFrom = profile.plan ? segmentStartedAt(profile.plan) : now;
  return {
    id,
    trainerId: profile.trainerId,
    clientId: profile.clientId,
    origin: "recurring",
    concept: target.concept,
    note: null,
    currency: "EUR",
    dueDay: target.day,
    amountCents: target.amountCents,
    originalAmountCents: target.amountCents,
    receivedCents: 0,
    cancelledCents: 0,
    status: "open",
    settledAt: null,
    cancelledAt: null,
    voidedAt: null,
    voidReason: null,
    historical: false,
    manualOverride: false,
    planOccurrenceKey: target.key,
    planSegment: target.segment,
    payments: [],
    adjustments: [],
    operations: [],
    revision: 1,
    dueRevision: 1,
    remindersFrom,
    reminderLog: [],
    createdAt: now,
    anomalies: [],
  };
}

export function occurrenceKey(profileId: string, segment: number, day: CivilDay): string {
  return `${profileId}:${segment}:${day}`;
}

export function nextPlanDue(plan: FeePlan | null, fromDay: CivilDay): CivilDay | null {
  if (!plan || plan.status !== "active") return null;
  return nextOccurrences(planRecurrence(plan), fromDay, 1)[0]?.day ?? null;
}

export interface DatedAmount {
  day: CivilDay;
  amountCents: number;
}

export function previewDates(plan: FeePlan, fromDay: CivilDay, count = PREVIEW_COUNT): DatedAmount[] {
  return nextOccurrences(planRecurrence(plan), fromDay, count).map(({ day }) => ({ day, amountCents: priceForDay(plan, day) }));
}

function belongsTo(profile: PaymentProfile, charge: Charge): boolean {
  return charge.origin === "recurring" && Boolean(charge.planOccurrenceKey?.startsWith(`${profile.id}:`));
}

// Último vencimiento recurrente que seguirá existiendo (pasado o con pagos):
// un calendario nuevo tiene que empezar DESPUÉS, o duplicaría un periodo.
export function lastFrozenRecurringDay(profile: PaymentProfile, charges: Charge[], today: CivilDay): CivilDay | null {
  let last: CivilDay | null = null;
  for (const charge of charges) {
    if (!belongsTo(profile, charge) || charge.status === "void" || isForecast(charge, today)) continue;
    if (last === null || charge.dueDay > last) last = charge.dueDay;
  }
  return last;
}

function assertStartDay(day: CivilDay, today: CivilDay, frozen: CivilDay | null): void {
  if (day < today) {
    throw new PaymentsError(
      "START_IN_PAST",
      "El vencimiento de la cuota no puede ser anterior a hoy. Para una deuda antigua, añade un cobro puntual.",
      422,
    );
  }
  if (frozen && day <= frozen) {
    throw new PaymentsError(
      "START_OVERLAPS_EXISTING",
      "Ya hay un vencimiento de la cuota con pagos o vencido en esa fecha o después. Elige una fecha posterior.",
      422,
      { lastDay: frozen },
    );
  }
}

// --- Reconciliación: el estado de los cobros converge a la regla vigente ----

export interface MaterializationTarget {
  key: string;
  day: CivilDay;
  amountCents: number;
  concept: string;
  segment: number;
}

export function materializationTargets(
  profile: PaymentProfile,
  today: CivilDay,
  horizonDays = MATERIALIZATION_HORIZON_DAYS,
): MaterializationTarget[] {
  const plan = profile.plan;
  if (!plan || plan.status !== "active") return [];
  const until = addDays(today, horizonDays);
  const cursor = plan.materializedThrough;
  const from = cursor && cursor >= plan.anchorDay ? addDays(cursor, 1) : plan.anchorDay;
  if (from > until) return [];
  return occurrencesBetween(planRecurrence(plan), from, until).map(({ day }) => ({
    key: occurrenceKey(profile.id, plan.segment, day),
    day,
    amountCents: priceForDay(plan, day),
    concept: plan.concept,
    segment: plan.segment,
  }));
}

function voidReasonFor(plan: FeePlan | null, charge: Charge): VoidReason | null {
  if (!plan) return "plan_ended";
  if (plan.status === "paused") return "plan_paused";
  if (plan.status === "ended") return plan.endReason === "relation_ended" ? "relation_ended" : "plan_ended";
  return charge.planSegment === plan.segment ? null : "plan_rescheduled";
}

export interface ReconcileResult {
  voids: Charge[];
  reprices: Array<{ before: Charge; after: Charge }>;
  protectedCharges: Array<{ chargeId: string; dueDay: CivilDay; reason: "has_movements" | "manual_override" }>;
}

// Previsiones de la cuota (futuras y sin dinero): se anulan si la regla ya no
// las genera y se reajustan si cambió su precio/concepto. Lo demás no se toca.
export function reconcileCharges(profile: PaymentProfile, charges: Charge[], today: CivilDay, ctx: OpContextWithIds): ReconcileResult {
  const plan = profile.plan;
  const result: ReconcileResult = { voids: [], reprices: [], protectedCharges: [] };
  for (const charge of charges) {
    if (!belongsTo(profile, charge) || charge.status !== "open" || charge.dueDay < today) continue;
    const reason = voidReasonFor(plan, charge);
    if (reason) {
      const voided = voidForecast(charge, reason, today, ctx);
      if (voided) result.voids.push(voided);
      else if (charge.dueDay > today) result.protectedCharges.push({ chargeId: charge.id, dueDay: charge.dueDay, reason: "has_movements" });
      continue;
    }
    if (!plan) continue;
    const price = priceForDay(plan, charge.dueDay);
    if (price === charge.amountCents && plan.concept === charge.concept) continue;
    const repriced = repriceForecast(charge, price, plan.concept, today, ctx);
    if (repriced) result.reprices.push({ before: charge, after: repriced });
    else {
      result.protectedCharges.push({
        chargeId: charge.id,
        dueDay: charge.dueDay,
        reason: charge.manualOverride ? "manual_override" : "has_movements",
      });
    }
  }
  return result;
}

// --- Cambios de la regla -----------------------------------------------------

export interface PlanBody {
  concept?: unknown;
  amount?: unknown;
  unit?: unknown;
  interval?: unknown;
  nextDueDay?: unknown;
  effectiveFromDay?: unknown;
  operationId?: unknown;
}

export type PlanChangeKind = "price" | "concept" | "schedule" | "status";

export interface PlanChange {
  mode: "create" | "reactivate" | "update" | "noop" | "replay";
  changes: PlanChangeKind[];
  profile: PaymentProfile; // perfil resultante (plan + operación registrada)
  priceFromDay: CivilDay | null;
  nextDates: DatedAmount[];
}

function history(ctx: OpContextWithIds, action: PlanAction, details: PlanHistoryEntry["details"]): PlanHistoryEntry {
  return { at: ctx.now, by: ctx.actorId, action, details };
}

function withOperation(profile: PaymentProfile, plan: FeePlan | null, operation: OperationRecord | null): PaymentProfile {
  const operations = operation ? [...profile.operations, operation].slice(-PROFILE_OPERATIONS_KEPT) : profile.operations;
  return { ...profile, plan, operations, revision: profile.revision + 1 };
}

// null = operación nueva; PlanChange "replay" = ya aplicada con esta carga.
function replayCheck(profile: PaymentProfile, operationId: string, hash: string): PlanChange | null {
  const previous = profile.operations.find((operation) => operation.operationId === operationId);
  if (!previous) return null;
  if (previous.payloadHash !== hash) {
    throw new PaymentsError("IDEMPOTENCY_CONFLICT", "Esta operación ya se registró con otros datos. Recarga la cuota.", 409);
  }
  return { mode: "replay", changes: [], profile, priceFromDay: null, nextDates: [] };
}

export function planChange(profile: PaymentProfile, charges: Charge[], body: PlanBody, ctx: OpContextWithIds): PlanChange {
  const operationId = parseOperationId(body.operationId);
  const concept = cleanText(body.concept, CONCEPT_MAX, "concepto") ?? DEFAULT_FEE_CONCEPT;
  const amountCents = parseAmountToCents(body.amount);
  const unit = body.unit;
  const interval = Number(body.interval);
  const nextDueDay = body.nextDueDay === undefined || body.nextDueDay === null || body.nextDueDay === ""
    ? null
    : parseCivilDay(body.nextDueDay, "próximo vencimiento");
  const effectiveFromDay = body.effectiveFromDay === undefined || body.effectiveFromDay === null || body.effectiveFromDay === ""
    ? null
    : parseCivilDay(body.effectiveFromDay, "vigencia del precio");
  const hash = payloadHash(["plan", concept, amountCents, String(unit), interval, nextDueDay, effectiveFromDay]);
  const replay = replayCheck(profile, operationId, hash);
  if (replay) return replay;
  const operation: OperationRecord = { operationId, kind: "plan_change", payloadHash: hash, at: ctx.now };
  const current = profile.plan;
  const frozen = lastFrozenRecurringDay(profile, charges, ctx.today);

  // Alta o reactivación tras finalizar: segmento nuevo, sin recuperar nada.
  if (!current || current.status === "ended") {
    if (!nextDueDay) throw new PaymentsError("START_REQUIRED", "Elige la fecha del primer vencimiento.", 400);
    const rule = validateRecurrence(unit, interval, nextDueDay);
    assertStartDay(nextDueDay, ctx.today, frozen);
    const plan: FeePlan = {
      status: "active",
      concept,
      currency: "EUR",
      unit: rule.unit,
      interval: rule.interval,
      anchorDay: nextDueDay,
      segment: (current?.segment ?? 0) + 1,
      prices: [{ fromDay: nextDueDay, amountCents, at: ctx.now, by: ctx.actorId }],
      materializedThrough: null,
      startedAt: ctx.now,
      pausedAt: null,
      endedAt: null,
      endReason: null,
      history: [
        ...(current?.history ?? []),
        history(ctx, current ? "reactivated" : "created", {
          amountCents,
          unit: rule.unit,
          interval: rule.interval,
          firstDueDay: nextDueDay,
        }),
      ],
    };
    return {
      mode: current ? "reactivate" : "create",
      changes: ["price", "schedule"],
      profile: withOperation(profile, plan, operation),
      priceFromDay: nextDueDay,
      nextDates: previewDates(plan, nextDueDay),
    };
  }

  const currentNext = nextPlanDue(current, ctx.today) ?? current.anchorDay;
  const scheduleChanged =
    unit !== current.unit || interval !== current.interval || (nextDueDay !== null && nextDueDay !== currentNext);
  const referenceDay = effectiveFromDay ?? currentNext;
  const priceChanged = !scheduleChanged && amountCents !== priceForDay(current, referenceDay);
  const conceptChanged = concept !== current.concept;

  if (current.status === "paused" && (scheduleChanged || priceChanged)) {
    throw new PaymentsError("PLAN_PAUSED", "La cuota está pausada: reanúdala para cambiar precio o calendario.", 409);
  }
  if (!scheduleChanged && !priceChanged && !conceptChanged) {
    return { mode: "noop", changes: [], profile, priceFromDay: null, nextDates: previewDates(current, ctx.today) };
  }

  const changes: PlanChangeKind[] = [];
  const entries: PlanHistoryEntry[] = [];
  let plan: FeePlan = { ...current, concept };
  let priceFromDay: CivilDay | null = null;

  if (scheduleChanged) {
    const start = nextDueDay ?? currentNext;
    const rule = validateRecurrence(unit, interval, start);
    assertStartDay(start, ctx.today, frozen);
    plan = {
      ...plan,
      unit: rule.unit,
      interval: rule.interval,
      anchorDay: start,
      segment: current.segment + 1,
      prices: [{ fromDay: start, amountCents, at: ctx.now, by: ctx.actorId }],
      materializedThrough: null,
    };
    priceFromDay = start;
    changes.push("schedule");
    if (amountCents !== priceForDay(current, start)) changes.push("price");
    entries.push(
      history(ctx, "rescheduled", {
        unit: rule.unit,
        interval: rule.interval,
        firstDueDay: start,
        amountCents,
      }),
    );
  } else if (priceChanged) {
    // El precio nuevo rige desde un vencimiento concreto, nunca hacia atrás.
    if (referenceDay < ctx.today || !isOccurrence(planRecurrence(current), referenceDay)) {
      throw new PaymentsError(
        "INVALID_EFFECTIVE_DAY",
        "El precio nuevo debe aplicarse desde un próximo vencimiento de la cuota.",
        422,
      );
    }
    plan = {
      ...plan,
      prices: [
        ...current.prices.filter((entry) => entry.fromDay < referenceDay),
        { fromDay: referenceDay, amountCents, at: ctx.now, by: ctx.actorId },
      ],
    };
    priceFromDay = referenceDay;
    changes.push("price");
    entries.push(
      history(ctx, "price_changed", {
        fromCents: priceForDay(current, referenceDay),
        toCents: amountCents,
        fromDay: referenceDay,
      }),
    );
  }
  if (conceptChanged) {
    changes.push("concept");
    entries.push(history(ctx, "concept_changed", { from: current.concept, to: concept }));
  }
  plan = { ...plan, history: [...current.history, ...entries] };
  return {
    mode: "update",
    changes,
    profile: withOperation(profile, plan, operation),
    priceFromDay,
    nextDates: plan.status === "active" ? previewDates(plan, ctx.today) : [],
  };
}

function simpleOperation(profile: PaymentProfile, kind: string, body: { operationId?: unknown }, parts: Array<string | number | null>, ctx: OpContextWithIds) {
  const operationId = parseOperationId(body.operationId);
  const hash = payloadHash([kind, ...parts]);
  const replay = replayCheck(profile, operationId, hash);
  return { replay, operation: { operationId, kind, payloadHash: hash, at: ctx.now } as OperationRecord };
}

export function pausePlan(profile: PaymentProfile, body: { operationId?: unknown }, ctx: OpContextWithIds): PlanChange {
  const { replay, operation } = simpleOperation(profile, "plan_pause", body, [], ctx);
  if (replay) return replay;
  const plan = profile.plan;
  if (!plan || plan.status !== "active") throw new PaymentsError("PLAN_NOT_ACTIVE", "No hay una cuota activa que pausar.", 409);
  const next: FeePlan = { ...plan, status: "paused", pausedAt: ctx.now, history: [...plan.history, history(ctx, "paused", {})] };
  return { mode: "update", changes: ["status"], profile: withOperation(profile, next, operation), priceFromDay: null, nextDates: [] };
}

export interface ResumeBody {
  nextDueDay?: unknown;
  amount?: unknown;
  operationId?: unknown;
}

// Reanudar no genera las cuotas del intervalo pausado: el entrenador elige la
// próxima fecha y desde ahí arranca un segmento nuevo.
export function resumePlan(profile: PaymentProfile, charges: Charge[], body: ResumeBody, ctx: OpContextWithIds): PlanChange {
  const nextDueDay = parseCivilDay(body.nextDueDay, "próximo vencimiento");
  const plan = profile.plan;
  const lastPrice = plan?.prices[plan.prices.length - 1]?.amountCents ?? 0;
  const amountCents = body.amount === undefined || body.amount === null || body.amount === "" ? lastPrice : parseAmountToCents(body.amount);
  const { replay, operation } = simpleOperation(profile, "plan_resume", body, [nextDueDay, amountCents], ctx);
  if (replay) return replay;
  if (!plan || plan.status !== "paused") throw new PaymentsError("PLAN_NOT_PAUSED", "La cuota no está pausada.", 409);
  assertStartDay(nextDueDay, ctx.today, lastFrozenRecurringDay(profile, charges, ctx.today));
  const next: FeePlan = {
    ...plan,
    status: "active",
    anchorDay: nextDueDay,
    segment: plan.segment + 1,
    prices: [{ fromDay: nextDueDay, amountCents, at: ctx.now, by: ctx.actorId }],
    materializedThrough: null,
    pausedAt: null,
    history: [...plan.history, history(ctx, "resumed", { nextDueDay, amountCents })],
  };
  return {
    mode: "update",
    changes: ["status"],
    profile: withOperation(profile, next, operation),
    priceFromDay: nextDueDay,
    nextDates: previewDates(next, nextDueDay),
  };
}

// Finalizar la regla ≠ cancelar cobros: la deuda y el historial se quedan.
export function endPlan(
  profile: PaymentProfile,
  body: { operationId?: unknown } | null,
  reason: "trainer" | "relation_ended",
  ctx: OpContextWithIds,
): PlanChange {
  const checked = body ? simpleOperation(profile, "plan_end", body, [reason], ctx) : null;
  if (checked?.replay) return checked.replay;
  const plan = profile.plan;
  if (!plan || plan.status === "ended") {
    return { mode: "noop", changes: [], profile, priceFromDay: null, nextDates: [] };
  }
  const next: FeePlan = {
    ...plan,
    status: "ended",
    endedAt: ctx.now,
    endReason: reason,
    pausedAt: null,
    history: [...plan.history, history(ctx, "ended", { reason })],
  };
  return {
    mode: "update",
    changes: ["status"],
    profile: withOperation(profile, next, checked?.operation ?? null),
    priceFromDay: null,
    nextDates: [],
  };
}
