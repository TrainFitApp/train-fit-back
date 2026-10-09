const clientCoachViewService = require("./client-coach-view-service");

module.exports = {
  // GET /coach/dashboard — cliente autenticado (client-coach-view-service.js).
  async getDashboard(req, res) {
    return res.send(await clientCoachViewService.dashboard(req.auth.userId, req.auth.timeZone));
  },

  // GET /coach/plans — rutina y dieta de hoy, programadas y anteriores.
  async getPlans(req, res) {
    return res.send(await clientCoachViewService.plans(req.auth.userId, req.auth.timeZone));
  },

  // GET /coach/professionals/:trainerId/payments — lo que le cobra ese
  // profesional (solo si trabaja con él ahora). Sin el núcleo de cobros
  // compilado, 503 como en /trainer/payments.
  async getProfessionalPayments(req, res) {
    try {
      const view = await clientCoachViewService.professionalPayments(req.auth.userId, req.params.trainerId);
      if (!view) return res.status(404).send({ message: "No trabajas con este profesional." });
      return res.send(view);
    } catch (error) {
      if (error?.code === "PAYMENTS_CORE_UNAVAILABLE") {
        return res.status(503).send({ code: "PAYMENTS_UNAVAILABLE", message: "Cobros no disponible temporalmente." });
      }
      throw error;
    }
  },
};
