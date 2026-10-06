const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");
const { createFakeRevenueCat, DAY } = require("./support/fake-revenuecat");

// Premium de cliente con RevenueCat, de punta a punta: lo que concede,
// amplía y quita management (promocionales), lo que pasa cuando ese tiempo
// se acaba (con y sin webhook), las compras de tienda por webhook, el job de
// reconciliación, "restaurar compras" y el enlace del cliente.
//
// RevenueCat es un doble en memoria (support/fake-revenuecat.js) que imita su
// API v1. Para "esperar" a que algo caduque, elapse() mueve hacia atrás todas
// las fechas de esos usuarios (en BD y en RevenueCat): equivale a que pase el
// tiempo sin dormir el test.

const API_KEY = "sk_test_fake_revenuecat";
const WEBHOOK_SECRET = "whsec-revenuecat-test";
// El harness borra las REVENUECAT_* al cargarse; aquí se ponen las de prueba
// antes de que arranque la app (se leen en cada uso).
process.env.REVENUECAT_SECRET_API_KEY = API_KEY;
process.env.REVENUECAT_WEBHOOK_AUTH = WEBHOOK_SECRET;

const ctx = h.setup();
const rc = createFakeRevenueCat({ apiKey: API_KEY });
ctx.before(() => rc.install());
after(() => rc.uninstall());

const MINUTE = 60 * 1000;
const PROMO = rc.promoProductId;
const MONTHLY = "trainfit_pro_monthly";

const billing = () => require("../components/billing/billing-service");
const User = () => ctx.model("User");
const BillingCustomer = () => ctx.model("BillingCustomer");

async function premiumOf(user) {
  return (await User().findById(user.id).lean()).premium || {};
}

/** Hace pasar `ms` para estos usuarios: sus fechas en BD y en RevenueCat retroceden. */
async function elapse(ms, ...users) {
  const ids = users.map((user) => user._id);
  rc.shift(ms, users.map((user) => user.id));
  const back = (field) => ({ $set: { [field]: { $subtract: [`$${field}`, ms] } } });
  for (const field of ["premium.expiresAt", "premium.lastSyncAt"]) {
    await User().collection.updateMany({ _id: { $in: ids }, [field]: { $type: "date" } }, [back(field)]);
  }
  for (const field of ["expiresAt", "lastEventAt"]) {
    await BillingCustomer().collection.updateMany({ userId: { $in: ids }, [field]: { $type: "date" } }, [back(field)]);
  }
}

