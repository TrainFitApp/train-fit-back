// Banco de pruebas de integración: la app Express real contra un MongoDB
// efímero (mongodb-memory-server), con tokens firmados en el propio test.
//
// Cada fichero de test arranca su propio mongod y su propio servidor en un
// puerto libre, así que los ficheros pueden correr en paralelo sin pisarse.
// Nunca lee .env ni toca una base de datos real: la URI la decide
// mongodb-memory-server y las claves JWT se generan aquí.
//
// Uso:
//
//   const { test } = require("node:test");
//   const h = require("./support/harness");
//   const ctx = h.setup();
//
//   test("…", async () => {
//     const ana = await ctx.makeUser({ name: "Ana" });
//     const res = await ctx.call(ana, "GET", "/auth/me");
//   });
//
// El primer arranque descarga el binario de mongod (una vez, a
// node_modules/.cache). Sin red y sin caché, los tests fallan al arrancar.

const crypto = require("node:crypto");
const path = require("node:path");
const { before, after } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

// --- Entorno, ANTES de cargar nada de la app --------------------------------

const keys = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.PUBLIC_KEY = keys.publicKey;
process.env.PRIVATE_KEY = keys.privateKey;
process.env.NODE_ENV = "test";
delete process.env.CORS_OPEN;
delete process.env.TRAINER_BILLING_ENABLED;
// Sin credenciales de R2/Bunny: el almacenamiento de media cae al disco local
// solo si se pide explícitamente. Cada test de media lo activa por su cuenta.
for (const name of Object.keys(process.env)) {
  if (/^(R2_|BUNNY_|STRIPE_|REVENUECAT_|SES_|REGISTER_MAIL_|SUGGESTIONS_MAIL_|RESEND_|MAIL_PROVIDER|MONGODB_)/.test(name)) {
    delete process.env[name];
  }
}

// El logger de morgan escribe en file.log (enorme, compartido con el servidor
// de desarrollo). En tests no aporta nada: se sustituye por un paso directo.
const loggerPath = require.resolve(path.join(ROOT, "middleware/logger.js"));
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: (req, res, next) => next(),
};

// Correo: nada sale del proceso. Se graba cada envío para poder comprobarlo.
const sentMail = [];
const mail = require(path.join(ROOT, "components/util/mail.js"));
for (const name of ["sendSuggestionMail", "sendRegisterMail", "sendTransactionalMail", "sendRegistrationNotification", "notifyUserRegistered"]) {
  mail[name] = async (...args) => {
    sentMail.push({ fn: name, args });
    return { accepted: [args[0]] };
  };
}
mail.validateEmailExists = async () => true;

// La app registra mucho por consola (sesiones emitidas, avisos de rutas
// antiguas…). En tests tapa los fallos: se silencia salvo con
// INTEGRATION_VERBOSE=1. console.error se mantiene para ver los 5xx.
if (process.env.INTEGRATION_VERBOSE !== "1") {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
}

const mongoose = require("mongoose");
mongoose.set("strictQuery", true);

const FAMILY = {
  client: "trainfit-front",
  trainer: "trainfit-trainers",
  admin: "train-fit-management",
};

