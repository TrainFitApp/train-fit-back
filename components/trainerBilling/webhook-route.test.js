const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const { once } = require("node:events");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");
const { loadConfig } = require("../../.build/trainer-billing/config");

test("actual app webhook receives signed raw bytes before JSON parsing and maintenance", async (t) => {
  const config = loadConfig({ STRIPE_KEY: ["rk", "test", "unit"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "unit"].join("_") });
  const gateway = new StripeGateway(config);
  const payload = JSON.stringify({ id: "evt_route", livemode: false, type: "invoice.paid", data: { object: { customer: "cus_route" } } });
  const signature = gateway.stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
  let verified = false;
  const adapter = { controller: { webhook(req, res) {
    assert.ok(Buffer.isBuffer(req.body));
    try {
      const event = gateway.verifyEvent(req.body, req.headers["stripe-signature"]);
      verified = event.eventId === "evt_route";
      res.json({ received: true });
    } catch (error) { res.status(error.status).json({ code: error.code }); }
  } } };
  const moduleObject = { exports: {} };
  const directory = path.resolve(__dirname, "../..");
  const appSource = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const dependencies = {
    express, path, "cookie-parser": require("cookie-parser"), cors: require("cors"),
    "./routes": express.Router(), "./components/billing/billing-controller": { revenueCatWebhook(_req, res) { res.sendStatus(204); } },
    "./components/trainerBilling/adapter": adapter,
    // app.js lo pide desde que el CORS se decide por origen (cors-origin.js).
    // Esta prueba solo monta la ruta del webhook, que no pasa por CORS: con
    // la política real la petición de fetch (sin cabecera Origin) se
    // rechazaría, así que aquí se acepta todo y lo que comprueba el test
    // sigue siendo el orden raw-body -> firma -> JSON -> mantenimiento.
    "./components/util/cors-origin": { isOriginAllowed: () => true, parseExtraOrigins: () => [] },
    "./middleware/logger": (_req, _res, next) => next(),
    "./middleware/maintenance": (_req, res) => res.status(503).json({ code: "MAINTENANCE_ACTIVE" }),
    "./middleware": { error404Handler: (_req, res) => res.sendStatus(404),
      errorHandler: (_error, _req, res, _next) => res.sendStatus(500) },
  };
  vm.runInNewContext(appSource, { module: moduleObject, exports: moduleObject.exports,
    require: (name) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
    process: { env: {} }, console, __dirname: directory }, { filename: "app.js" });
  const server = moduleObject.exports.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = (body) => fetch(`${url}/api/billing/webhooks/stripe`, { method: "POST", body,
    headers: { "content-type": "application/json", "stripe-signature": signature } });
  assert.equal((await send(payload)).status, 200);
  assert.equal(verified, true);
  assert.equal((await send(payload + " ")).status, 400);
  assert.equal((await fetch(`${url}/api/other`)).status, 503);
});