async function waitFor(check, message, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const webhook = (payload, authorization = `Bearer ${WEBHOOK_SECRET}`) =>
  ctx.raw("POST", "/billing/webhooks/revenuecat", payload, authorization ? { authorization } : {});

const adminCall = (admin, action, user, duration) =>
  ctx.call(admin, "POST", `/billing/admin/${action}`, { userId: user.id, duration });

const preset = (value) => ({ type: "preset", value });

/** Lo que ve management en el listado de usuarios (y si sale con "solo premium"). */
async function managementView(admin, user) {
  const all = await ctx.post(admin, "/users/search", { page: 0, search: user.email });
  const premiumOnly = await ctx.post(admin, "/users/search", { page: 0, search: user.email, filters: { premiumOnly: true } });
  const row = all.users.find((candidate) => String(candidate._id) === user.id);
  return { row, inPremiumOnly: premiumOnly.users.some((candidate) => String(candidate._id) === user.id), premiumOnlyTotal: premiumOnly.total };
}

async function isPremiumEverywhere(admin, user) {
  // Management primero: es lo que ve el admin aunque el usuario no abra la
  // app (abrirla corrige la BD de paso y taparía el fallo del listado).
  const view = await managementView(admin, user);
  const entitlements = await ctx.get(user, "/billing/entitlements/me");
  const me = await ctx.get(user, "/auth/me");
  return {
    app: entitlements.isPremium,
    ads: entitlements.adsEnabled,
    profile: me.user.premium?.entitled === true,
    management: view.row?.premium?.entitled === true,
    managementPremiumOnly: view.inPremiumOnly,
  };
}

/** Compra de tienda ya reflejada en BD por su webhook (INITIAL_PURCHASE). */
async function buyInStore(user, { productId = MONTHLY, days = 30 } = {}) {
  rc.purchase(user.id, productId, { days });
  const res = await webhook(rc.event("INITIAL_PURCHASE", user.id, productId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await premiumOf(user)).entitled, true);
}

// --- Management: conceder tiempo ------------------------------------------------------------

test("management concede 1 día: RevenueCat recibe la fecha de fin exacta y el usuario es PRO en la app, el perfil y management", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  const before = Date.now();

  const res = await adminCall(admin, "grant", user, preset("1d"));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.premium.entitled, true);
  assert.equal(res.body.premium.source, "manual");
  assert.equal(res.body.premium.plan, "manual");

  // Antes de conceder pregunta a RevenueCat si paga en tienda; luego revoca
  // promocionales anteriores, concede con end_time_ms y relee el estado.
  assert.deepEqual(rc.callsFor(user.id).map((call) => call.kind), ["subscriber", "revoke_promotionals", "promotional", "subscriber"]);
  const [grantCall] = rc.callsFor(user.id, "promotional");
  assert.deepEqual(Object.keys(grantCall.body), ["end_time_ms"], "sin duration ni start_time_ms (obsoletos)");
  assert.ok(Math.abs(grantCall.body.end_time_ms - (before + DAY)) < 5000);

  const stored = await premiumOf(user);
  assert.equal(new Date(stored.expiresAt).getTime(), grantCall.body.end_time_ms, "en BD queda la caducidad que dice RevenueCat");

  assert.deepEqual(await isPremiumEverywhere(admin, user), {
    app: true, ads: false, profile: true, management: true, managementPremiumOnly: true,
  });
  const status = await ctx.get(admin, `/billing/admin/status/${user.id}`);
  assert.equal(status.isPremium, true);
  assert.equal(status.source, "manual");
  assert.equal(status.willRenew, false, "una promocional no se renueva");
});

test("BUG management: cuando se acaba el tiempo concedido deja de ser PRO aunque no llegue ningún webhook (app, perfil, límites y listado de management)", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  assert.equal((await adminCall(admin, "grant", user, preset("1d"))).status, 200);
  await ctx.post(user, `/tables/user/${user.id}`, { name: "R1" });
  await ctx.post(user, `/tables/user/${user.id}`, { name: "R2" });

  await elapse(DAY + MINUTE, user);

  assert.deepEqual(await isPremiumEverywhere(admin, user), {
    app: false, ads: true, profile: false, management: false, managementPremiumOnly: false,
  });
  // Vuelve a los límites free: con 2 rutinas ya no puede crear una tercera.
  assert.equal((await ctx.call(user, "POST", `/tables/user/${user.id}`, { name: "R3" })).status, 403);
  // Y la BD se corrige sola (sin esperar al webhook ni al job de la noche).
  await waitFor(async () => (await premiumOf(user)).entitled === false, "premium.entitled sigue a true en BD");

  // Management lo ve como no PRO y puede volver a concederle tiempo.
  const again = await adminCall(admin, "grant", user, preset("1w"));
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal((await isPremiumEverywhere(admin, user)).management, true);
});

test("al acabarse llega el EXPIRATION de la promocional: se reconsulta RevenueCat y queda sin PRO en BD al momento", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await adminCall(admin, "grant", user, preset("1d"));
  await elapse(DAY + MINUTE, user);

  const res = await webhook(rc.event("EXPIRATION", user.id, PROMO, { expiration_reason: "DEVELOPER_INITIATED" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.resynced, true);
  const stored = await premiumOf(user);
  assert.equal(stored.entitled, false);
  assert.equal(stored.source, null);
});

test("fecha personalizada: caduca exactamente en la fecha elegida (no al final de un tramo mensual de RevenueCat)", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  const target = new Date(Date.now() + 10 * DAY + 3 * 3600 * 1000);

  const res = await adminCall(admin, "grant", user, { type: "customDate", expiresAt: target.toISOString() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(rc.callsFor(user.id, "promotional")[0].body.end_time_ms, target.getTime());
  assert.equal(new Date((await premiumOf(user)).expiresAt).getTime(), target.getTime());

  await elapse(10 * DAY, user);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, true, "a 3 h del final sigue siendo PRO");
  await elapse(3 * 3600 * 1000 + MINUTE, user);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false, "un minuto después de la fecha ya no");
});

