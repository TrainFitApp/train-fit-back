// Lanzador exclusivo de pruebas: nunca carga .env ni scripts/_mongo-uri ni bin/www.
const fs = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");
const Module = require("node:module");

const STARTUP_MESSAGES = Object.freeze({
  LOCAL_ENV_MISSING: "Falta .env.stripe.local. Crea el archivo desde components/trainerBilling/local.env.example.",
  LOCAL_ENV_UNREADABLE: "No se pudo leer .env.stripe.local. Revisa sus permisos.",
  LOCAL_MONGO_URI_INVALID: "MONGODB_URI debe usar loopback, sin credenciales/opciones y la base trainfit_stripe_local.",
  SEED_PASSWORD_TOO_SHORT: "TRAINER_TEST_PASSWORD debe tener al menos 12 caracteres cuando TRAINER_BILLING_SEED_USER=1.",
  LOCAL_PORT_INVALID: "SERVER_PORT debe ser un entero entre 1024 y 65535.",
  MONGO_AUTH_REQUIRED: "MongoDB requiere autenticación o permisos. Este lanzador necesita una instancia local de pruebas sin credenciales.",
  MONGO_UNREACHABLE: "No se pudo conectar con MongoDB local. Comprueba que esté iniciado y que su puerto coincida con MONGODB_URI.",
  BACKEND_IMPORT_FAILED: "No se pudo cargar una dependencia o el backend compilado. Revisa npm ci y npm run build:trainer-billing.",
  API_PORT_IN_USE: "El puerto SERVER_PORT ya está ocupado. Identifica el proceso; no detengas otro backend sin comprobarlo.",
  API_PERMISSION_DENIED: "El sistema no permite escuchar en SERVER_PORT. Revisa los permisos o el puerto elegido.",
  STARTUP_FAILED: "No se pudo completar esta fase. Revisa components/trainerBilling/README.md.",
});
const STARTUP_PHASES = new Set(["configuration", "database", "seed", "imports", "listen", "billing"]);

class LocalStartupError extends Error {
  constructor(code, phase = "configuration") {
    const safeCode = Object.hasOwn(STARTUP_MESSAGES, code) ? code : "STARTUP_FAILED";
    super(STARTUP_MESSAGES[safeCode]);
    this.code = safeCode;
    this.phase = STARTUP_PHASES.has(phase) ? phase : "configuration";
  }
}