function setup() {
  const ctx = {
    baseUrl: "",
    mongoose,
    sentMail,
    FAMILY,
    oid: (value) => (value ? new mongoose.Types.ObjectId(String(value)) : new mongoose.Types.ObjectId()),
    model: (name) => mongoose.model(name),
  };
  let mongod = null;
  let server = null;
  let TokenService = null;
  let User = null;
  let seq = 0;
  let markReady;
  let markFailed;
  ctx.ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  // Evita un "unhandled rejection" si nadie espera a ctx.ready.
  ctx.ready.catch(() => {});

  // Los `before` de nivel raíz de node:test arrancan a la vez, no en orden:
  // los del fichero de test tienen que esperar a que la app esté lista.
  ctx.before = (fn) => before(async () => {
    await ctx.ready;
    await fn();
  });

  before(async () => {
    try {
      await start();
      markReady();
    } catch (error) {
      markFailed(error);
      throw error;
    }
  });

  async function start() {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri("trainfit_integration"), { serverSelectionTimeoutMS: 10000 });

    const app = require(path.join(ROOT, "app.js"));
    TokenService = require(path.join(ROOT, "services/token.service.js"));
    User = require(path.join(ROOT, "components/users/schema.js"));

    // Los índices únicos son parte de las reglas (un DietDay por fecha, una
    // invitación viva por email y scope…): hay que tenerlos ANTES del primer
    // test, no cuando mongoose termine de crearlos en segundo plano.
    for (const name of mongoose.modelNames()) {
      await mongoose.model(name).init();
    }

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    ctx.baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  }

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop();
  });

  /**
   * Crea un usuario con sesión válida y devuelve { id, token, family, doc }.
   * Pasa por el modelo (defaults y setters reales), sin contraseña salvo que
   * se pida: los tests de login usan la suya propia.
   */
  ctx.makeUser = async ({
    name,
    roles = ["user"],
    family,
    password,
    email,
    fields = {},
  } = {}) => {
    seq += 1;
    const resolvedFamily =
      family || (roles.includes("trainer") ? FAMILY.trainer : roles.includes("admin") ? FAMILY.admin : FAMILY.client);
    const sessionId = crypto.randomUUID();
    const label = name || `Usuario${seq}`;
    const doc = new User({
      name: label,
      lastname: "Test",
      email: email || `${label.toLowerCase().replace(/[^a-z0-9]/g, "")}.${seq}.${Date.now()}@example.test`,
      roles,
      ...(password ? { password } : {}),
      auth: {
        sessionId,
        clientFamily: resolvedFamily,
        refreshExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
      ...fields,
    });
    await doc.save();
    const pver = doc.passwordVersion || 0;
    // Mismos claims que auth-controller#generateAccessTokenForSession: varios
    // controllers leen los roles del token (req.userData.roles), no de BD.
    const token = TokenService.signAccess({ sub: String(doc._id), sid: sessionId, roles, pver }, { audience: resolvedFamily });
    return { id: String(doc._id), _id: doc._id, token, family: resolvedFamily, name: label, email: doc.email, sessionId, doc };
  };

  ctx.makeTrainer = (options = {}) => ctx.makeUser({ name: "Entrenador", ...options, roles: options.roles || ["trainer"] });
  ctx.makeClient = (options = {}) => ctx.makeUser({ name: "Cliente", ...options, roles: options.roles || ["user"] });
  ctx.makeAdmin = (options = {}) => ctx.makeUser({ name: "Admin", ...options, roles: options.roles || ["admin"] });

  /** Firma otro token para la misma sesión (p. ej. con otra audiencia). */
  ctx.signFor = (user, { audience = user.family, sid = user.sessionId, pver = 0, sub = user.id, expiresIn = "15m", roles = user.doc?.roles } = {}) =>
    TokenService.signAccess({ sub, sid, roles, pver }, { audience, expiresIn });

  /** Relación profesional ↔ cliente ya establecida (sin pasar por la invitación). */
  ctx.relate = async (trainer, client, { scope = "training", status = "active", intakePending = false, respondedAt = new Date(), invitedAt } = {}) => {
    const TrainerClient = mongoose.model("TrainerClient");
    const doc = await TrainerClient.create({
      trainerId: trainer._id,
      clientId: client._id,
      clientEmail: client.email,
      scope,
      status,
      intakePending,
      invitedAt: invitedAt || new Date(Date.now() - 60 * 1000),
      respondedAt,
      revokedAt: status === "revoked" ? new Date() : null,
      revokedBy: status === "revoked" ? "trainer" : null,
    });
    return doc;
  };

  /** Las dos relaciones (entrenamiento y nutrición) de un par. */
  ctx.relateBoth = async (trainer, client, options = {}) => [
    await ctx.relate(trainer, client, { ...options, scope: "training" }),
    await ctx.relate(trainer, client, { ...options, scope: "nutrition" }),
  ];

  /**
   * Petición HTTP real. `user` puede ser null (petición anónima). Devuelve
   * { status, body, headers }; el cuerpo se parsea si es JSON.
   */
  ctx.call = async (user, method, urlPath, body, { headers = {}, token, family } = {}) => {
    const finalHeaders = { "content-type": "application/json", ...headers };
    if (user) {
      finalHeaders.authorization = `Bearer ${token || user.token}`;
      finalHeaders["x-client-family"] = family || user.family;
    } else if (family) {
      finalHeaders["x-client-family"] = family;
    }
    const response = await fetch(`${ctx.baseUrl}${urlPath}`, {
      method,
      headers: finalHeaders,
      // GET/HEAD no admiten cuerpo en fetch: se ignora para poder reutilizar
      // la misma lista de casos con métodos distintos.
      body: body === undefined || ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = text;
    // Cookies de la respuesta (refresh de las apps web), por nombre.
    const cookies = {};
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      cookies[pair.slice(0, eq).trim()] = { value: pair.slice(eq + 1), attrs: attrs.map((a) => a.trim().toLowerCase()), raw };
    }
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_) {
      // texto plano
    }
    return { status: response.status, body: parsed, headers: response.headers, cookies };
  };

  /** Petición anónima con cabeceras propias (login, refresh, registro…). */
  ctx.raw = (method, urlPath, body, headers = {}) => ctx.call(null, method, urlPath, body, { headers });

  /** Igual que call(), pero exige un status y devuelve directamente el cuerpo. */
  ctx.ok = async (user, method, urlPath, body, expected = [200, 201, 204]) => {
    const res = await ctx.call(user, method, urlPath, body);
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(res.status)) {
      throw new Error(`${method} ${urlPath} -> ${res.status} (esperado ${allowed.join("/")}): ${JSON.stringify(res.body)}`);
    }
    return res.body;
  };

  ctx.get = (user, urlPath) => ctx.ok(user, "GET", urlPath);
  ctx.post = (user, urlPath, body) => ctx.ok(user, "POST", urlPath, body);
  ctx.put = (user, urlPath, body) => ctx.ok(user, "PUT", urlPath, body);
  ctx.patch = (user, urlPath, body) => ctx.ok(user, "PATCH", urlPath, body);
  ctx.del = (user, urlPath, body) => ctx.ok(user, "DELETE", urlPath, body);

  /** Cuenta documentos de un modelo con un filtro. */
  ctx.count = (modelName, filter = {}) => mongoose.model(modelName).countDocuments(filter);

  /** Vacía colecciones concretas (catálogos compartidos entre tests). */
  ctx.clear = async (...modelNames) => {
    for (const name of modelNames) await mongoose.model(name).deleteMany({});
  };

  return ctx;
}

/**
 * Fecha YYYY-MM-DD desplazada `offset` días desde hoy, en UTC: es el "hoy"
 * que usa el backend (toISOString) para fases, semanas y check-ins.
 */
function day(offset = 0, base = new Date()) {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset, 12));
  return d.toISOString().slice(0, 10);
}

module.exports = { setup, day, FAMILY };