test("conceder: fechas y duraciones no válidas dan 400 sin tocar RevenueCat; usuario inexistente 404; solo admin", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  const cases = [
    [{ type: "customDate", expiresAt: new Date(Date.now() - MINUTE).toISOString() }, /futuro/],
    [{ type: "customDate", expiresAt: new Date(Date.now() + 366 * DAY).toISOString() }, /1 año/],
    [{ type: "customDate", expiresAt: "no-es-fecha" }, /no valida/],
    [preset("2y"), /no valida/],
    [{ type: "lifetime" }, /no valido/],
    [undefined, /requerida/],
  ];
  for (const [duration, message] of cases) {
    const res = await adminCall(admin, "grant", user, duration);
    assert.equal(res.status, 400, JSON.stringify({ duration, body: res.body }));
    assert.match(res.body.message, message);
  }
  assert.equal(rc.callsFor(user.id).length, 0, "ninguna llamada a RevenueCat");
  assert.equal((await premiumOf(user)).entitled ?? false, false);

  const missing = await ctx.call(admin, "POST", "/billing/admin/grant", { userId: String(ctx.oid()), duration: preset("1d") });
  assert.equal(missing.status, 404);

  for (const intruder of [user, await ctx.makeTrainer()]) {
    for (const action of ["grant", "extend", "revoke"]) {
      const res = await adminCall(intruder, action, user, preset("1y"));
      assert.ok([401, 403].includes(res.status), `${action} por no admin -> ${res.status}`);
    }
    assert.ok([401, 403].includes((await ctx.call(intruder, "GET", `/billing/admin/status/${user.id}`)).status));
  }
  assert.equal((await premiumOf(user)).entitled ?? false, false);
});

// --- Management: ampliar y quitar --------------------------------------------------------------

test("ampliar suma al final del tiempo vigente; si ya caducó, cuenta desde ahora; nunca más de 1 año", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await adminCall(admin, "grant", user, preset("1w"));
  const firstEnd = new Date((await premiumOf(user)).expiresAt).getTime();

  const extended = await adminCall(admin, "extend", user, preset("1w"));
  assert.equal(extended.status, 200, JSON.stringify(extended.body));
  assert.ok(Math.abs(new Date((await premiumOf(user)).expiresAt).getTime() - (firstEnd + 7 * DAY)) < 5000);

  assert.equal((await adminCall(admin, "extend", user, preset("1y"))).status, 400, "1 año encima de 2 semanas pasa del tope");

  await elapse(15 * DAY, user); // caducado, y la BD aún dice entitled
  const afterExpiry = await adminCall(admin, "extend", user, preset("1d"));
  assert.equal(afterExpiry.status, 200, JSON.stringify(afterExpiry.body));
  assert.ok(Math.abs(new Date((await premiumOf(user)).expiresAt).getTime() - (Date.now() + DAY)) < 5000);
});

test("quitar PRO: se pierde al momento y un CANCELLATION tardío de esa promocional no lo devuelve (ni reconsultando ni con RevenueCat caído)", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await adminCall(admin, "grant", user, preset("1m"));
  const originalEnd = new Date((await premiumOf(user)).expiresAt).getTime();

  const revoked = await adminCall(admin, "revoke", user);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.premium.entitled, false);
  assert.deepEqual(await isPremiumEverywhere(admin, user), {
    app: false, ads: true, profile: false, management: false, managementPremiumOnly: false,
  });

  // Peor caso: el CANCELLATION trae la fecha original (futura) de la promocional.
  const late = () => rc.event("CANCELLATION", user.id, PROMO, { expiration_at_ms: originalEnd, cancel_reason: "DEVELOPER_INITIATED" });
  assert.equal((await webhook(late())).status, 200);
  assert.equal((await premiumOf(user)).entitled, false);

  rc.fail({ status: 503, kind: "subscriber", times: 1 });
  const fallback = await webhook(late());
  assert.equal(fallback.status, 200);
  assert.notEqual(fallback.body.resynced, true);
  assert.equal((await premiumOf(user)).entitled, false);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false);
});

