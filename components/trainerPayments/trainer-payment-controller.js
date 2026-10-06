const service = require("./trainer-payment-service");
const overview = require("./trainer-payment-overview-service");
const reminders = require("./trainer-payment-reminder-service");

// Validación de entrada y reglas: en el núcleo (src/*.ts). Aquí solo HTTP.
function send(res, status, body) {
  res.set("Cache-Control", "no-store");
  return res.status(status).send(body);
}

function handler(action, status = 200) {
  return async (req, res) => {
    try {
      return send(res, status, await action(req));
    } catch (error) {
      if (error && error.name === "PaymentsError") {
        return send(res, error.status, { code: error.code, message: error.message, details: error.details || {} });
      }
      if (error && error.code === "PAYMENTS_CORE_UNAVAILABLE") {
        console.error("[TrainerPayments]", error.message);
        return send(res, 503, { code: "PAYMENTS_UNAVAILABLE", message: "Cobros no disponible temporalmente." });
      }
      console.error("[TrainerPayments] Error inesperado:", error && error.message);
      return send(res, 500, { message: "Internal Server Error" });
    }
  };
}

// Escritura: al terminar, la próxima lectura de avisos de la pareja (o de
// todos, si cambia la configuración) se pone al día sin esperar a su hito.
function write(action, status = 200) {
  return handler(async (req) => {
    const result = await action(req);
    reminders.invalidate(req.auth.userId, req.params.clientId || null);
    return result;
  }, status);
}

// Totales y lista global: con todas las cuotas y avisos del entrenador al día.
function upToDate(action) {
  return handler(async (req) => {
    await reminders.ensureTrainerUpToDate(req.auth.userId);
    return action(req);
  });
}

const trainer = (req) => req.auth.userId;
const params = (req) => [trainer(req), req.params.clientId];

module.exports = {
  handler,
  write,
  // Global (Configuración > Cobros)
  getSummary: upToDate((req) => overview.getDashboardSummary(trainer(req))),
  getOverview: upToDate((req) => overview.getOverview(trainer(req), req.query)),
  getSettings: handler((req) => overview.getSettings(trainer(req))),
  saveSettings: write((req) => overview.saveSettings(trainer(req), req.body)),
  previewSettings: handler((req) => overview.previewSettings(trainer(req), req.body)),

  // Por cliente
  getLedger: handler((req) => service.getClientLedger(...params(req), req.paymentsAccess)),
  getClientSummary: handler((req) => service.getClientSummary(...params(req), req.paymentsAccess)),
  previewPlan: handler((req) => service.previewPlan(...params(req), req.body)),
  savePlan: write((req) => service.savePlan(...params(req), req.body, trainer(req))),
  pausePlan: write((req) => service.pausePlan(...params(req), req.body, trainer(req))),
  resumePlan: write((req) => service.resumePlan(...params(req), req.body, trainer(req))),
  endPlan: write((req) => service.endPlan(...params(req), req.body, trainer(req))),
  setPreferences: write((req) => service.setPreferences(...params(req), req.body, trainer(req), req.paymentsAccess)),
  createCharge: write(async (req) => service.createOneOffCharge(...params(req), req.body, trainer(req)), 201),
  getCharge: handler((req) => service.getChargeDetail(...params(req), req.params.chargeId)),
  editCharge: write((req) => service.editCharge(...params(req), req.params.chargeId, req.body, trainer(req))),
  registerPayment: write((req) => service.registerPayment(...params(req), req.params.chargeId, req.body, trainer(req))),
  correctPayment: write((req) =>
    service.correctPayment(...params(req), req.params.chargeId, req.params.paymentId, req.body, trainer(req))
  ),
  cancelBalance: write((req) => service.cancelBalance(...params(req), req.params.chargeId, req.body, trainer(req))),
  restoreCancelled: write((req) => service.restoreCancelled(...params(req), req.params.chargeId, req.body, trainer(req))),
};
