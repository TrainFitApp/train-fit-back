const service = require("./remote-config-service");

async function getPublicStatus(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

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
  const updatedBy = req.user?.email || req.user?.id || "";
  const config = await service.updateConfig(req.body || {}, updatedBy);
  res.json({ success: true, config });
}

module.exports = { getPublicStatus, getAdminConfig, updateAdminConfig };