test("volver a conceder con una promocional viva: manda la nueva fecha, y el EXPIRATION de la anterior no la quita", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await adminCall(admin, "grant", user, preset("1m"));
  const res = await adminCall(admin, "grant", user, preset("1d"));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const newEnd = new Date((await premiumOf(user)).expiresAt).getTime();
  assert.ok(Math.abs(newEnd - (Date.now() + DAY)) < 5000, "la caducidad es la de la nueva concesión");

  // RevenueCat avisa de que la promocional revocada (la de 1 mes) terminó.
  const oldPromoExpired = () => rc.event("EXPIRATION", user.id, PROMO, { expiration_at_ms: Date.now() - 1000 });
  await webhook(oldPromoExpired());
  assert.equal((await premiumOf(user)).entitled, true);

  // Igual si RevenueCat no responde y se aplica el evento tal cual: habla de
  // un periodo anterior al vigente.
  await BillingCustomer().updateOne({ appUserId: user.id }, { $set: { lastEventAt: new Date(Date.now() - DAY) } });
  rc.fail({ status: 0, kind: "subscriber", times: 1 });
  const fallback = await webhook(oldPromoExpired());
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.mappingOnly, true);
  const stored = await premiumOf(user);
  assert.equal(stored.entitled, true);
  assert.equal(new Date(stored.expiresAt).getTime(), newEnd);
});

// --- Management frente a suscripciones de tienda ---------------------------------------------

