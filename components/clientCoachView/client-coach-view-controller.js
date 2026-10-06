const clientCoachViewService = require("./client-coach-view-service");

module.exports = {
  // GET /coach/dashboard — cliente autenticado (client-coach-view-service.js).
  async getDashboard(req, res) {
    return res.send(await clientCoachViewService.dashboard(req.auth.userId, req.auth.timeZone));
  },
};
