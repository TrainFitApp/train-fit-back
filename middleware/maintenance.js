const remoteConfigService = require("../components/remoteConfig/remote-config-service");

const MANAGEMENT_CLIENT_FAMILY = "train-fit-management";
const PUBLIC_PATHS = ["/api/config", "/api/auth/login", "/api/auth/refresh"];

function isPublicPath(path) {
  return PUBLIC_PATHS.some((p) => path.startsWith(p));
}

async function maintenanceCheck(req, res, next) {
  const clientFamily = String(req.headers?.["x-client-family"] || "").trim();

  if (clientFamily === MANAGEMENT_CLIENT_FAMILY || isPublicPath(req.path)) {
    return next();
  }

  try {
    const config = await remoteConfigService.getRawConfig();
    const now = new Date();
    const maintenance = config?.maintenance || {};
    const status = remoteConfigService.calculateMaintenanceStatus(maintenance, now);

    if (status.state === "active") {
      return res.status(503).json({
        message: status.message || "Service unavailable due to maintenance",
        code: "MAINTENANCE_ACTIVE",
        maintenance: true,
      });
    }

    next();
  } catch (error) {
    console.error("[MAINTENANCE] check error:", error.message);
    next();
  }
}

module.exports = maintenanceCheck;
