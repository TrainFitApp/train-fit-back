const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateLocalConfig, diagnoseStartup, waitForListening } = require("../../scripts/stripe-local");

const secret = "FAKE_PRIVATE_DATA_MUST_NOT_APPEAR";

test("seed password and API port are validated without weakening the local-only database guard", () => {
  assert.throws(() => validateLocalConfig({ TRAINER_BILLING_SEED_USER: "1", TRAINER_TEST_PASSWORD: "too-short" }),
    { code: "SEED_PASSWORD_TOO_SHORT", phase: "configuration" });
  assert.equal(validateLocalConfig({ TRAINER_BILLING_SEED_USER: "1", TRAINER_TEST_PASSWORD: "twelve-chars" }).port, 3000);
  assert.equal(validateLocalConfig({ TRAINER_BILLING_SEED_USER: "0" }).port, 3000);
  for (const port of ["80", "65536", "3000.5", secret]) {
    assert.throws(() => validateLocalConfig({ SERVER_PORT: port }), { code: "LOCAL_PORT_INVALID" });
  }
  for (const uri of [secret, `mongodb://${secret}@localhost/trainfit_stripe_local`,
    "mongodb://remote.example/trainfit_stripe_local", "mongodb://localhost/other", "mongodb://localhost/trainfit_stripe_local?authSource=admin"]) {
    assert.throws(() => validateLocalConfig({ MONGODB_URI: uri }), (error) => {
      assert.equal(error.code, "LOCAL_MONGO_URI_INVALID");
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

test("startup diagnostics expose only fixed codes, phases and messages, including nested Mongo auth failures", () => {
  const cases = [
    [{ code: 18 }, "database", "MONGO_AUTH_REQUIRED"],
    [{ code: 13 }, "seed", "MONGO_AUTH_REQUIRED"],
    [{ cause: { code: 18, message: secret } }, "database", "MONGO_AUTH_REQUIRED"],
    [{ name: "MongooseServerSelectionError" }, "database", "MONGO_UNREACHABLE"],
    [{ cause: { code: "ECONNREFUSED" } }, "database", "MONGO_UNREACHABLE"],
    [{ code: "MODULE_NOT_FOUND" }, "imports", "BACKEND_IMPORT_FAILED"],
    [{ code: "EADDRINUSE" }, "listen", "API_PORT_IN_USE"],
    [{ code: "EACCES" }, "listen", "API_PERMISSION_DENIED"],
    [{ code: "EACCES" }, "configuration", "LOCAL_ENV_UNREADABLE"],
    [{ code: secret, name: secret }, secret, "STARTUP_FAILED"],
  ];
  for (const [error, phase, expected] of cases) {
    const diagnostic = diagnoseStartup({ ...error, message: secret, stack: secret, payload: { key: secret } }, phase);
    assert.equal(diagnostic.code, expected);
    assert.equal(`${diagnostic.code} ${diagnostic.phase} ${diagnostic.message} ${diagnostic.stack}`.includes(secret), false);
    assert.equal(diagnostic.cause, undefined);
  }
});

test("listen helper handles asynchronous EADDRINUSE and removes the other startup listener", async () => {
  const server = new EventEmitter();
  const pending = waitForListening(server);
  const failure = Object.assign(new Error(secret), { code: "EADDRINUSE" });
  queueMicrotask(() => server.emit("error", failure));
  await assert.rejects(pending, { code: "EADDRINUSE" });
  assert.equal(server.listenerCount("listening"), 0);
  assert.equal(server.listenerCount("error"), 0);
});

// Execute the real launcher body with file/Mongo/server doubles. No dotenv file,
// database, SMTP, Stripe call or listening socket is used by these tests.
function launcherFixture(local = {}, failures = {}) {
  const calls = { connected: 0, disconnected: 0, importedApp: 0, billingStarted: 0, stopped: 0, closed: 0, exited: 0 };
  const logs = [];
  const signals = new Map();
  const server = new EventEmitter();
  server.listening = false;
  server.closeAllConnections = () => {};
  server.close = (done) => { server.listening = false; calls.closed++; done(); };
  const mongoose = {
    set() {},
    async connect() { calls.connected++; if (failures.mongo) throw failures.mongo; },
    async disconnect() { calls.disconnected++; },
  };
  const dependencies = {
    "node:fs": { existsSync: () => !failures.missingFile, readFileSync: () => Buffer.from("synthetic fixture") },
    "node:path": path,
    "node:crypto": { generateKeyPairSync: () => ({ publicKey: "unit-public", privateKey: secret }) },
    "node:module": require("node:module"),
    dotenv: { parse: () => local }, mongoose,
    "../app": { listen() {
      queueMicrotask(() => {
        if (failures.listen) server.emit("error", failures.listen);
        else { server.listening = true; server.emit("listening"); }
      });
      return server;
    } },
    "../components/trainerBilling/adapter": {
      start() { calls.billingStarted++; if (failures.billing) throw failures.billing; },
      getRuntime() { return { stopReconciliation() { calls.stopped++; } }; },
    },
  };
  const fakeRequire = (name) => {
    if (name === "../app") { calls.importedApp++; if (failures.import) throw failures.import; }
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  };
  fakeRequire.resolve = () => "/unit/mail.js";
  fakeRequire.cache = {};
  const exported = { exports: {} };
  const filename = path.resolve(__dirname, "../../scripts/stripe-local.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: exported, exports: exported.exports, require: fakeRequire, URL, Buffer,
    __dirname: path.dirname(filename),
    console: { log: (...args) => logs.push(args.join(" ")), error: (...args) => logs.push(args.join(" ")) },
    process: { env: {}, on: (name, callback) => signals.set(name, callback), exit: () => { calls.exited++; } },
  }, { filename });
  return { main: exported.exports.main, calls, logs, signals };
}

test("a short seed password fails before connecting Mongo or importing the backend", async () => {
  const fixture = launcherFixture({ TRAINER_BILLING_SEED_USER: "1", TRAINER_TEST_PASSWORD: "short" });
  await assert.rejects(fixture.main(), { code: "SEED_PASSWORD_TOO_SHORT", phase: "configuration" });
  assert.equal(fixture.calls.connected, 0);
  assert.equal(fixture.calls.importedApp, 0);
  assert.equal(fixture.logs.length, 0);
});

test("missing local configuration is diagnosed without reading a real file", async () => {
  const fixture = launcherFixture({}, { missingFile: true });
  await assert.rejects(fixture.main(), { code: "LOCAL_ENV_MISSING" });
  assert.equal(fixture.calls.connected, 0);
});

test("Mongo and import failures close the connection and return sanitized diagnostics", async (t) => {
  for (const [name, failure, expected, phase] of [
    ["mongo", { name: "MongooseServerSelectionError", message: secret }, "MONGO_UNREACHABLE", "database"],
    ["mongo", { code: 18, message: secret }, "MONGO_AUTH_REQUIRED", "database"],
    ["import", { code: "MODULE_NOT_FOUND", message: secret, requireStack: [secret] }, "BACKEND_IMPORT_FAILED", "imports"],
  ]) await t.test(expected, async () => {
    const fixture = launcherFixture({}, { [name]: failure });
    await assert.rejects(fixture.main(), (error) => {
      assert.equal(error.code, expected);
      assert.equal(error.phase, phase);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(fixture.calls.disconnected, 1);
    assert.equal(fixture.calls.billingStarted, 0);
    assert.equal(fixture.logs.join(" ").includes(secret), false);
  });
});

test("occupied API port is awaited, sanitized and cleaned up before reconciliation can start", async () => {
  const fixture = launcherFixture({}, { listen: Object.assign(new Error(secret), { code: "EADDRINUSE" }) });
  await assert.rejects(fixture.main(), { code: "API_PORT_IN_USE", phase: "listen" });
  assert.equal(fixture.calls.disconnected, 1);
  assert.equal(fixture.calls.billingStarted, 0);
  assert.equal(fixture.logs.length, 0);
});

test("successful startup waits for listening and signal shutdown closes its resources", async () => {
  const fixture = launcherFixture({ TRAINER_BILLING_ENABLED: "1" });
  await fixture.main();
  assert.equal(fixture.calls.billingStarted, 1);
  assert.match(fixture.logs[0], /API de pruebas/);
  await fixture.signals.get("SIGTERM")();
  assert.equal(fixture.calls.stopped, 1);
  assert.equal(fixture.calls.closed, 1);
  assert.equal(fixture.calls.disconnected, 1);
  assert.equal(fixture.calls.exited, 1);
});
