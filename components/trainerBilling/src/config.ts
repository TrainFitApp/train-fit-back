import { CATALOG, FREE_SEATS, INTERVALS, PlanState, TIERS, billingModeFromKey, isInterval, isTier, purchasable,
  recurringAmount, seatsOf } from "./catalog";
import { BillingError, Config, StateView } from "./types";

export const API_VERSION = "2026-08-26.dahlia" as const;

// Toda la configuración sale de cinco variables (decisión 2026-10-02): STRIPE_KEY (sin ella la
// facturación está apagada; su prefijo decide sandbox o real), STRIPE_WEBHOOK_SECRET,
// STRIPE_RETURN_URL, STRIPE_TERMS_URL y STRIPE_SUPPORT_EMAIL. Los precios se buscan en Stripe por
// lookup key y el IVA lo gestiona Managed Payments (Stripe vende como comerciante registrado).
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = (env.STRIPE_KEY || "").trim();
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET || "").trim();
  const returnUrl = (env.STRIPE_RETURN_URL || "http://localhost:8100").trim().replace(/\/$/, "");
  const termsUrl = (env.STRIPE_TERMS_URL || "").trim();
  const supportEmail = (env.STRIPE_SUPPORT_EMAIL || "").trim().toLowerCase();
  const mode = billingModeFromKey(key) || "test";
  const config: Config = { enabled: Boolean(key), mode, key, webhookSecret, returnUrl, termsUrl, supportEmail, errors: [] };
  if (!config.enabled) return config;
  const errors = config.errors;
  // Solo claves restringidas en real: una secreta daría mucho más de lo que la facturación necesita.
  if (!billingModeFromKey(key)) errors.push("INVALID_STRIPE_KEY");
  if (!webhookSecret.startsWith("whsec_")) errors.push("WEBHOOK_SECRET_REQUIRED");
  let origin: URL | null = null;
  try {
    origin = new URL(returnUrl);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) origin = null;
  } catch { origin = null; }
  const local = Boolean(origin && ["localhost", "127.0.0.1"].includes(origin.hostname));
  if (!origin || !["http:", "https:"].includes(origin.protocol)) errors.push("INVALID_RETURN_URL");
  else if (mode === "live" && (origin.protocol !== "https:" || local)) errors.push("HTTPS_RETURN_URL_REQUIRED");
  if (termsUrl && !validPublicUrl(termsUrl, mode)) errors.push("INVALID_TERMS_URL");
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) errors.push("INVALID_SUPPORT_EMAIL");
  if (mode === "live") {
    if (!termsUrl) errors.push("TERMS_URL_REQUIRED");
    if (!supportEmail) errors.push("SUPPORT_EMAIL_REQUIRED");
  }
  return config;
}

// Enlaces públicos: https siempre en real; en el sandbox también vale http local.
function validPublicUrl(value: string, mode: Config["mode"]): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return mode === "test" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch { return false; }
}

// Contacto y condiciones que ve el entrenador; vacío si no están configurados.
export function publicSupport(config: Config): { email: string | null; termsUrl: string | null } {
  return { email: config.supportEmail || null, termsUrl: config.termsUrl || null };
}

export function requireReady(config: Config): void {
  if (!config.enabled) throw new BillingError("BILLING_DISABLED", "Los pagos todavía no están habilitados.", 503);
  if (config.errors.length) throw new BillingError("BILLING_NOT_READY", "Falta completar la configuración de pagos.", 503);
}

// Plan, periodicidad y plazas adicionales pedidos por el navegador. Nunca importes ni precios.
export function parseTarget(input: unknown): PlanState {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const extraSeats = body.extraSeats === undefined ? 0 : body.extraSeats;
  const state = { tier: body.tier, interval: body.interval, extraSeats } as PlanState;
  if (!isTier(state.tier) || !isInterval(state.interval) || typeof extraSeats !== "number" || !purchasable(state)) {
    throw new BillingError("INVALID_PLAN", "Elige un plan, una periodicidad y un número de plazas válidos.", 400);
  }
  return state;
}

export function stateView(state: PlanState): StateView {
  return { tier: state.tier, interval: state.interval, extraSeats: state.extraSeats, seats: seatsOf(state), amount: recurringAmount(state) };
}

export function publicPlans(config: Config) {
  const ready = config.enabled && config.errors.length === 0;
  return { enabled: ready, mode: config.mode, currency: "EUR" as const, freeSeats: FREE_SEATS,
    capabilities: { checkout: ready, portal: ready, planChanges: ready },
    support: publicSupport(config),
    plans: TIERS.map((tier) => {
      const plan = CATALOG[tier];
      const intervals = INTERVALS.filter((interval) => tier === "free" ? plan.seat[interval] !== undefined : plan.base[interval] !== undefined);
      return { tier, includedSeats: plan.includedSeats, maxSeats: plan.maxSeats,
        prices: Object.fromEntries(intervals.map((interval) => [interval,
          { base: plan.base[interval] ?? 0, seat: plan.seat[interval] ?? null }])) };
    }),
  };
}
