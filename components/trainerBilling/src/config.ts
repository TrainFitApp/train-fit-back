import { BillingError, Config, Interval, Mode, Plan, PlanPrice, TaxPolicy, Tier } from "./types";

export const API_VERSION = "2026-08-26.dahlia" as const;
const CATALOG: Array<{ tier: Tier; clients: number; monthly: number; annual: number; env: string }> = [
  { tier: "trainer_pro", clients: 20, monthly: 2900, annual: 29700, env: "PRO" },
  { tier: "trainer_growth", clients: 50, monthly: 4900, annual: 50900, env: "GROWTH" },
  { tier: "trainer_scale", clients: 150, monthly: 11900, annual: 120900, env: "SCALE" },
];

const TAX_POLICIES: TaxPolicy[] = ["test_no_tax", "stripe_tax", "managed_payments"];

// Nothing is inferred: live requires an explicit mode, a restricted live key,
// an HTTPS frontend and VAT charged on top (decision 2026-09-21), either with
// Stripe Tax or with Managed Payments as merchant of record (2026-10-01).
// The sandbox keeps its own guard rails and can never run on a production node.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const enabled = env.TRAINER_BILLING_ENABLED === "1";
  const key = env.STRIPE_KEY || "";
  const frontendUrl = (env.TRAINER_BILLING_FRONTEND_URL || "http://localhost:8100").replace(/\/$/, "");
  const rawTax = env.TRAINER_BILLING_TAX_POLICY || "pending";
  const taxPolicy: TaxPolicy = (TAX_POLICIES as string[]).includes(rawTax) ? rawTax as TaxPolicy : "pending";
  const rawMode = env.TRAINER_BILLING_MODE || "test";
  const mode: Mode = rawMode === "live" ? "live" : "test";
  const plans: Plan[] = CATALOG.map((p) => ({
    tier: p.tier, clientLimit: p.clients,
    prices: {
      monthly: { id: env[`STRIPE_TRAINER_${p.env}_MONTHLY_PRICE_ID`] || "", amount: p.monthly, interval: "monthly" },
      annual: { id: env[`STRIPE_TRAINER_${p.env}_ANNUAL_PRICE_ID`] || "", amount: p.annual, interval: "annual" },
    },
  }));
  const errors: string[] = [];
  if (!["test", "live"].includes(rawMode)) errors.push("INVALID_MODE");
  if (!(env.STRIPE_WEBHOOK_SECRET || "").startsWith("whsec_")) errors.push("WEBHOOK_SECRET_REQUIRED");
  if (taxPolicy === "pending") errors.push("TAX_POLICY_REQUIRED");
  let origin: URL | null = null;
  try {
    origin = new URL(frontendUrl);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) origin = null;
  } catch { origin = null; }
  const local = Boolean(origin && ["localhost", "127.0.0.1"].includes(origin.hostname));
  if (mode === "live") {
    // Restricted keys only: a secret key would grant far more than billing needs.
    if (!/^rk_live_/.test(key)) errors.push("LIVE_RESTRICTED_KEY_REQUIRED");
    if (taxPolicy !== "stripe_tax" && taxPolicy !== "managed_payments") errors.push("LIVE_TAX_POLICY_REQUIRED");
    if (!origin || origin.protocol !== "https:" || local) errors.push("HTTPS_FRONTEND_ORIGIN_REQUIRED");
  } else {
    if (env.NODE_ENV === "production") errors.push("TEST_MODE_IN_PRODUCTION");
    if (!/^(rk|sk)_test_/.test(key)) errors.push("TEST_KEY_REQUIRED");
    if (!origin || !local || !["http:", "https:"].includes(origin.protocol)) errors.push("LOCAL_FRONTEND_ORIGIN_REQUIRED");
  }
  const prices = plans.flatMap((p) => Object.values(p.prices));
  if (prices.some((p) => !/^price_[A-Za-z0-9]+$/.test(p.id))) errors.push("PRICE_CATALOG_REQUIRED");
  if (new Set(prices.map((p) => p.id)).size !== prices.length) errors.push("DUPLICATE_PRICES");
  // Decisiones 2026-09-28: métodos de pago gestionados con una configuración propia de Stripe,
  // condiciones de contratación aceptadas en Checkout y buzón de facturación visible.
  // En live son obligatorios; en el sandbox, opcionales (si se indican, deben ser válidos).
  const paymentMethodConfiguration = (env.STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID || "").trim();
  const termsUrl = (env.TRAINER_BILLING_TERMS_URL || "").trim();
  const supportEmail = (env.TRAINER_BILLING_SUPPORT_EMAIL || "").trim().toLowerCase();
  if (paymentMethodConfiguration && !/^pmc_[A-Za-z0-9]+$/.test(paymentMethodConfiguration)) errors.push("INVALID_PAYMENT_METHOD_CONFIGURATION");
  if (termsUrl && !validPublicUrl(termsUrl, mode)) errors.push("INVALID_TERMS_URL");
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) errors.push("INVALID_SUPPORT_EMAIL");
  if (mode === "live") {
    // Con Managed Payments los métodos de pago los elige Stripe: no admite una configuración propia.
    if (!paymentMethodConfiguration && taxPolicy !== "managed_payments") errors.push("PAYMENT_METHOD_CONFIGURATION_REQUIRED");
    if (!termsUrl) errors.push("TERMS_URL_REQUIRED");
    if (!supportEmail) errors.push("SUPPORT_EMAIL_REQUIRED");
  }
  return { enabled, mode, key, webhookSecret: env.STRIPE_WEBHOOK_SECRET || "", frontendUrl,
    portalConfiguration: env.STRIPE_TRAINER_PORTAL_CONFIGURATION_ID || "", paymentMethodConfiguration, termsUrl, supportEmail,
    taxPolicy, errors, plans };
}

// Enlaces públicos: https siempre en live; en el sandbox también vale http local.
function validPublicUrl(value: string, mode: Mode): boolean {
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
  if (config.errors.length) throw new BillingError("BILLING_NOT_READY", "Falta completar la configuración de pagos de prueba.", 503);
}

export function resolvePrice(config: Config, tier: unknown, interval: unknown): { plan: Plan; price: PlanPrice } {
  const canonical = typeof tier === "string" ? tier : "";
  const plan = config.plans.find((p) => p.tier === canonical);
  if (!plan || (interval !== "monthly" && interval !== "annual")) {
    throw new BillingError("INVALID_PLAN", "Selecciona un plan y una periodicidad válidos.", 400);
  }
  return { plan, price: plan.prices[interval as Interval] };
}

export function publicPlans(config: Config) {
  const ready = config.enabled && config.errors.length === 0;
  return { enabled: ready, mode: config.mode, currency: "EUR", taxPolicy: config.taxPolicy,
    capabilities: { checkout: ready, portal: ready && Boolean(config.portalConfiguration), planChanges: ready },
    support: publicSupport(config),
    plans: config.plans.map((p) => ({ tier: p.tier, clientLimit: p.clientLimit, prices: {
      monthly: { amount: p.prices.monthly.amount, interval: "monthly" },
      annual: { amount: p.prices.annual.amount, interval: "annual" },
    } })),
  };
}
