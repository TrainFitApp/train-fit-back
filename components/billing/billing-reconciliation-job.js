const cron = require("node-cron");
const billingService = require("./billing-service");

// Red de seguridad para usuarios cuyo webhook de expiración de RevenueCat
// nunca llegó (caída de entrega, secreto mal configurado, timeout, etc.) y
// que no han vuelto a abrir la app para que el self-heal lazy (dto/reconcileExpiredPremiumIfNeeded)
// los corrija. Por defecto corre una vez al día (04:00); configurable via
// BILLING_RECONCILIATION_CRON. Es un backstop de un fallo raro, no un
// mecanismo de tiempo real, así que no necesita más frecuencia que esta.
const SCHEDULE = process.env.BILLING_RECONCILIATION_CRON || "0 4 * * *";

let task = null;

function start() {
  if (task) return task;

  task = cron.schedule(SCHEDULE, () => {
    billingService.runExpiredPremiumReconciliation().catch((error) => {
      console.error("[BillingReconciliation] Job failed", error);
    });
  });

  console.log(`[BillingReconciliation] Scheduled job started (${SCHEDULE})`);
  return task;
}

module.exports = { start };
