import { Config, BillingError, Account, Notifier } from "./types";
import { loadConfig, publicSupport, requireReady } from "./config";
import { LegacyUsers, MongoRepository } from "./mongo-repository";
import { TrainerBillingService, accessUntil, annualRenewalWindow, effectiveAccess } from "./service";
import { StripeGateway } from "./stripe-gateway";

export function createRuntime(users: LegacyUsers, notifier?: Notifier) {
  const config = loadConfig();
  const repository = new MongoRepository(users, config.mode);
  // No network operation is allowed until requireReady; this placeholder is not a credential.
  const gateway = new StripeGateway({ ...config, key: config.key || "unconfigured" });
  const service = new TrainerBillingService(config, repository, gateway, notifier);
  let timer: NodeJS.Timeout | undefined;
  let reconciling = false;
  return {
    config, service, repository,
    async webhook(body: Buffer, signature: string) {
      requireReady(config);
      if (!Buffer.isBuffer(body) || typeof signature !== "string") throw new BillingError("INVALID_SIGNATURE", "Firma de webhook inválida.", 400);
      const record = gateway.verifyEvent(body, signature);
      return record ? service.event(record) : { received: true };
    },
    startReconciliation() {
      if (timer || !config.enabled || config.errors.length) return;
      timer = setInterval(() => {
        if (reconciling) return;
        reconciling = true;
        void service.reconcile().catch(() => {
          console.error("[TrainerBilling] Reconciliation failed; pending work will be retried.");
        }).finally(() => { reconciling = false; });
      }, 60000);
      timer.unref();
    },
    stopReconciliation() { if (timer) clearInterval(timer); timer = undefined; },
  };
}

// Aviso en la app de la renovación anual (a partir de 30 días), con la misma regla que el correo.
function renewalNotice(account: Account | null, now: Date) {
  const window = account ? annualRenewalWindow(account, now) : null;
  return window ? { at: window.at, amount: account!.renewal?.amount ?? null, daysLeft: Math.ceil(window.days) } : null;
}

export function billingMetadata(config: Config, account: Account | null, source: string | null) {
  const enabled = config.enabled && config.errors.length === 0;
  const now = new Date();
  const plan = config.plans.find((entry) => entry.tier === account?.tier);
  const price = account?.interval && plan?.prices[account.interval];
  const currentPrice = plan && price ? { tier: plan.tier, interval: price.interval, amount: price.amount, clientLimit: plan.clientLimit } : null;
  const mutable = enabled && source === "stripe" && Boolean(account?.subscriptionId && !account.deletedAt &&
    !["canceled", "incomplete_expired"].includes(account.status));
  const change = account?.change;
  const pendingChange = change?.status === "scheduled" ? { tier: change.quote.to.tier, interval: change.quote.to.interval,
    effectiveAt: change.quote.effectiveAt, clientLimit: change.quote.to.clientLimit } : null;
  const pendingPayment = account?.pendingPayment || null;
  const invoiceSettled = account?.provider?.latestInvoiceStatus === "paid" || (change?.status === "discarded" &&
    change.invoiceId === account?.provider?.latestInvoiceId && account?.provider?.latestInvoiceStatus === "void");
  // Our own schedule (pending or already applied) may be replaced by a new choice.
  const ownSchedule = Boolean(account?.provider?.scheduleId) && change?.scheduleId === account?.provider?.scheduleId &&
    ["scheduled", "applied"].includes(change?.status || "");
  const hold = account?.hold || null;
  const canChange = mutable && !hold && account?.status === "active" && Boolean(account.paidUntil && new Date(account.paidUntil) > now) &&
    invoiceSettled && !account.cancelAtPeriodEnd && (!pendingChange || ownSchedule) && !pendingPayment &&
    !account.provider?.pendingUpdate && change?.status !== "processing" &&
    (!account.provider?.scheduleId || ownSchedule);
  const renewalPlan = config.plans.find((entry) => Object.values(entry.prices).some((p) => p.id === account?.renewal?.priceId));
  const renewalPrice = renewalPlan && Object.values(renewalPlan.prices).find((p) => p.id === account?.renewal?.priceId);
  const renewal = account?.renewal && !account.cancelAtPeriodEnd
    ? { at: account.renewal.at, amount: account.renewal.amount, source: "stripe" as const,
      // Plan que cobrará Stripe (puede ser el de un cambio programado) y si lleva descuento o saldo a favor.
      tier: renewalPlan?.tier || null, interval: renewalPrice?.interval || null,
      discounted: typeof account.renewal.subtotal === "number" && account.renewal.amount < account.renewal.subtotal } : null;
  // Con los cobros en pausa no se ofrece pagar la factura pendiente: la decisión es de facturación.
  const renewalPayment = account?.renewalPayment && !hold
    ? { url: account.renewalPayment.url || null, amount: account.renewalPayment.amount,
      graceUntil: account.status === "past_due" ? accessUntil(account) : null } : null;
  const access = account ? effectiveAccess(account, now) : null;
  return { provider: source, status: account?.status || null,
    cancelAtPeriodEnd: account?.cancelAtPeriodEnd || false,
    currentPeriodEnd: account?.currentPeriodEnd || null,
    billing: { enabled, mode: config.mode, taxPolicy: config.taxPolicy,
      portalAvailable: enabled && Boolean(account?.customerId && config.portalConfiguration && !account.deletedAt), planChanges: enabled,
      currentPrice, pendingChange, pendingPayment, renewal, renewalPayment,
      paidUntil: account?.paidUntil || null,
      admissionClientLimit: currentPrice ? Math.min(currentPrice.clientLimit, pendingChange ? change!.quote.to.clientLimit : currentPrice.clientLimit) : 3,
      // Cobros en pausa (incidencia con un pago o decisión de facturación): el acceso pagado se mantiene.
      hold: hold ? { since: hold.since } : null,
      // Acceso concedido por TrainFit hasta una fecha (no es un cobro).
      accessException: access?.basis === "exception" && access.exception ? { until: access.exception.until, tier: access.exception.tier } : null,
      // Periodo cuyo pago se perdió en una disputa: sin acceso de pago hasta esa fecha.
      accessRevokedUntil: access?.revokedUntil || null,
      renewalNotice: renewalNotice(account, now),
      support: publicSupport(config),
      actions: { canChange: Boolean(canChange), canCancel: mutable && !account?.cancelAtPeriodEnd,
        canResume: mutable && Boolean(account?.cancelAtPeriodEnd),
        canDiscardChange: mutable && Boolean(pendingChange || pendingPayment) } },
  };
}
