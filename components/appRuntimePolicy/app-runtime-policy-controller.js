const runtimePolicyService = require("./app-runtime-policy-service");

async function getRuntimeStatus(req, res) {
  const status = await runtimePolicyService.getRuntimeStatus(req);
  return res.send(status);
}

async function getRuntimePolicy(req, res) {
  const policy = await runtimePolicyService.getPolicy();
  return res.send(policy);
}

async function updateRuntimePolicy(req, res) {
  try {
    const policy = await runtimePolicyService.updatePolicy(req.body, {
      userId: req.auth?.userId || req.userData?.sub || null,
      email: req.auth?.email || req.userData?.email || null,
    });
    return res.send(policy);
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).send({
        message: error.message,
        currentPolicy: error.currentPolicy,
      });
    }

    console.error("[RuntimePolicy] update failed", error);
    return res.status(400).send({
      message: error?.message || "No se pudo actualizar el estado de la app",
    });
  }
}

module.exports = {
  getRuntimeStatus,
  getRuntimePolicy,
  updateRuntimePolicy,
};
