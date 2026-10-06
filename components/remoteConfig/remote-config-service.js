const semver = require("semver");
const { badRequest } = require("../util/http-error");
const dao = require("./remote-config-dao");

const CACHE_TTL_MS = 45 * 1000;
let cachedConfig = null;
let cacheExpiresAt = 0;

async function getCachedRawConfig() {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiresAt) {
    return cachedConfig;
  }

  cachedConfig = await dao.getConfig();
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedConfig;
}

function invalidateCache() {
  cachedConfig = null;
  cacheExpiresAt = 0;
}

// Estados: 'normal' | 'warning' | 'active'.
// startAt/endAt se evalúan de forma independiente (no como par obligatorio):
// un startAt futuro sin endAt no debe leerse como "activo ahora mismo".
function calculateMaintenanceStatus(maintenance, now = new Date()) {
  if (!maintenance || !maintenance.enabled) {
    return { state: "normal" };
  }

  const startAt = maintenance.startAt ? new Date(maintenance.startAt) : null;
  const endAt = maintenance.endAt ? new Date(maintenance.endAt) : null;
  const warningFrom = maintenance.warningFrom
    ? new Date(maintenance.warningFrom)
    : null;

  // Ventana pasada: autolimpia aunque `enabled` siga true.
  if (endAt && now > endAt) {
    return { state: "normal" };
  }

  if (startAt && now < startAt) {
    if (warningFrom && now >= warningFrom) {
      return {
        state: "warning",
        message: maintenance.warningMessage || "",
        startAt: startAt.toISOString(),
      };
    }
    return { state: "normal" };
  }

  // enabled=true, y (sin startAt, o now >= startAt), y no pasado endAt.
  return { state: "active", message: maintenance.message || "" };
}

function getMinVersionForPlatform(forceUpdate, platform) {
  if (!forceUpdate) return "";
  if (platform === "ios") return forceUpdate.minVersionIos || "";
  if (platform === "android") return forceUpdate.minVersionAndroid || "";
  if (platform === "web") return forceUpdate.minVersionWeb || "";
  return "";
}

// Fail-open: cualquier dato ausente/invalido nunca bloquea la app.
function calculateForceUpdate(forceUpdate, clientVersion, clientPlatform) {
  const minVersion = getMinVersionForPlatform(forceUpdate, clientPlatform);

  if (
    !minVersion ||
    !semver.valid(minVersion) ||
    !clientVersion ||
    !semver.valid(clientVersion)
  ) {
    return { required: false };
  }

  const required = semver.lt(clientVersion, minVersion);
  if (!required) return { required: false };

  return { required: true, message: forceUpdate.message || "", minVersion };
}

async function getComputedStatus(clientVersion, clientPlatform) {
  const config = await getCachedRawConfig();
  const now = new Date();

  return {
    maintenance: calculateMaintenanceStatus(config.maintenance, now),
    forceUpdate: calculateForceUpdate(
      config.forceUpdate,
      clientVersion,
      clientPlatform
    ),
  };
}

async function getRawConfig() {
  return dao.getConfig();
}

// Devuelve un array de mensajes de error; vacío = válido.
function validateConfigPatch(patch) {
  const errors = [];
  const maintenance = patch.maintenance || {};
  const forceUpdate = patch.forceUpdate || {};

  const startAt = maintenance.startAt ? new Date(maintenance.startAt) : null;
  const endAt = maintenance.endAt ? new Date(maintenance.endAt) : null;
  const warningFrom = maintenance.warningFrom
    ? new Date(maintenance.warningFrom)
    : null;

  if (warningFrom && !startAt) {
    errors.push("warningFrom requiere que startAt esté definido");
  }
  if (endAt && !startAt) {
    errors.push("endAt requiere que startAt esté definido");
  }
  if (startAt && endAt && startAt >= endAt) {
    errors.push("startAt debe ser anterior a endAt");
  }
  if (warningFrom && startAt && warningFrom >= startAt) {
    errors.push("warningFrom debe ser anterior a startAt");
  }

  if (forceUpdate.minVersionIos && !semver.valid(forceUpdate.minVersionIos)) {
    errors.push("minVersionIos no es una versión semver válida");
  }
  if (
    forceUpdate.minVersionAndroid &&
    !semver.valid(forceUpdate.minVersionAndroid)
  ) {
    errors.push("minVersionAndroid no es una versión semver válida");
  }
  if (forceUpdate.minVersionWeb && !semver.valid(forceUpdate.minVersionWeb)) {
    errors.push("minVersionWeb no es una versión semver válida");
  }

  return errors;
}

async function updateConfig(patch, updatedByIdentity) {
  const errors = validateConfigPatch(patch);
  if (errors.length > 0) throw badRequest("Configuración no válida", "INVALID_REMOTE_CONFIG", { errors });

  const saved = await dao.saveConfig({
    ...patch,
    updatedBy: updatedByIdentity || "",
  });
  invalidateCache();
  return saved;
}

module.exports = {
  calculateMaintenanceStatus,
  calculateForceUpdate,
  getComputedStatus,
  getRawConfig,
  updateConfig,
  validateConfigPatch,
  invalidateCache,
};
