const AppRuntimePolicy = require("./app-runtime-policy-schema");

const SINGLETON_KEY = "app_runtime_policy";
const PLATFORMS = ["ios", "android", "web"];
const UPDATE_MODES = ["off", "outdated_only", "all"];
const DEFAULT_POLICY = {
  singletonKey: SINGLETON_KEY,
  maintenance: {
    enabled: false,
    title: "Aplicacion en mantenimiento",
    message: "Estamos realizando mejoras. Vuelve en unos minutos.",
    expectedEndAt: null,
    retryAfterSeconds: 300,
  },
  updateRequired: {
    mode: "off",
    title: "Nueva version disponible",
    message:
      "Para seguir usando TrainFit necesitas instalar la ultima version de la app.",
    platforms: {
      ios: { enabled: false, minVersion: "" },
      android: { enabled: false, minVersion: "" },
      web: { enabled: false, minVersion: "" },
    },
  },
  revision: 1,
  updatedBy: {
    userId: null,
    email: null,
  },
  history: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trimString(value, fallback = "", maxLength = 500) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function toBoolean(value) {
  return value === true;
}

function normalizePlatform(value) {
  const platform = String(value || "web").toLowerCase();
  return PLATFORMS.includes(platform) ? platform : "web";
}

function normalizeClientFamily(value) {
  return String(value || "trainfit-front").trim() || "trainfit-front";
}

function isManagementClient(req) {
  return normalizeClientFamily(req.headers?.["x-client-family"]) === "train-fit-management";
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version || "").trim());
}

function compareVersions(left, right) {
  if (!isValidVersion(left) || !isValidVersion(right)) {
    return 0;
  }

  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index++) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

function mergeWithDefaults(policy) {
  const source = policy?.toObject ? policy.toObject() : policy || {};
  const merged = clone(DEFAULT_POLICY);

  merged._id = source._id;
  merged.createdAt = source.createdAt;
  merged.updatedAt = source.updatedAt;
  merged.revision = source.revision || DEFAULT_POLICY.revision;
  merged.updatedBy = {
    ...merged.updatedBy,
    ...(source.updatedBy || {}),
  };
  merged.history = Array.isArray(source.history) ? source.history : [];
  merged.maintenance = {
    ...merged.maintenance,
    ...(source.maintenance || {}),
  };
  merged.updateRequired = {
    ...merged.updateRequired,
    ...(source.updateRequired || {}),
    platforms: {
      ios: {
        ...merged.updateRequired.platforms.ios,
        ...(source.updateRequired?.platforms?.ios || {}),
      },
      android: {
        ...merged.updateRequired.platforms.android,
        ...(source.updateRequired?.platforms?.android || {}),
      },
      web: {
        ...merged.updateRequired.platforms.web,
        ...(source.updateRequired?.platforms?.web || {}),
      },
    },
  };

  return merged;
}

function toPublicPolicy(policy) {
  const normalized = mergeWithDefaults(policy);
  return {
    maintenance: normalized.maintenance,
    updateRequired: normalized.updateRequired,
    revision: normalized.revision,
    updatedBy: normalized.updatedBy,
    updatedAt: normalized.updatedAt || null,
  };
}

async function getPolicyDocument() {
  return AppRuntimePolicy.findOne({ singletonKey: SINGLETON_KEY });
}

async function getPolicy() {
  const policy = await getPolicyDocument();
  return toPublicPolicy(policy);
}

function normalizeIncomingPolicy(payload, currentPolicy) {
  const current = mergeWithDefaults(currentPolicy);
  const input = payload || {};
  const rawMaintenance = input.maintenance || {};
  const rawUpdateRequired = input.updateRequired || {};
  const rawPlatforms = rawUpdateRequired.platforms || {};

  const next = {
    singletonKey: SINGLETON_KEY,
    maintenance: {
      enabled: toBoolean(rawMaintenance.enabled),
      title: trimString(
        rawMaintenance.title,
        current.maintenance.title,
        120
      ),
      message: trimString(
        rawMaintenance.message,
        current.maintenance.message,
        700
      ),
      expectedEndAt: rawMaintenance.expectedEndAt
        ? new Date(rawMaintenance.expectedEndAt)
        : null,
      retryAfterSeconds: Number.isFinite(Number(rawMaintenance.retryAfterSeconds))
        ? Math.max(0, Number.parseInt(rawMaintenance.retryAfterSeconds, 10))
        : current.maintenance.retryAfterSeconds,
    },
    updateRequired: {
      mode: UPDATE_MODES.includes(rawUpdateRequired.mode)
        ? rawUpdateRequired.mode
        : "off",
      title: trimString(rawUpdateRequired.title, current.updateRequired.title, 120),
      message: trimString(
        rawUpdateRequired.message,
        current.updateRequired.message,
        700
      ),
      platforms: {},
    },
  };

  for (const platform of PLATFORMS) {
    const rawPlatform = rawPlatforms[platform] || {};
    const minVersion = trimString(rawPlatform.minVersion, "", 40);
    next.updateRequired.platforms[platform] = {
      enabled: toBoolean(rawPlatform.enabled),
      minVersion: isValidVersion(minVersion) ? minVersion : "",
    };
  }

  if (
    next.maintenance.expectedEndAt &&
    Number.isNaN(next.maintenance.expectedEndAt.getTime())
  ) {
    next.maintenance.expectedEndAt = null;
  }

  return next;
}

