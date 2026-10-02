import { Config, Financed, FundingRole, Interval, Tier } from "./types";

// PURO: qué compró cada pago, deducido de las líneas de su factura de Stripe.
// Sirve para decidir qué derechos dependen de un cobro reembolsado o disputado.
// Ante cualquier forma no reconocida devuelve "unknown": nunca se retira acceso
// a ciegas (decisión 2026-09-28: sin certeza, revisión manual).

export interface FinancingLine {
  amount: number; priceId: string | null; proration: boolean;
  subscriptionItem: string | null; periodStart: number; periodEnd: number;
}
export interface FinancingInvoice {
  id: string; subscriptionId: string | null; customerId: string | null; billingReason: string | null;
  amountPaid: number; currency: string; lines: FinancingLine[];
}

const TIER_RANK: Record<Tier, number> = { trainer_pro: 1, trainer_growth: 2, trainer_scale: 3 };
export function tierRank(tier: Tier | null | undefined): number { return tier ? TIER_RANK[tier] || 0 : 0; }

export function planForPrice(config: Config, priceId: string | null): { tier: Tier; interval: Interval } | null {
  if (!priceId) return null;
  for (const plan of config.plans) {
    for (const price of Object.values(plan.prices)) if (price.id === priceId) return { tier: plan.tier, interval: price.interval };
  }
  return null;
}

export function unknownFinanced(partial: Partial<Financed> = {}): Financed {
  return { kind: "unknown", invoiceId: null, subscriptionId: null, customerId: null, tier: null, interval: null, priceId: null,
    fromTier: null, fromInterval: null, fromPriceId: null, periodStart: 0, periodEnd: 0, amountPaid: 0, currency: "eur", ...partial };
}

export function classifyInvoice(config: Config, invoice: FinancingInvoice): Financed {
  const base: Partial<Financed> = { invoiceId: invoice.id, subscriptionId: invoice.subscriptionId, customerId: invoice.customerId,
    amountPaid: invoice.amountPaid, currency: invoice.currency };
  const known = invoice.lines.filter((line) => planForPrice(config, line.priceId));
  const financed = (kind: Financed["kind"], line: FinancingLine, credit?: FinancingLine): Financed => {
    const plan = planForPrice(config, line.priceId)!;
    const previous = credit ? planForPrice(config, credit.priceId) : null;
    return unknownFinanced({ ...base, kind, tier: plan.tier, interval: plan.interval, priceId: line.priceId,
      fromTier: previous?.tier ?? null, fromInterval: previous?.interval ?? null, fromPriceId: credit?.priceId ?? null,
      periodStart: line.periodStart, periodEnd: line.periodEnd });
  };
  if (invoice.billingReason === "subscription_create" || invoice.billingReason === "subscription_cycle") {
    const periods = known.filter((line) => !line.proration && line.amount >= 0);
    // Un periodo de este catálogo tiene exactamente una línea de plan y ningún prorrateo.
    if (periods.length !== 1 || known.some((line) => line.proration)) return unknownFinanced(base);
    return financed("period", periods[0]!);
  }
  if (invoice.billingReason === "subscription_update") {
    const charges = known.filter((line) => line.amount > 0);
    const credits = known.filter((line) => line.amount < 0);
    if (charges.length !== 1 || credits.length > 1) return unknownFinanced(base);
    const charge = charges[0]!;
    const credit = credits[0];
    if (!credit) return charge.proration ? unknownFinanced(base) : financed("period", charge);
    const to = planForPrice(config, charge.priceId)!;
    const from = planForPrice(config, credit.priceId)!;
    // Las dos únicas formas que genera Trainers: subida en la misma periodicidad y mensual → anual.
    if (to.interval === from.interval) return tierRank(to.tier) > tierRank(from.tier) ? financed("upgrade", charge, credit) : unknownFinanced(base);
    return from.interval === "monthly" && to.interval === "annual" ? financed("interval_change", charge, credit) : unknownFinanced(base);
  }
  return unknownFinanced(base);
}

// Relación del pago con el acceso de hoy. "unknown" siempre que no haya certeza.
export function fundingRole(financed: Financed, current: { subscriptionId?: string | null; tier?: Tier | null; interval?: Interval | null },
  nowSeconds: number): FundingRole {
  if (financed.kind === "unknown" || !financed.periodEnd) return "unknown";
  if (financed.periodEnd <= nowSeconds) return "past";
  if (!financed.subscriptionId || financed.subscriptionId !== current.subscriptionId || financed.periodStart > nowSeconds) return "unknown";
  if (financed.kind === "upgrade") {
    // Una subida posterior ya la sustituyó: no se sabe qué derechos quedan.
    return financed.tier === current.tier && financed.interval === current.interval ? "current_upgrade" : "unknown";
  }
  return "current_period";
}
