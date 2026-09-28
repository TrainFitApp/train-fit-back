const test = require("node:test");
const assert = require("node:assert/strict");
const TrainerClient = require("../trainerClients/trainer-client-schema");
const seatService = require("../trainerClients/trainer-seat-service");
const { requirePaymentsAccess } = require("./trainer-payment-access");
const controller = require("./trainer-payment-controller");
const router = require("./trainer-payment-routes");
const { load } = require("./core");

// Autorización financiera y contrato HTTP sin BD: se sustituyen las lecturas
// de relaciones y de plazas. El camino completo (tokens reales, Mongo aislado)
// está en trainer-payments-db.test.js.

const TRAINER = "a".repeat(24);
const CLIENT = "b".repeat(24);

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    headersSent: false,
    send(body) { this.body = body; this.headersSent = true; return this; },
  };
}

async function run(middleware, { relations = [], readOnly = false, method = "POST", clientId = CLIENT } = {}) {
  const originalFind = TrainerClient.find;
  const originalReject = seatService.rejectIfReadOnly;
  let seatChecked = false;
  TrainerClient.find = () => ({ select: () => ({ lean: async () => relations.map((status) => ({ status })) }) });
  seatService.rejectIfReadOnly = async (req, res) => {
    seatChecked = true;
    if (!readOnly || req.method === "GET") return false;
    res.status(403).send({ code: "CLIENT_READ_ONLY" });
    return true;
  };
  const req = { method, params: { clientId }, auth: { userId: TRAINER } };
  const res = fakeRes();
  let nextCalled = false;
  try {
    await middleware(req, res, () => { nextCalled = true; });
  } finally {
    TrainerClient.find = originalFind;
    seatService.rejectIfReadOnly = originalReject;
  }
  return { req, res, nextCalled, seatChecked };
}

test("cliente activo: pasa; escribir con la plaza en solo lectura da 403 CLIENT_READ_ONLY", async () => {
  const ok = await run(requirePaymentsAccess({ write: true }), { relations: ["active"] });
  assert.equal(ok.nextCalled, true);
  assert.equal(ok.req.paymentsAccess, "active");
  const blocked = await run(requirePaymentsAccess({ write: true, allowFormer: true }), { relations: ["active"], readOnly: true });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.body.code, "CLIENT_READ_ONLY");
  // Un scope revocado y otro activo es un cliente ACTIVO, no antiguo.
  const mixed = await run(requirePaymentsAccess(), { relations: ["revoked", "active"] });
  assert.equal(mixed.req.paymentsAccess, "active");
});

test("antiguo cliente: solo lectura y cierre de deuda, sin eludir nada más", async () => {
  const settle = await run(requirePaymentsAccess({ allowFormer: true, write: true }), { relations: ["revoked"] });
  assert.equal(settle.nextCalled, true);
  assert.equal(settle.req.paymentsAccess, "former");
  assert.equal(settle.seatChecked, false, "no ocupa plaza: el límite no se le aplica ni lo desbloquea");
  const manage = await run(requirePaymentsAccess({ write: true }), { relations: ["revoked"] });
  assert.equal(manage.nextCalled, false);
  assert.equal(manage.res.statusCode, 403);
  assert.equal(manage.res.body.code, "FORMER_CLIENT_RESTRICTED");
});

test("sin relación (otro entrenador), invitación pendiente o uno mismo: 403", async () => {
  for (const relations of [[], ["declined"], ["pending"]]) {
    const result = await run(requirePaymentsAccess({ allowFormer: true }), { relations });
    assert.equal(result.nextCalled, false, relations.join());
    assert.equal(result.res.body.code, "NO_RELATION");
  }
  const self = await run(requirePaymentsAccess({ allowFormer: true }), { relations: ["active"], clientId: TRAINER });
  assert.equal(self.res.body.code, "NO_RELATION");
  const invalid = await run(requirePaymentsAccess({ allowFormer: true }), { relations: ["active"], clientId: "nope" });
  assert.equal(invalid.res.statusCode, 403);
});

test("errores de dominio → código HTTP y cuerpo {code, message, details}", async () => {
  const { PaymentsError } = load();
  const res = fakeRes();
  await controller.handler(async () => {
    throw new PaymentsError("AMOUNT_EXCEEDS_BALANCE", "El importe supera el saldo pendiente del cobro.", 422, { balanceCents: 4000 });
  })({}, res);
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body, { code: "AMOUNT_EXCEEDS_BALANCE", message: "El importe supera el saldo pendiente del cobro.", details: { balanceCents: 4000 } });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("todas las rutas de cobros empiezan por auth y, por cliente, autorización financiera", async () => {
  const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route);
  assert.ok(routes.length >= 20);
  for (const route of routes) {
    const handlers = route.stack.map((layer) => layer.handle);
    // Sin token, el primer eslabón corta con 401 antes de tocar nada.
    const res = fakeRes();
    let passed = false;
    await handlers[0]({ headers: {}, cookies: {} }, res, () => { passed = true; });
    assert.equal(passed, false, route.path);
    assert.equal(res.statusCode, 401, route.path);
    if (route.path.startsWith("/payments/clients/:clientId")) {
      assert.ok(handlers.length >= 3, `${route.path} sin middleware de acceso`);
    }
  }
  const methods = routes.flatMap((route) => Object.keys(route.methods).map((method) => `${method.toUpperCase()} ${route.path}`));
  assert.ok(methods.includes("POST /payments/clients/:clientId/charges/:chargeId/payments"));
  assert.ok(methods.includes("GET /payments/overview"));
});
