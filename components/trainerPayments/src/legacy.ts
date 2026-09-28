import { Charge, ChargeRecord, Movement, PaymentsError } from "./types";
import { OpContextWithIds, balanceOf, commit, normalizeCharge, validMovements, PaymentInput } from "./ledger";

// PURO — convivencia con las apps anteriores (PATCH {paid:true|false}) y
// migración de los cobros planos a la forma nueva.

const LEGACY_CONFLICT_MESSAGE =
  "Este cobro tiene pagos parciales, correcciones o saldo anulado. Gestiónalo desde la versión actual de TrainFit Trainers.";

export type LegacyToggleDecision =
  | { kind: "noop" }
  | { kind: "pay"; input: PaymentInput }
  | { kind: "unmark"; movement: Movement };

// Solo se traduce lo que el contrato booleano puede representar sin perder
// información; el resto es un conflicto claro, nunca un borrado de historial.
export function legacyToggle(charge: Charge, paid: boolean, today: string): LegacyToggleDecision {
  if (charge.status === "void") throw new PaymentsError("LEGACY_CONFLICT", LEGACY_CONFLICT_MESSAGE, 409);
  if (paid) {
    if (charge.status === "settled") return { kind: "noop" }; // repetir no añade pagos ni mueve la fecha
    if (charge.status === "cancelled") throw new PaymentsError("LEGACY_CONFLICT", LEGACY_CONFLICT_MESSAGE, 409);
    const balance = balanceOf(charge);
    if (balance <= 0) throw new PaymentsError("LEGACY_CONFLICT", LEGACY_CONFLICT_MESSAGE, 409);
    return {
      kind: "pay",
      input: {
        amountCents: balance,
        receivedDay: today,
        method: "unknown",
        note: null,
        // Determinista por estado: dos PATCH iguales a la vez son la misma operación.
        operationId: `legacy-toggle:${charge.id}:${charge.revision}`,
      },
    };
  }
  if (charge.status === "open") return { kind: "noop" }; // ya figura como no pagado
  if (charge.status === "cancelled") throw new PaymentsError("LEGACY_CONFLICT", LEGACY_CONFLICT_MESSAGE, 409);
  const valid = validMovements(charge);
  const only = valid[0];
  if (valid.length === 1 && only && (only.source === "legacy_toggle" || only.source === "migration") && charge.cancelledCents === 0) {
    return { kind: "unmark", movement: only };
  }
  throw new PaymentsError("LEGACY_CONFLICT", LEGACY_CONFLICT_MESSAGE, 409);
}

// Deshacer un "pagado" del contrato antiguo: el movimiento queda anulado con
// su motivo (no se borra) y la deuda se reabre sin hitos retroactivos.
export function unmarkLegacyPayment(charge: Charge, movement: Movement, ctx: OpContextWithIds): Charge {
  const reason = "Desmarcado como pagado desde una versión anterior de la app";
  return commit(
    charge,
    {
      receivedCents: charge.receivedCents - movement.amountCents,
      payments: charge.payments.map((item) =>
        item.id === movement.id ? { ...item, status: "voided", voidedAt: ctx.now, voidedBy: ctx.actorId, voidReason: reason } : item,
      ),
      adjustments: [
        ...charge.adjustments,
        {
          id: ctx.newId(),
          type: "payment_corrected",
          at: ctx.now,
          by: ctx.actorId,
          reason,
          from: movement.amountCents,
          to: 0,
          operationId: null,
        },
      ],
    },
    ctx,
  );
}

// --- Migración ------------------------------------------------------------

// Anomalías que la migración NO convierte en silencio: se reportan y el
// documento queda en su forma antigua (se sigue leyendo, marcado para revisión).
export const BLOCKING_ANOMALIES: ReadonlyArray<string> = [
  "invalid_amount",
  "amount_precision",
  "non_eur_currency",
  "invalid_due_date",
  "ambiguous_due_date",
  "invalid_paid_at",
];

export interface MigrationPlan {
  action: "convert" | "skip";
  reason: "already_migrated" | "anomalies" | null;
  anomalies: string[];
  charge: Charge;
}

export function planMigration(record: ChargeRecord, migratedAt: Date): MigrationPlan {
  const normalized = normalizeCharge(record);
  if ((record.schemaVersion ?? 0) >= 2) {
    return { action: "skip", reason: "already_migrated", anomalies: normalized.anomalies, charge: normalized };
  }
  const blocking = normalized.anomalies.filter((anomaly) => BLOCKING_ANOMALIES.includes(anomaly));
  if (blocking.length) return { action: "skip", reason: "anomalies", anomalies: normalized.anomalies, charge: normalized };
  return {
    action: "convert",
    reason: null,
    anomalies: normalized.anomalies,
    charge: {
      ...normalized,
      revision: 1,
      dueRevision: 1,
      // La migración no envía avisos: ningún hito anterior a este instante.
      remindersFrom: migratedAt,
      persistedV2: true,
      legacy: normalized.legacy ? { ...normalized.legacy, migratedAt, migratedBy: "migration" } : null,
    },
  };
}

// Totales comparables antes/después, por divisa.
export interface LedgerTotals {
  charges: number;
  amountCents: number;
  receivedCents: number;
  pendingCents: number;
  movements: number;
}

export function ledgerTotals(charges: Charge[]): Record<string, LedgerTotals> {
  const byCurrency: Record<string, LedgerTotals> = {};
  for (const charge of charges) {
    if (charge.status === "void") continue;
    const totals = (byCurrency[charge.currency] ??= { charges: 0, amountCents: 0, receivedCents: 0, pendingCents: 0, movements: 0 });
    totals.charges += 1;
    totals.amountCents += charge.amountCents;
    totals.receivedCents += charge.receivedCents;
    totals.pendingCents += Math.max(0, balanceOf(charge));
    totals.movements += validMovements(charge).length;
  }
  return byCurrency;
}
