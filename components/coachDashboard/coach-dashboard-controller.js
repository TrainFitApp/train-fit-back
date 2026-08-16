const coachDashboardService = require("./coach-dashboard-service");

module.exports = {
  async getDashboard(req, res) {
    const dashboard = await coachDashboardService.getDashboard(req.user.id);
    return res.send(dashboard);
  },
};
