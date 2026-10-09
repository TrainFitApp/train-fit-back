const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./client-coach-view-controller");

const router = express.Router();

router.getAsync("/coach/dashboard", auth(["user", "admin"]), controller.getDashboard);
router.getAsync("/coach/plans", auth(["user", "admin"]), controller.getPlans);
router.getAsync("/coach/professionals/:trainerId/payments", auth(["user", "admin"]), controller.getProfessionalPayments);

module.exports = router;
