const fs = require("fs");
const path = require("path");

// Cargador del núcleo puro (TypeScript estricto en src/, compilado con
// `npm run build:trainer-payments`). Mismo patrón que trainerBilling/adapter.js:
// la lógica de negocio vive en TS y esta capa CommonJS solo la usa.
const BUILD_PATH = path.join(__dirname, "../../.build/trainer-payments/index.js");

let loaded = null;

function isAvailable() {
  return fs.existsSync(BUILD_PATH);
}

function load() {
  if (loaded) return loaded;
  try {
    loaded = require(BUILD_PATH);
  } catch (cause) {
    const error = new Error("Falta .build/trainer-payments: ejecuta `npm run build:trainer-payments`.");
    error.code = "PAYMENTS_CORE_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }
  return loaded;
}

module.exports = { load, isAvailable, BUILD_PATH };