test("con suscripción de tienda vigente no se concede, amplía ni quita desde management (409) y no se llama a promotional", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await buyInStore(user);

  for (const action of ["grant", "extend", "revoke"]) {
    const res = await adminCall(admin, action, user, preset("1w"));
    assert.equal(res.status, 409, `${action}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(rc.callsFor(user.id, "promotional").length, 0);
  assert.equal(rc.callsFor(user.id, "revoke_promotionals").length, 0);
});

test("BUG: tienda caducada con entitled=true en BD (EXPIRATION perdido) ya no bloquea conceder desde management", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await buyInStore(user, { days: 30 });
  rc.expire(user.id, MONTHLY);
  await elapse(31 * DAY, user);
  assert.equal((await premiumOf(user)).entitled, true, "la BD sigue diciendo entitled");

  const res = await adminCall(admin, "grant", user, preset("1w"));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.premium.source, "manual");
});

test("si la BD no sabe de una compra de tienda (webhook perdido) pero RevenueCat sí, conceder da 409", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  rc.purchase(user.id, MONTHLY, { days: 30 });

  const res = await adminCall(admin, "grant", user, preset("1w"));
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(rc.callsFor(user.id, "promotional").length, 0);
});

test("errores de RevenueCat al conceder: 502 (nunca su 401, que cerraría la sesión del admin) y la BD no cambia", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();

  rc.fail({ status: 401, kind: "promotional", times: 1, message: "Invalid API key" });
  const unauthorized = await adminCall(admin, "grant", user, preset("1d"));
  assert.equal(unauthorized.status, 502, JSON.stringify(unauthorized.body));

  rc.fail({ status: 0, kind: "subscriber", times: 1 });
  const network = await adminCall(admin, "grant", user, preset("1d"));
  assert.equal(network.status, 502, JSON.stringify(network.body));

  assert.equal((await premiumOf(user)).entitled ?? false, false);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false);
});

test("sin REVENUECAT_SECRET_API_KEY, conceder y quitar fallan (500, sin detalles) y sin tocar la BD", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  delete process.env.REVENUECAT_SECRET_API_KEY;
  try {
    const res = await adminCall(admin, "grant", user, preset("1d"));
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.body.message, /API key/);
    assert.equal((await adminCall(admin, "revoke", user)).status, 500);
  } finally {
    process.env.REVENUECAT_SECRET_API_KEY = API_KEY;
  }
  assert.equal(rc.callsFor(user.id).length, 0);
});

// --- Job de reconciliación (04:00) -------------------------------------------------------------

test("job: a quien caducó su tiempo concedido y no abre la app se le quita en BD (RevenueCat lo confirma)", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await adminCall(admin, "grant", user, preset("1d"));
  await elapse(2 * DAY, user);

  const summary = await billing().runExpiredPremiumReconciliation();
  assert.ok(summary.reconciled >= 1);
  const stored = await premiumOf(user);
  assert.equal(stored.entitled, false);
  const view = await managementView(admin, user);
  assert.equal(view.row.premium.entitled, false);
});

test("job: si el webhook perdido era una RENEWAL, mantiene el PRO con la nueva fecha; si RevenueCat no responde, no degrada a nadie", async () => {
  const renewed = await ctx.makeClient();
  await buyInStore(renewed, { days: 30 });
  await elapse(31 * DAY, renewed);
  rc.renew(renewed.id, MONTHLY, { days: 30 }); // RevenueCat renovó; su webhook no llegó

  const unreachable = await ctx.makeClient({ fields: { premium: { entitled: true, source: "revenuecat", plan: "monthly", expiresAt: new Date(Date.now() - DAY) } } });

  // RevenueCat solo falla (timeout) para `unreachable`.
  const realGet = require("axios").get;
  require("axios").get = (url, config) => (url.endsWith(`/subscribers/${unreachable.id}`)
    ? Promise.reject(Object.assign(new Error("timeout"), { isAxiosError: true, code: "ECONNABORTED" }))
    : realGet(url, config));
  let summary;
  try {
    summary = await billing().runExpiredPremiumReconciliation();
  } finally {
    require("axios").get = realGet;
  }

  assert.ok(summary.skipped >= 1);
  const renewedPremium = await premiumOf(renewed);
  assert.equal(renewedPremium.entitled, true);
  assert.ok(new Date(renewedPremium.expiresAt).getTime() > Date.now() + 25 * DAY);
  assert.equal((await premiumOf(unreachable)).entitled, true, "no se degrada por un fallo de red");
  assert.equal((await ctx.get(unreachable, "/billing/entitlements/me")).isPremium, false, "pero no es PRO: su fecha pasó");
});

test("job: recorre todos los caducados por lotes (antes solo los 200 primeros) y sin clave de RevenueCat se fía de la fecha", async () => {
  const expired = { premium: { entitled: true, source: "manual", plan: "manual", expiresAt: new Date(Date.now() - DAY) } };
  const users = [];
  for (let i = 0; i < 5; i += 1) users.push(await ctx.makeClient({ fields: expired }));
  const alive = await ctx.makeClient({ fields: { premium: { ...expired.premium, expiresAt: new Date(Date.now() + DAY) } } });

  const summary = await billing().runExpiredPremiumReconciliation({ batchSize: 2 });
  assert.ok(summary.candidates >= 5);
  for (const user of users) assert.equal((await premiumOf(user)).entitled, false);
  assert.equal((await premiumOf(alive)).entitled, true, "el que sigue vigente no se toca");

  const lateUser = await ctx.makeClient({ fields: expired });
  delete process.env.REVENUECAT_SECRET_API_KEY;
  try {
    const offline = await billing().runExpiredPremiumReconciliation();
    assert.ok(offline.selfHealed >= 1);
  } finally {
    process.env.REVENUECAT_SECRET_API_KEY = API_KEY;
  }
  assert.equal((await premiumOf(lateUser)).entitled, false);
});

// --- Compras de tienda por webhook -------------------------------------------------------------

test("tienda: compra, renovación, cancelación (sigue PRO hasta el final) y expiración", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  await buyInStore(user, { days: 30 });
  let stored = await premiumOf(user);
  assert.equal(stored.source, "revenuecat");
  assert.equal(stored.plan, "monthly");
  assert.equal((await BillingCustomer().findOne({ appUserId: user.id }).lean()).willRenew, true);

  await elapse(30 * DAY - MINUTE, user);
  rc.renew(user.id, MONTHLY, { days: 30 });
  await webhook(rc.event("RENEWAL", user.id, MONTHLY));
  stored = await premiumOf(user);
  assert.ok(new Date(stored.expiresAt).getTime() > Date.now() + 29 * DAY);

  rc.cancel(user.id, MONTHLY);
  await webhook(rc.event("CANCELLATION", user.id, MONTHLY, { cancel_reason: "UNSUBSCRIBE" }));
  assert.equal((await premiumOf(user)).entitled, true, "cancelar no quita el acceso ya pagado");
  assert.equal((await BillingCustomer().findOne({ appUserId: user.id }).lean()).willRenew, false);
  assert.equal((await isPremiumEverywhere(admin, user)).management, true);

  await elapse(30 * DAY + MINUTE, user);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false, "sin PRO aunque el webhook tarde");
  await webhook(rc.event("EXPIRATION", user.id, MONTHLY, { expiration_reason: "UNSUBSCRIBE" }));
  assert.equal((await premiumOf(user)).entitled, false);
});

test("tienda: problema de cobro con periodo de gracia mantiene el PRO durante la gracia y lo quita al acabar", async () => {
  const user = await ctx.makeClient();
  await buyInStore(user, { days: 30 });
  await elapse(30 * DAY - MINUTE, user);
  rc.billingIssue(user.id, MONTHLY, { graceDays: 6 });
  await webhook(rc.event("BILLING_ISSUE", user.id, MONTHLY));

  await elapse(2 * MINUTE, user); // pasada la fecha de cobro, dentro de la gracia
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, true);
  await elapse(6 * DAY, user);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false);
});

test("tienda: un reembolso quita el PRO al momento", async () => {
  const user = await ctx.makeClient();
  await buyInStore(user);
  rc.refund(user.id, MONTHLY);
  await webhook(rc.event("CANCELLATION", user.id, MONTHLY, { cancel_reason: "CUSTOMER_SUPPORT", expiration_at_ms: Date.now() - 1000 }));
  assert.equal((await premiumOf(user)).entitled, false);
  assert.equal((await ctx.get(user, "/billing/entitlements/me")).isPremium, false);
});

test("caduca la promocional de alguien que además paga en tienda: sigue PRO (se mira el suscriptor entero, no solo el evento)", async () => {
  const user = await ctx.makeClient();
  // Tenía tiempo concedido y después compró en la tienda.
  await User().updateOne({ _id: user._id }, { $set: { premium: { entitled: true, source: "manual", plan: "manual", expiresAt: new Date(Date.now() + DAY) } } });
  rc.purchase(user.id, MONTHLY, { days: 30 });
  await webhook(rc.event("INITIAL_PURCHASE", user.id, MONTHLY));

  const promoEvent = rc.event("EXPIRATION", user.id, null, { product_id: PROMO, store: "PROMOTIONAL", expiration_at_ms: Date.now() - 1000 });
  const res = await webhook(promoEvent);
  assert.equal(res.body.resynced, true);
  const stored = await premiumOf(user);
  assert.equal(stored.entitled, true);
  assert.equal(stored.source, "revenuecat");
});

test("transferencia de la compra a otra cuenta: el que la pierde deja de ser PRO y el que la recibe pasa a serlo", async () => {
  const from = await ctx.makeClient();
  const to = await ctx.makeClient();
  await buyInStore(from);
  rc.transfer(from.id, to.id);

  const res = await webhook(rc.event("TRANSFER", from.id, null, { app_user_id: undefined, transferred_from: [from.id], transferred_to: [to.id] }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await premiumOf(from)).entitled, false);
  assert.equal((await premiumOf(to)).entitled, true);
  assert.equal((await ctx.get(to, "/billing/entitlements/me")).isPremium, true);
});

test("webhook: autenticación (Bearer o el secreto tal cual), duplicados, sin app_user_id y usuario desconocido", async () => {
  const user = await ctx.makeClient();
  rc.purchase(user.id, MONTHLY);
  const event = rc.event("INITIAL_PURCHASE", user.id, MONTHLY);

  assert.equal((await webhook(event, null)).status, 401);
  assert.equal((await webhook(event, "Bearer otro")).status, 401);
  assert.equal((await premiumOf(user)).entitled ?? false, false);

  const ok = await webhook(event, WEBHOOK_SECRET);
  assert.equal(ok.status, 200);
  assert.equal((await premiumOf(user)).entitled, true);
  const lookups = rc.callsFor(user.id, "subscriber").length;
  const dup = await webhook(event);
  assert.equal(dup.body.duplicated, true);
  assert.equal(rc.callsFor(user.id, "subscriber").length, lookups, "un duplicado no vuelve a procesarse");

  const anonymous = await webhook({ event: { id: `evt-anon-${Date.now()}`, type: "INITIAL_PURCHASE", product_id: MONTHLY } });
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.reason, "missing_app_user_id");

  const unknown = await webhook({ event: { id: `evt-test-${Date.now()}`, type: "TEST", app_user_id: "$RCAnonymousID:desconocido", product_id: MONTHLY, expiration_at_ms: Date.now() + DAY } });
  assert.equal(unknown.status, 200, JSON.stringify(unknown.body));
});

test("webhook con RevenueCat caído: se aplica el evento; uno anterior al último aplicado se descarta; la expiración real sí quita", async () => {
  const user = await ctx.makeClient();
  rc.fail({ status: 503, kind: "subscriber", times: 3 });
  const end = Date.now() + 30 * DAY;
  const evt = (type, extra) => ({ event: { id: `evt-${type}-${Date.now()}-${Math.random()}`, type, app_user_id: user.id, product_id: MONTHLY, store: "APP_STORE", expiration_at_ms: end, event_timestamp_ms: Date.now(), ...extra } });

  assert.equal((await webhook(evt("INITIAL_PURCHASE"))).body.resynced, undefined);
  assert.equal((await premiumOf(user)).entitled, true);

  const stale = await webhook(evt("EXPIRATION", { event_timestamp_ms: Date.now() - DAY }));
  assert.equal(stale.body.reason, "stale_event");
  assert.equal((await premiumOf(user)).entitled, true);

  await elapse(30 * DAY + MINUTE, user);
  await webhook(evt("EXPIRATION", { expiration_at_ms: end - 30 * DAY - MINUTE }));
  assert.equal((await premiumOf(user)).entitled, false);
});

test("webhook con RevenueCat caído: un reembolso del producto vigente quita el PRO; la expiración del producto anterior a un cambio de plan no", async () => {
  const refunded = await ctx.makeClient();
  rc.fail({ status: 503, kind: "subscriber", times: 10 });
  const evt = (user, type, productId, extra) => ({ event: { id: `evt-${type}-${Date.now()}-${Math.random()}`, type, app_user_id: user.id, product_id: productId, store: "APP_STORE", event_timestamp_ms: Date.now(), ...extra } });

  await webhook(evt(refunded, "INITIAL_PURCHASE", MONTHLY, { expiration_at_ms: Date.now() + 30 * DAY }));
  await webhook(evt(refunded, "CANCELLATION", MONTHLY, { cancel_reason: "CUSTOMER_SUPPORT", expiration_at_ms: Date.now() - 1000 }));
  assert.equal((await premiumOf(refunded)).entitled, false);

  const upgraded = await ctx.makeClient();
  await webhook(evt(upgraded, "INITIAL_PURCHASE", MONTHLY, { expiration_at_ms: Date.now() + 30 * DAY }));
  await webhook(evt(upgraded, "PRODUCT_CHANGE", "trainfit_pro_annual", { expiration_at_ms: Date.now() + 365 * DAY, new_product_id: "trainfit_pro_annual" }));
  await webhook(evt(upgraded, "EXPIRATION", MONTHLY, { expiration_at_ms: Date.now() - 1000 }));
  const stored = await premiumOf(upgraded);
  assert.equal(stored.entitled, true);
  assert.equal(stored.plan, "annual");
  rc.clearFailures();
});

// --- Restaurar compras y enlace del cliente --------------------------------------------------------

test("restaurar: con RevenueCat configurado manda su API, no el CustomerInfo que manda el cliente (falsificable)", async () => {
  const user = await ctx.makeClient();
  const forged = {
    entitlements: {
      active: {
        no_adds_and_features: { identifier: "no_adds_and_features", isActive: true, willRenew: true, expirationDate: "2099-01-01T00:00:00.000Z", productIdentifier: "trainfit_pro_annual", store: "APP_STORE" },
      },
    },
  };
  const res = await ctx.post(user, "/billing/restore", { customerInfo: forged });
  assert.equal(res.isPremium, false);
  assert.equal((await premiumOf(user)).entitled, false);

  rc.purchase(user.id, "trainfit_pro_annual", { days: 365 });
  const real = await ctx.post(user, "/billing/restore", {});
  assert.equal(real.isPremium, true);
  assert.equal(real.plan, "annual");
});

test("restaurar: el appUserId que manda el cliente se ignora (no se puede quedar con la suscripción de otro)", async () => {
  const victim = await ctx.makeClient();
  const attacker = await ctx.makeClient();
  await buyInStore(victim);

  const victimLookups = rc.callsFor(victim.id).length;
  const res = await ctx.post(attacker, "/billing/restore", { appUserId: victim.id });
  assert.equal(res.isPremium, false);
  assert.equal(rc.callsFor(victim.id).length, victimLookups, "no se consulta al suscriptor de la víctima");

  const link = await ctx.post(attacker, "/billing/customer/link", { appUserId: victim.id });
  assert.equal(link.appUserId, attacker.id);
  const victimCustomer = await BillingCustomer().findOne({ appUserId: victim.id }).lean();
  assert.equal(String(victimCustomer.userId), victim.id, "el cliente de RevenueCat de la víctima sigue siendo suyo");
  await billing().runExpiredPremiumReconciliation();
  assert.equal((await premiumOf(attacker)).entitled ?? false, false);
});

test("restaurar con RevenueCat caído: se usa el CustomerInfo del SDK; uno en caché con la promocional ya caducada no da PRO", async () => {
  const user = await ctx.makeClient();
  rc.fail({ status: 0, kind: "subscriber", times: 2 });
  const staleCache = {
    entitlements: {
      active: {
        no_adds_and_features: { identifier: "no_adds_and_features", isActive: true, willRenew: false, expirationDate: new Date(Date.now() - MINUTE).toISOString(), productIdentifier: PROMO, store: "PROMOTIONAL" },
      },
    },
  };
  const res = await ctx.post(user, "/billing/restore", { customerInfo: staleCache });
  assert.equal(res.isPremium, false);

  const fresh = {
    entitlements: {
      active: {
        no_adds_and_features: { identifier: "no_adds_and_features", isActive: true, willRenew: true, expirationDate: new Date(Date.now() + 30 * DAY).toISOString(), productIdentifier: "trainfit_pro", store: "PLAY_STORE" },
      },
    },
  };
  const bought = await ctx.post(user, "/billing/restore", { customerInfo: fresh, plan: "annual" });
  assert.equal(bought.isPremium, true);
  assert.equal(bought.plan, "annual", "plan de base plan de Google Play: lo dice el front");
});

test("restaurar con base plan de Google Play (producto sin sufijo): conserva el plan conocido", async () => {
  const user = await ctx.makeClient();
  rc.purchase(user.id, "trainfit_pro", { days: 30, store: "play_store" });
  const first = await ctx.post(user, "/billing/restore", { plan: "monthly" });
  assert.equal(first.plan, "monthly");
  const again = await ctx.post(user, "/billing/restore", {});
  assert.equal(again.plan, "monthly", "sin plan explícito se mantiene el de BD");
});

test("abrir la app (enlace del cliente) no hace que un webhook posterior se descarte por antiguo", async () => {
  const user = await ctx.makeClient();
  rc.fail({ status: 503, kind: "subscriber", times: 2 });
  const t0 = Date.now() - 10 * MINUTE;
  await webhook({ event: { id: `evt-a-${Date.now()}`, type: "INITIAL_PURCHASE", app_user_id: user.id, product_id: MONTHLY, store: "APP_STORE", expiration_at_ms: Date.now() + MINUTE, event_timestamp_ms: t0 } });

  // Renovó hace 5 min; el usuario abre la app ahora y el webhook llega después.
  await ctx.post(user, "/billing/customer/link", {});
  const renewal = { event: { id: `evt-b-${Date.now()}`, type: "RENEWAL", app_user_id: user.id, product_id: MONTHLY, store: "APP_STORE", expiration_at_ms: Date.now() + 30 * DAY, event_timestamp_ms: Date.now() - 5 * MINUTE } };
  const res = await webhook(renewal);
  assert.notEqual(res.body.reason, "stale_event");
  assert.ok(new Date((await premiumOf(user)).expiresAt).getTime() > Date.now() + 29 * DAY);
});
