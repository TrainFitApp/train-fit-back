const service = require("./remote-config-service");

async function getPublicStatus(req, res) {
  const clientVersion = String(req.query.version || "").trim();
  const clientPlatform = String(req.headers["x-client-platform"] || "").trim();

  const status = await service.getComputedStatus(clientVersion, clientPlatform);
  res.json(status);
}

async function getAdminConfig(req, res) {
  const config = await service.getRawConfig();
  res.json({ success: true, config });
}

async function updateAdminConfig(req, res) {
  try {
    const updatedBy = req.user?.email || req.user?.id || "";
    const config = await service.updateConfig(req.body || {}, updatedBy);
    res.json({ success: true, config });
  } catch (error) {
    if (error.statusCode === 400) {
      return res
        .status(400)
        .json({ success: false, message: error.message, errors: error.errors });
    }
    throw error;
  }
}

module.exports = { getPublicStatus, getAdminConfig, updateAdminConfig };
