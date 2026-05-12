const runtimePolicyService = require("../components/appRuntimePolicy/app-runtime-policy-service");

function sendMaintenanceResponse(res, status) {
  const retryAfter = Number(status.maintenance.retryAfterSeconds || 0);
  if (retryAfter > 0) {
    res.set("Retry-After", String(retryAfter));
  }

  return res.status(503).send({
    code: "MAINTENANCE_MODE",
    message: status.maintenance.message,
    runtimeStatus: status,
  });
}

function sendUpdateRequiredResponse(res, status) {
  return res.status(426).send({
    code: "UPDATE_REQUIRED",
    message: status.updateRequired.message,
    runtimeStatus: status,
  });
}

async function runtimePolicy(req, res, next) {
  try {
    if (runtimePolicyService.isManagementClient(req)) {
      return next();
    }

    const status = await runtimePolicyService.getRuntimeStatus(req);

    if (status.maintenance.applies) {
      return sendMaintenanceResponse(res, status);
    }

    if (status.updateRequired.applies) {
      return sendUpdateRequiredResponse(res, status);
    }

    return next();
  } catch (error) {
    console.warn("[RuntimePolicy] fail-open", error?.message || error);
    return next();
  }
}

module.exports = runtimePolicy;