function diagnoseStartup(error, phase = "configuration") {
  if (error instanceof LocalStartupError) return error;
  // Solo códigos/nombres conocidos; nunca serializar mensajes, stack ni causas del proveedor.
  const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean);
  let code = "STARTUP_FAILED";
  if (chain.some((item) => item.code === 18 || item.code === 13)) code = "MONGO_AUTH_REQUIRED";
  else if (error?.code === "MODULE_NOT_FOUND" || error?.code === "ERR_REQUIRE_ESM") code = "BACKEND_IMPORT_FAILED";
  else if (phase === "listen" && error?.code === "EADDRINUSE") code = "API_PORT_IN_USE";
  else if (phase === "listen" && ["EACCES", "EPERM"].includes(error?.code)) code = "API_PERMISSION_DENIED";
  else if (phase === "configuration" && ["EACCES", "EPERM"].includes(error?.code)) code = "LOCAL_ENV_UNREADABLE";
  else if (phase === "database" && chain.some((item) =>
    ["MongoServerSelectionError", "MongooseServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"].includes(item.name) ||
    ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"].includes(item.code))) code = "MONGO_UNREACHABLE";
  return new LocalStartupError(code, phase);
}

function validateLocalConfig(env) {
  const uri = env.MONGODB_URI || "mongodb://127.0.0.1:27017/trainfit_stripe_local";
  let parsed;
  try { parsed = new URL(uri); }
  catch { throw new LocalStartupError("LOCAL_MONGO_URI_INVALID"); }
  if (parsed.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.pathname !== "/trainfit_stripe_local" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new LocalStartupError("LOCAL_MONGO_URI_INVALID");
  }
  const port = Number(env.SERVER_PORT || "3000");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new LocalStartupError("LOCAL_PORT_INVALID");
  if (env.TRAINER_BILLING_SEED_USER === "1" && (env.TRAINER_TEST_PASSWORD || "").length < 12) {
    throw new LocalStartupError("SEED_PASSWORD_TOO_SHORT");
  }
  return { uri, port };
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener("listening", onListening); reject(error); };
    const onListening = () => { server.removeListener("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}

async function main() {
  let phase = "configuration";
  let mongoose;
  let server;
  let billing;
  let billingStarted = false;
  const cleanup = async () => {
    if (billingStarted) {
      try { billing.getRuntime().stopReconciliation(); } catch { /* Limpieza sin mostrar errores arbitrarios. */ }
    }
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose) await mongoose.disconnect().catch(() => {});
  };
  try {
    const filename = path.resolve(__dirname, "../.env.stripe.local");
    if (!fs.existsSync(filename)) throw new LocalStartupError("LOCAL_ENV_MISSING");
    const local = require("dotenv").parse(fs.readFileSync(filename));
    // Solo estas opciones pueden entrar desde el archivo de pruebas.
    const allowed = /^(STRIPE_|TRAINER_BILLING_|TRAINER_TEST_|MONGODB_URI$|SERVER_PORT$)/;
    for (const key of Object.keys(process.env)) {
      if (/^(STRIPE_|TRAINER_BILLING_|TRAINER_TEST_|MONGODB_|MONGO_URI$|REVENUECAT_)/.test(key)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(local)) if (allowed.test(key)) process.env[key] = value;
    // Rechazar configuración/seed antes de abrir una conexión o crear usuarios.
    const { uri, port } = validateLocalConfig(process.env);
    process.env.NODE_ENV = "test";
    process.env.CORS_OPEN = "0";
    process.env.COOKIE_SECURE = "false";
    process.env.COOKIE_SAMESITE = "lax";
    process.env.TRAINER_BILLING_FRONTEND_URL ||= "http://localhost:8100";
    const jwt = generateKeyPairSync("rsa", { modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    process.env.PUBLIC_KEY = jwt.publicKey;
    process.env.PRIVATE_KEY = jwt.privateKey;
    // El mail legacy verifica SMTP al importar. Sustituto solo en este proceso local:
    // ni envía correos ni hace comprobaciones DNS/SMTP.
    const mailPath = require.resolve("../components/util/mail");
    const mailStub = new Module(mailPath);
    mailStub.loaded = true;
    mailStub.exports = {
      sendMail: async () => {}, sendRegisterMail: async () => {}, sendMailSES: async () => {},
      sendRegistrationNotification: async () => {}, notifyUserRegistered: async () => {},
      generateMail: () => "", generateHashMail: () => "", generateRegistrationNotificationMail: () => "",
      validateEmailExists: async () => false,
    };
    require.cache[mailPath] = mailStub;
    phase = "database";
    mongoose = require("mongoose");
    mongoose.set("strictQuery", true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    phase = "seed";
    if (process.env.TRAINER_BILLING_SEED_USER === "1") {
      const password = process.env.TRAINER_TEST_PASSWORD || "";
      const User = require("../components/users/schema");
      const email = "trainer@example.test";
      if (!await User.exists({ email })) {
        await User.create({ email, password, name: "Trainer", lastname: "Sandbox", status: "active", roles: ["trainer", "user"] });
      }
      console.log("Cuenta local disponible: trainer@example.test (contraseña del archivo local; no se muestra).");
    }
    phase = "imports";
    const app = require("../app");
    billing = require("../components/trainerBilling/adapter");
    phase = "listen";
    server = app.listen(port, "127.0.0.1");
    await waitForListening(server);
    phase = "billing";
    billing.start();
    billingStarted = process.env.TRAINER_BILLING_ENABLED === "1";
    console.log(`API de pruebas: http://localhost:${port}/api — BD trainfit_stripe_local; correo y crons legacy desactivados.`);
    const shutdown = async () => {
      await cleanup();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    await cleanup();
    throw diagnoseStartup(error, phase);
  }
}

if (require.main === module) main().catch((error) => {
  const diagnostic = diagnoseStartup(error);
  console.error(`[stripe:local] ${diagnostic.code} (${diagnostic.phase}): ${diagnostic.message}`);
  process.exitCode = 1;
});

module.exports = { main, validateLocalConfig, diagnoseStartup, waitForListening };
