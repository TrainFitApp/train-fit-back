// PURO: catálogo de la suscripción de entrenadores (decisión 2026-10-02). Única fuente de verdad
// de planes, plazas, precios y cupos; el backend JS lo lee compilado (.build/trainer-billing/catalog).
//
// Se paga por CAPACIDAD contratada, no por uso: plazas incluidas en el plan + plazas adicionales.
// Precios en céntimos de euro, sin IVA (Stripe lo añade al cobrar). El anual equivale a diez
// mensualidades, también en las plazas adicionales. Free solo vende plazas adicionales mensuales.

export type Tier = "free" | "starter" | "professional" | "scale";
export type Interval = "monthly" | "annual";
export type Mode = "test" | "live";
export type PriceKind = "base" | "seat";

export interface PlanDefinition {
  tier: Tier;
  includedSeats: number;
  // Capacidad total máxima (incluidas + adicionales). Más allá conviene el plan siguiente.
  maxSeats: number;
  // Cuota del plan por periodicidad; Free no tiene cuota.
  base: Partial<Record<Interval, number>>;
  // Precio por plaza adicional; Escala no vende plazas adicionales.
  seat: Partial<Record<Interval, number>>;
  // Cupo de la biblioteca de vídeos del entrenador. Frena abusos, no se vende aparte.
  libraryBytes: number;
}

const GB = 1024 * 1024 * 1024;

export const CATALOG: Record<Tier, PlanDefinition> = {
  free: { tier: "free", includedSeats: 3, maxSeats: 12, base: {}, seat: { monthly: 300 }, libraryBytes: 2 * GB },
  starter: { tier: "starter", includedSeats: 20, maxSeats: 40, base: { monthly: 2900, annual: 29000 },
    seat: { monthly: 100, annual: 1000 }, libraryBytes: 10 * GB },
  // 125 plazas en Profesional cuestan lo mismo que Escala con 150: no se vende más.
  professional: { tier: "professional", includedSeats: 50, maxSeats: 125, base: { monthly: 4900, annual: 49000 },
    seat: { monthly: 80, annual: 800 }, libraryBytes: 25 * GB },
  scale: { tier: "scale", includedSeats: 150, maxSeats: 150, base: { monthly: 10900, annual: 109000 }, seat: {},
    libraryBytes: 75 * GB },
};

export const TIERS: Tier[] = ["free", "starter", "professional", "scale"];
export const INTERVALS: Interval[] = ["monthly", "annual"];
export const FREE_SEATS = CATALOG.free.includedSeats;

// Lo que se contrata: plan, periodicidad y plazas adicionales. Free sin adicionales no es una suscripción.
export interface PlanState { tier: Tier; interval: Interval; extraSeats: number }

export function isTier(value: unknown): value is Tier { return typeof value === "string" && (TIERS as string[]).includes(value); }
export function isInterval(value: unknown): value is Interval { return value === "monthly" || value === "annual"; }
export function tierRank(tier: Tier | null | undefined): number { return tier ? TIERS.indexOf(tier) : -1; }

export function seatsOf(state: PlanState): number { return CATALOG[state.tier].includedSeats + state.extraSeats; }
export function maxExtraSeats(tier: Tier): number { return CATALOG[tier].maxSeats - CATALOG[tier].includedSeats; }

// Importe recurrente del estado (cuota + plazas adicionales), sin IVA.
export function recurringAmount(state: PlanState): number {
  const plan = CATALOG[state.tier];
  return (plan.base[state.interval] || 0) + (plan.seat[state.interval] || 0) * state.extraSeats;
}

// Estado que se puede contratar o al que se puede cambiar: periodicidad a la venta y plazas en rango.
export function purchasable(state: PlanState): boolean {
  const plan = CATALOG[state.tier];
  if (!plan || !isInterval(state.interval) || !Number.isSafeInteger(state.extraSeats) || state.extraSeats < 0) return false;
  if (state.extraSeats > maxExtraSeats(state.tier)) return false;
  if (state.extraSeats > 0 && plan.seat[state.interval] === undefined) return false;
  // Free es gratis: solo existe como suscripción si lleva plazas adicionales.
  if (state.tier === "free") return state.extraSeats > 0 && plan.seat[state.interval] !== undefined;
  return plan.base[state.interval] !== undefined;
}

export function sameState(a: PlanState | null | undefined, b: PlanState | null | undefined): boolean {
  return Boolean(a && b && a.tier === b.tier && a.interval === b.interval && a.extraSeats === b.extraSeats);
}

// Precio de Stripe de cada pieza del catálogo. La lookup key es la misma en sandbox y en real,
// así que no hay IDs de precio en la configuración; el script `stripe:catalog` los crea.
export function lookupKey(kind: PriceKind, tier: Tier, interval: Interval): string {
  return `trainfit_trainers_${tier}_${kind}_${interval}`;
}
export function catalogAmount(kind: PriceKind, tier: Tier, interval: Interval): number | undefined {
  return CATALOG[tier][kind][interval];
}
// Todas las piezas a la venta (para el script de catálogo y la comprobación previa).
export function catalogPrices(): Array<{ kind: PriceKind; tier: Tier; interval: Interval; amount: number }> {
  const result: Array<{ kind: PriceKind; tier: Tier; interval: Interval; amount: number }> = [];
  for (const tier of TIERS) {
    for (const kind of ["base", "seat"] as PriceKind[]) {
      for (const interval of INTERVALS) {
        const amount = catalogAmount(kind, tier, interval);
        if (amount !== undefined) result.push({ kind, tier, interval, amount });
      }
    }
  }
  return result;
}

// El prefijo de la clave decide el entorno: rk_live_ es real; sk_test_ y rk_test_, el sandbox.
export function billingModeFromKey(key: string | null | undefined): Mode | null {
  if (!key) return null;
  if (/^rk_live_/.test(key)) return "live";
  if (/^(rk|sk)_test_/.test(key)) return "test";
  return null;
}

export function libraryBytes(tier: Tier | null | undefined): number {
  return (tier && CATALOG[tier]?.libraryBytes) || CATALOG.free.libraryBytes;
}
