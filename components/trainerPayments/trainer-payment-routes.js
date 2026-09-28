const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-payment-controller");
const { requirePaymentsAccess } = require("./trainer-payment-access");

// Montado bajo /trainer (routes/index.js). Solo el entrenador: el cliente no
// tiene ninguna ruta de escritura sobre cobros (su lectura es /coach/dashboard
// y sus avisos, /notifications/mine).
const router = express.Router();
const trainerOnly = auth(["trainer"]);

// Lectura del cliente activo o antiguo; cierre de deuda también para antiguos.
const read = requirePaymentsAccess({ allowFormer: true });
const settle = requirePaymentsAccess({ allowFormer: true, write: true });
// Solo con relación activa (y plaza escribible): cuotas, cobros nuevos, avisos.
const manage = requirePaymentsAccess({ write: true });
const preview = requirePaymentsAccess();

// --- Global ---
router.getAsync("/payments/summary", trainerOnly, controller.getSummary);
router.getAsync("/payments/overview", trainerOnly, controller.getOverview);
router.getAsync("/payments/settings", trainerOnly, controller.getSettings);
router.putAsync("/payments/settings", trainerOnly, controller.saveSettings);
router.postAsync("/payments/settings/preview", trainerOnly, controller.previewSettings);

// --- Por cliente ---
const base = "/payments/clients/:clientId";
router.getAsync(base, trainerOnly, read, controller.getLedger);
router.getAsync(`${base}/summary`, trainerOnly, read, controller.getClientSummary);
router.postAsync(`${base}/plan/preview`, trainerOnly, preview, controller.previewPlan);
router.putAsync(`${base}/plan`, trainerOnly, manage, controller.savePlan);
router.postAsync(`${base}/plan/pause`, trainerOnly, manage, controller.pausePlan);
router.postAsync(`${base}/plan/resume`, trainerOnly, manage, controller.resumePlan);
router.postAsync(`${base}/plan/end`, trainerOnly, settle, controller.endPlan);
router.putAsync(`${base}/preferences`, trainerOnly, manage, controller.setPreferences);
router.postAsync(`${base}/charges`, trainerOnly, manage, controller.createCharge);
router.getAsync(`${base}/charges/:chargeId`, trainerOnly, read, controller.getCharge);
router.patchAsync(`${base}/charges/:chargeId`, trainerOnly, settle, controller.editCharge);
router.postAsync(`${base}/charges/:chargeId/payments`, trainerOnly, settle, controller.registerPayment);
router.postAsync(`${base}/charges/:chargeId/payments/:paymentId/correct`, trainerOnly, settle, controller.correctPayment);
router.postAsync(`${base}/charges/:chargeId/cancel`, trainerOnly, settle, controller.cancelBalance);
router.postAsync(`${base}/charges/:chargeId/restore`, trainerOnly, settle, controller.restoreCancelled);

module.exports = router;
