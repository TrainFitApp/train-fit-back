import { PlanState, sameState } from "./catalog";
import { Account, Financed, FinancingInvoice, FundingRole, PriceRef } from "./types";

// PURO: qué compró cada pago, deducido de su factura de Stripe y del cambio que registró Trainers.
// Sirve para decidir qué derechos dependen de un cobro reembolsado o disputado. Ante cualquier
// forma no reconocida devuelve "unknown": nunca se retira acceso a ciegas (decisión 2026-09-28).

export function unknownFinanced(partial: Partial<Financed> = {}): Financed {
  return { kind: "unknown", invoiceId: null, subscriptionId: null, customerId: null, state: null, fromState: null,
    periodStart: 0, periodEnd: 0, amountPaid: 0, currency: "eur", ...partial };
}

// Estado que describen la cuota y la plaza adicional de un periodo (cantidad 0 = sin plazas).
interface Part { price: PriceRef | null; quantity: number }
export function stateFromLines(base: Part | undefined, seat: Part | undefined): PlanState | null {
  const seats = seat && seat.quantity > 0 ? seat : undefined;
  if (!base && !seats) return null;
  if (base && base.quantity !== 1) return null;
  if (base && seats && (base.price!.tier !== seats.price!.tier || base.price!.interval !== seats.price!.interval)) return null;
  if (!base && seats!.price!.tier !== "free") return null;
  const anchor = (base || seats)!.price!;
  return { tier: anchor.tier, interval: anchor.interval, extraSeats: seats ? seats.quantity : 0 };
}

export function classifyInvoice(invoice: FinancingInvoice, account: Pick<Account, "change"> | null): Financed {
  const base: Partial<Financed> = { invoiceId: invoice.id, subscriptionId: invoice.subscriptionId, customerId: invoice.customerId,
    amountPaid: invoice.amountPaid, currency: invoice.currency };
  const known = invoice.lines.filter((line) => line.price);
  if (invoice.billingReason === "subscription_create" || invoice.billingReason === "subscription_cycle") {
    const periods = known.filter((line) => !line.proration && line.amount >= 0);
    const bases = periods.filter((line) => line.price!.kind === "base");
    const seats = periods.filter((line) => line.price!.kind === "seat" && line.quantity > 0);
    const state = bases.length <= 1 && seats.length <= 1 ? stateFromLines(bases[0], seats[0]) : null;
    // Un periodo tiene su cuota y sus plazas; solo admite además prorratas de plazas del periodo
    // anterior (plazas adicionales mensuales que se cobran en la renovación).
    const prorations = known.filter((line) => line.proration);
    if (!state || prorations.some((line) => line.price!.kind !== "seat")) return unknownFinanced(base);
    const anchor = (bases[0] || seats[0])!;
    return unknownFinanced({ ...base, kind: "period", state, periodStart: anchor.periodStart, periodEnd: anchor.periodEnd });
  }
  // Un cobro a mitad de periodo solo se entiende si es el del cambio que registró Trainers.
  const change = account?.change;
  if (invoice.billingReason === "subscription_update" && change?.invoiceId === invoice.id && change.quote.kind === "immediate") {
    const charges = known.filter((line) => line.amount > 0);
    if (!charges.length) return unknownFinanced(base);
    const { from, to } = change.quote;
    const state = { tier: to.tier, interval: to.interval, extraSeats: to.extraSeats };
    const fromState = { tier: from.tier, interval: from.interval, extraSeats: from.extraSeats };
    return unknownFinanced({ ...base, kind: from.interval === to.interval ? "upgrade" : "interval_change", state, fromState,
      periodStart: Math.min(...charges.map((line) => line.periodStart)), periodEnd: Math.max(...charges.map((line) => line.periodEnd)) });
  }
  return unknownFinanced(base);
}

// Relación del pago con el acceso de hoy. "unknown" siempre que no haya certeza.
export function fundingRole(financed: Financed, current: { subscriptionId?: string | null; state: PlanState | null },
  nowSeconds: number): FundingRole {
  if (financed.kind === "unknown" || !financed.periodEnd) return "unknown";
  if (financed.periodEnd <= nowSeconds) return "past";
  if (!financed.subscriptionId || financed.subscriptionId !== current.subscriptionId || financed.periodStart > nowSeconds) return "unknown";
  // Una subida posterior ya la sustituyó: no se sabe qué derechos quedan.
  if (financed.kind === "upgrade") return sameState(financed.state, current.state) ? "current_upgrade" : "unknown";
  return "current_period";
}