async function updatePolicy(payload, adminContext) {
  const currentDocument = await getPolicyDocument();
  const current = mergeWithDefaults(currentDocument);

  if (
    payload?.revision !== undefined &&
    Number(payload.revision) !== Number(current.revision)
  ) {
    const error = new Error("Runtime policy was updated by another admin");
    error.status = 409;
    error.currentPolicy = toPublicPolicy(current);
    throw error;
  }

  const nextPolicy = normalizeIncomingPolicy(payload, current);
  const nextRevision = Number(current.revision || 1) + 1;
  const updatedBy = {
    userId: adminContext?.userId || null,
    email: adminContext?.email || null,
  };

  const historyEntry = {
    changedAt: new Date(),
    changedBy: updatedBy,
    before: {
      maintenance: current.maintenance,
      updateRequired: current.updateRequired,
      revision: current.revision,
    },
    after: {
      maintenance: nextPolicy.maintenance,
      updateRequired: nextPolicy.updateRequired,
      revision: nextRevision,
    },
  };

  const history = [...(current.history || []), historyEntry].slice(-25);

  const updated = await AppRuntimePolicy.findOneAndUpdate(
    { singletonKey: SINGLETON_KEY },
    {
      $set: {
        singletonKey: SINGLETON_KEY,
        maintenance: nextPolicy.maintenance,
        updateRequired: nextPolicy.updateRequired,
        revision: nextRevision,
        updatedBy,
        history,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return toPublicPolicy(updated);
}

function buildRuntimeStatus(policy, req) {
  const normalized = mergeWithDefaults(policy);
  const clientFamily = normalizeClientFamily(req.headers?.["x-client-family"]);
  const platform = normalizePlatform(req.headers?.["x-client-platform"]);
  const clientVersion = String(req.headers?.["x-client-version"] || "").trim();
  const managementClient = isManagementClient(req);

  const maintenanceApplies =
    !managementClient && normalized.maintenance.enabled === true;

  const platformPolicy = normalized.updateRequired.platforms[platform] || {
    enabled: false,
    minVersion: "",
  };
  const mode = normalized.updateRequired.mode || "off";
  let updateApplies = false;

  if (!managementClient && mode !== "off" && platformPolicy.enabled) {
    if (mode === "all") {
      updateApplies = true;
    } else if (mode === "outdated_only") {
      updateApplies =
        isValidVersion(clientVersion) &&
        isValidVersion(platformPolicy.minVersion) &&
        compareVersions(clientVersion, platformPolicy.minVersion) < 0;
    }
  }

  return {
    clientFamily,
    platform,
    clientVersion,
    managementClient,
    maintenance: {
      enabled: normalized.maintenance.enabled,
      applies: maintenanceApplies,
      title: normalized.maintenance.title,
      message: normalized.maintenance.message,
      expectedEndAt: normalized.maintenance.expectedEndAt,
      retryAfterSeconds: normalized.maintenance.retryAfterSeconds,
    },
    updateRequired: {
      mode,
      enabled: mode !== "off",
      applies: updateApplies,
      platformEnabled: platformPolicy.enabled,
      title: normalized.updateRequired.title,
      message: normalized.updateRequired.message,
      minVersion: platformPolicy.minVersion,
      currentVersion: clientVersion,
    },
    revision: normalized.revision,
  };
}

async function getRuntimeStatus(req) {
  const policy = await getPolicyDocument();
  return buildRuntimeStatus(policy, req);
}

module.exports = {
  getPolicy,
  updatePolicy,
  getRuntimeStatus,
  buildRuntimeStatus,
  isManagementClient,
};
