const express = require("@awaitjs/express");
const controller = require("./app-version-controller");
const runtimePolicyController = require("../appRuntimePolicy/app-runtime-policy-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

router.get("/version", controller.getAppVersion);
router.getAsync("/runtime-status", runtimePolicyController.getRuntimeStatus);
router.getAsync(
  "/runtime-policy",
  auth(["admin"]),
  runtimePolicyController.getRuntimePolicy
);
router.putAsync(
  "/runtime-policy",
  auth(["admin"]),
  runtimePolicyController.updateRuntimePolicy
);

module.exports = router;
