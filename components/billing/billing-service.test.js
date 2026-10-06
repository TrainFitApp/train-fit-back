const test = require("node:test");
const assert = require("node:assert/strict");

// Piezas puras de la facturación de cliente con RevenueCat: cómo se lee un
// webhook, el suscriptor de su API y el CustomerInfo del SDK, y las reglas de
// management (fechas, tienda vigente, eventos de un periodo anterior). Los
// flujos completos (con BD y un RevenueCat simulado) están en
// integration/billing-revenuecat.test.js.

const billing = require("./billing-service");

const DAY = 24 * 60 * 60 * 1000;
const ENT = billing.entitlementId;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const PROMO = `rc_promo_${ENT}_custom`;

function webhookEvent(type, overrides = {}) {
  return {
    event: {
      id: `evt-${type}`,
      type,
      app_user_id: "64b000000000000000000001",
      product_id: "trainfit_pro_monthly",
      store: "APP_STORE",
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 10 * DAY,
      ...overrides,
    },
  };
}

test("parseWebhookEvent: acceso y renovación según el tipo de evento", async (t) => {
  const cases = [
    ["INITIAL_PURCHASE", {}, { entitled: true, willRenew: true, apply: true }],
    ["RENEWAL", {}, { entitled: true, willRenew: true, apply: true }],
    ["UNCANCELLATION", { will_renew: true }, { entitled: true, willRenew: true, apply: true }],
    ["PRODUCT_CHANGE", { period_type: "NORMAL" }, { entitled: true, willRenew: true, apply: true }],
    ["NON_RENEWING_PURCHASE", { period_type: "PROMOTIONAL" }, { entitled: true, willRenew: false, apply: true }],
    ["TEMPORARY_ENTITLEMENT_GRANT", { expiration_at_ms: Date.now() + 3600000, period_type: "TRIAL" }, { entitled: true, willRenew: false, apply: true }],
    ["BILLING_ISSUE", {}, { entitled: true, willRenew: false, apply: true }],
    ["EXPIRATION", {}, { entitled: false, willRenew: false, apply: true }],
    ["REFUND", {}, { entitled: false, willRenew: false, apply: true }],
    ["REVOKE", {}, { entitled: false, willRenew: false, apply: true }],
    // Cancelar con acceso por delante: no toca el acceso (ni lo da ni lo quita).
    ["CANCELLATION", {}, { entitled: false, willRenew: false, apply: false }],
    // Cancelar con la fecha ya pasada (reembolso, promocional revocada): lo corta.
    ["CANCELLATION", { expiration_at_ms: Date.now() - 1000 }, { entitled: false, willRenew: false, apply: true }],
    ["TRANSFER", {}, { entitled: false, willRenew: false, apply: false }],
    ["SUBSCRIBER_ALIAS", {}, { entitled: false, willRenew: false, apply: false }],
    ["INITIAL_PURCHASE", { expiration_at_ms: Date.now() - 1000 }, { entitled: false, willRenew: true, apply: true }],
    ["RENEWAL", { expiration_at_ms: null }, { entitled: false, willRenew: true, apply: true }],
  ];
  for (const [type, overrides, expected] of cases) {
    await t.test(`${type} ${JSON.stringify(overrides)}`, () => {
      const event = billing.parseWebhookEvent(webhookEvent(type, overrides));
      assert.equal(event.type, type);
      assert.equal(event.entitled, expected.entitled);
      assert.equal(event.willRenew, expected.willRenew);
      assert.equal(event.applyEntitlementUpdate, expected.apply);
    });
  }
});

test("parseWebhookEvent: promocionales, gracia, transferencias y campos de RevenueCat", async (t) => {
  await t.test("una promocional es manual y nunca se renueva", () => {
    const event = billing.parseWebhookEvent(webhookEvent("RENEWAL", { store: "PROMOTIONAL", product_id: PROMO }));
    assert.equal(event.source, "manual");
    assert.equal(event.plan, "manual");
    assert.equal(event.willRenew, false);
    assert.equal(billing.parseWebhookEvent(webhookEvent("RENEWAL", { store: "APP_STORE", product_id: "rc_promo_x_monthly" })).source, "manual");
  });

  await t.test("BILLING_ISSUE en periodo de gracia: el acceso dura hasta el fin de la gracia", () => {
    const graceEnd = Date.now() + 6 * DAY;
    const event = billing.parseWebhookEvent(webhookEvent("BILLING_ISSUE", { expiration_at_ms: Date.now() - 1000, grace_period_expiration_at_ms: graceEnd }));
    assert.equal(event.entitled, true);
    assert.equal(event.expiresAt.getTime(), graceEnd);
  });

  await t.test("TRANSFER sin app_user_id toma el destinatario", () => {
    const event = billing.parseWebhookEvent(webhookEvent("TRANSFER", { app_user_id: undefined, transferred_from: ["a"], transferred_to: ["b"] }));
    assert.equal(event.appUserId, "b");
    assert.deepEqual(event.transferredFrom, ["a"]);
    assert.deepEqual(event.transferredTo, ["b"]);
  });

  await t.test("acepta el payload sin envoltorio `event`, fechas ISO y tipo en minúsculas", () => {
    const event = billing.parseWebhookEvent({ type: "renewal", id: "x", app_user_id: "u", expiration_at: iso(DAY), event_timestamp: iso(-1000) });
    assert.equal(event.type, "RENEWAL");
    assert.equal(event.entitled, true);
    assert.ok(event.eventTimestamp.getTime() < Date.now());
  });

  await t.test("sin id genera uno distinto por evento; entitlement por defecto", () => {
    const raw = { event: { type: "RENEWAL", app_user_id: "u", event_timestamp_ms: 1 } };
    assert.notEqual(billing.parseWebhookEvent(raw).eventId, billing.parseWebhookEvent(raw).eventId);
    assert.equal(billing.parseWebhookEvent(raw).activeEntitlement, ENT);
  });

  await t.test("will_renew / auto_renew_status explícitos mandan en eventos genéricos", () => {
    assert.equal(billing.parseWebhookEvent(webhookEvent("SUBSCRIPTION_EXTENDED", { auto_renew_status: "0" })).willRenew, false);
    assert.equal(billing.parseWebhookEvent(webhookEvent("SUBSCRIPTION_EXTENDED", { auto_renew_status: 1 })).willRenew, true);
    assert.equal(billing.parseWebhookEvent(webhookEvent("BILLING_ISSUE", { will_renew: true })).willRenew, true);
  });

  await t.test("plan por productId", () => {
    assert.equal(billing.parseWebhookEvent(webhookEvent("RENEWAL", { product_id: "trainfit_pro_annual" })).plan, "annual");
    assert.equal(billing.parseWebhookEvent(webhookEvent("RENEWAL", { product_id: "trainfit_pro" })).plan, "unknown");
  });
});

function subscriber({ entitlement, subscriptions = {} } = {}) {
  return { original_app_user_id: "u", entitlements: entitlement ? { [ENT]: entitlement } : {}, subscriptions };
}

test("parseRCSubscriberPayload: estado del suscriptor según la API de RevenueCat", async (t) => {
  await t.test("promocional vigente: manual, sin renovación, con su fecha", () => {
    const end = iso(DAY);
    const state = billing.parseRCSubscriberPayload(subscriber({
      entitlement: { expires_date: end, product_identifier: PROMO },
      subscriptions: { [PROMO]: { expires_date: end, store: "promotional", unsubscribe_detected_at: null } },
    }));
    assert.equal(state.entitled, true);
    assert.equal(state.source, "manual");
    assert.equal(state.plan, "manual");
    assert.equal(state.willRenew, false);
    assert.equal(state.expiresAt.toISOString(), end);
  });

  await t.test("promocional caducada (sigue listada con fecha pasada): no entitled", () => {
    const end = iso(-DAY);
    const state = billing.parseRCSubscriberPayload(subscriber({
      entitlement: { expires_date: end, product_identifier: PROMO },
      subscriptions: { [PROMO]: { expires_date: end, store: "promotional" } },
    }));
    assert.equal(state.entitled, false);
    assert.equal(state.expiresAt.toISOString(), end);
    assert.equal(state.activeEntitlement, ENT);
  });

  await t.test("promocional caducada + tienda vigente: manda la tienda", () => {
    const state = billing.parseRCSubscriberPayload(subscriber({
      entitlement: { expires_date: iso(-DAY), product_identifier: PROMO },
      subscriptions: {
        [PROMO]: { expires_date: iso(-DAY), store: "promotional" },
        trainfit_pro_monthly: { expires_date: iso(20 * DAY), store: "app_store", unsubscribe_detected_at: null },
      },
    }));
    assert.equal(state.entitled, true);
    assert.equal(state.source, "revenuecat");
    assert.equal(state.plan, "monthly");
    assert.equal(state.productId, "trainfit_pro_monthly");
    assert.equal(state.willRenew, true);
  });

  await t.test("dos productos vigentes: el que acaba más tarde", () => {
    const state = billing.parseRCSubscriberPayload(subscriber({
      subscriptions: {
        trainfit_pro_monthly: { expires_date: iso(5 * DAY), store: "play_store" },
        trainfit_pro_annual: { expires_date: iso(300 * DAY), store: "play_store" },
      },
    }));
    assert.equal(state.productId, "trainfit_pro_annual");
    assert.equal(state.plan, "annual");
  });

  await t.test("cancelada pero vigente: entitled sin renovación", () => {
    const state = billing.parseRCSubscriberPayload(subscriber({
      subscriptions: { trainfit_pro_monthly: { expires_date: iso(5 * DAY), store: "app_store", unsubscribe_detected_at: iso(-DAY) } },
    }));
    assert.equal(state.entitled, true);
    assert.equal(state.willRenew, false);
  });

  await t.test("periodo de gracia: sigue entitled hasta el fin de la gracia", () => {
    const graceEnd = iso(4 * DAY);
    const state = billing.parseRCSubscriberPayload(subscriber({
      entitlement: { expires_date: iso(-DAY), grace_period_expires_date: graceEnd, product_identifier: "trainfit_pro_monthly" },
      subscriptions: { trainfit_pro_monthly: { expires_date: iso(-DAY), grace_period_expires_date: graceEnd, store: "app_store", billing_issues_detected_at: iso(-DAY) } },
    }));
    assert.equal(state.entitled, true);
    assert.equal(state.expiresAt.toISOString(), graceEnd);
  });

  await t.test("suscriptor vacío: sin acceso ni entitlement", () => {
    const state = billing.parseRCSubscriberPayload(subscriber());
    assert.equal(state.entitled, false);
    assert.equal(state.expiresAt, null);
    assert.equal(state.activeEntitlement, null);
    assert.equal(billing.parseRCSubscriberPayload(null).entitled, false);
  });
});

test("parseSDKCustomerInfo: CustomerInfo del SDK", async (t) => {
  const info = (entitlement) => ({ entitlements: { active: entitlement ? { [ENT]: { identifier: ENT, ...entitlement } } : {} } });

  await t.test("tienda activa", () => {
    const state = billing.parseSDKCustomerInfo(info({ isActive: true, willRenew: true, expirationDate: iso(DAY), productIdentifier: "trainfit_pro_monthly", store: "APP_STORE" }));
    assert.equal(state.entitled, true);
    assert.equal(state.source, "revenuecat");
    assert.equal(state.plan, "monthly");
    assert.equal(state.willRenew, true);
  });

  await t.test("promocional: manual y sin renovación aunque el SDK diga willRenew", () => {
    const state = billing.parseSDKCustomerInfo(info({ isActive: true, willRenew: true, expirationDate: iso(DAY), productIdentifier: PROMO, store: "PROMOTIONAL" }));
    assert.equal(state.source, "manual");
    assert.equal(state.plan, "manual");
    assert.equal(state.willRenew, false);
  });

  await t.test("sin entitlements activos: no entitled", () => {
    assert.equal(billing.parseSDKCustomerInfo(info(null)).entitled, false);
    assert.equal(billing.parseSDKCustomerInfo(null).entitled, false);
  });

  await t.test("caché vieja (isActive con fecha pasada): se guarda la fecha y el acceso efectivo la respeta", () => {
    const { isEffectivelyEntitled } = require("./feature-access");
    const state = billing.parseSDKCustomerInfo(info({ isActive: true, expirationDate: iso(-1000), productIdentifier: PROMO, store: "PROMOTIONAL" }));
    assert.equal(isEffectivelyEntitled({ entitled: state.entitled, expiresAt: state.expiresAt }), false);
  });
});

test("management: fecha de fin de una concesión", async (t) => {
  await t.test("se manda end_time_ms exacto (sin duration ni start_time_ms)", () => {
    const target = new Date(Date.now() + 10 * DAY + 12345);
    assert.deepEqual(billing.getPromotionPayloadForTarget(target), { end_time_ms: target.getTime() });
  });

  await t.test("pasada, ahora mismo, no válida o de más de 1 año: 400", () => {
    for (const target of [new Date(Date.now() - 1), new Date(Date.now()), "x", new Date(Date.now() + 366 * DAY)]) {
      assert.throws(() => billing.getPromotionPayloadForTarget(target), (error) => error.status === 400);
    }
    assert.doesNotThrow(() => billing.getPromotionPayloadForTarget(new Date(Date.now() + 365 * DAY - 1000)));
  });

  await t.test("conceder cuenta desde ahora; ampliar desde el fin del manual vigente", () => {
    const activeEnd = new Date(Date.now() + 5 * DAY);
    const manual = { premium: { entitled: true, source: "manual", expiresAt: activeEnd } };
    const near = (date, ms) => assert.ok(Math.abs(date.getTime() - ms) < 1000, `${date.toISOString()} vs ${new Date(ms).toISOString()}`);
    near(billing.resolveTargetExpiration(manual, { type: "preset", value: "1w" }, "grant"), Date.now() + 7 * DAY);
    near(billing.resolveTargetExpiration(manual, { type: "preset", value: "1w" }, "extend"), activeEnd.getTime() + 7 * DAY);
    near(billing.resolveTargetExpiration(manual, { type: "preset", value: "1d" }, "extend"), activeEnd.getTime() + DAY);
  });

  await t.test("ampliar un manual caducado (o un premium de tienda) cuenta desde ahora", () => {
    const near = (date, ms) => assert.ok(Math.abs(date.getTime() - ms) < 1000);
    const expiredManual = { premium: { entitled: true, source: "manual", expiresAt: new Date(Date.now() - DAY) } };
    const store = { premium: { entitled: true, source: "revenuecat", expiresAt: new Date(Date.now() + 20 * DAY) } };
    near(billing.resolveTargetExpiration(expiredManual, { type: "preset", value: "1m" }, "extend"), Date.now() + 31 * DAY);
    near(billing.resolveTargetExpiration(store, { type: "preset", value: "1y" }, "extend"), Date.now() + 365 * DAY);
  });

  await t.test("fecha personalizada: tal cual, en conceder y en ampliar", () => {
    const target = iso(3 * DAY);
    assert.equal(billing.resolveTargetExpiration({}, { type: "customDate", expiresAt: target }, "extend").toISOString(), target);
  });

  await t.test("duraciones no válidas: 400", () => {
    for (const duration of [null, "1d", { type: "preset", value: "3d" }, { type: "customDate" }, { type: "other" }]) {
      assert.throws(() => billing.resolveTargetExpiration({}, duration, "grant"), (error) => error.status === 400);
    }
  });
});

test("management: ¿paga en tienda?", async (t) => {
  await t.test("isRealStorePremium solo con premium de tienda VIGENTE", () => {
    const store = (expiresAt) => ({ premium: { entitled: true, source: "revenuecat", expiresAt } });
    assert.equal(billing.isRealStorePremium(store(new Date(Date.now() + DAY)), null), true);
    assert.equal(billing.isRealStorePremium(store(new Date(Date.now() - 1000)), null), false, "EXPIRATION perdido: ya no paga");
    assert.equal(billing.isRealStorePremium({ premium: { entitled: true, source: "manual", expiresAt: new Date(Date.now() + DAY) } }, null), false);
    assert.equal(billing.isRealStorePremium({ premium: { entitled: false, source: "revenuecat" } }, null), false);
    assert.equal(billing.isRealStorePremium(store(new Date(Date.now() + DAY)), { store: "PROMOTIONAL" }), false);
    assert.equal(billing.isRealStorePremium({ premium: { entitled: true, expiresAt: new Date(Date.now() + DAY) } }, { store: "app_store" }), true);
  });

  await t.test("hasActiveStoreSubscription mira la API de RevenueCat, sin contar promocionales", () => {
    assert.equal(billing.hasActiveStoreSubscription(null), false);
    assert.equal(billing.hasActiveStoreSubscription(subscriber({ subscriptions: { [PROMO]: { expires_date: iso(DAY), store: "promotional" } } })), false);
    assert.equal(billing.hasActiveStoreSubscription(subscriber({ subscriptions: { trainfit_pro_monthly: { expires_date: iso(-DAY), store: "app_store" } } })), false);
    assert.equal(billing.hasActiveStoreSubscription(subscriber({ subscriptions: { trainfit_pro_monthly: { expires_date: iso(DAY), store: "app_store" } } })), true);
    assert.equal(
      billing.hasActiveStoreSubscription(subscriber({ subscriptions: { trainfit_pro_monthly: { expires_date: iso(-DAY), grace_period_expires_date: iso(DAY), store: "play_store" } } })),
      true,
      "en gracia cuenta como vigente",
    );
  });
});

test("orden de eventos y eventos de un periodo anterior", async (t) => {
  await t.test("shouldApplyEventByOrder: se descarta lo anterior al último aplicado", () => {
    const now = Date.now();
    assert.equal(billing.shouldApplyEventByOrder({ eventTimestamp: new Date(now) }, { lastEventAt: new Date(now - 1000) }), true);
    assert.equal(billing.shouldApplyEventByOrder({ eventTimestamp: new Date(now) }, { lastEventAt: new Date(now) }), true);
    assert.equal(billing.shouldApplyEventByOrder({ eventTimestamp: new Date(now - 1000) }, { lastEventAt: new Date(now) }), false);
    assert.equal(billing.shouldApplyEventByOrder({ eventTimestamp: new Date(now) }, null), true);
    assert.equal(billing.shouldApplyEventByOrder({ eventTimestamp: new Date(now) }, { lastEventAt: null }), true);
  });

  await t.test("refersToOlderPeriod", () => {
    const user = { premium: { entitled: true, expiresAt: new Date(Date.now() + 10 * DAY) } };
    const customer = { productId: "trainfit_pro_annual" };
    const evt = (type, productId, expiresInMs, source = "revenuecat") => ({ type, productId, source, expiresAt: new Date(Date.now() + expiresInMs) });

    assert.equal(billing.refersToOlderPeriod(evt("EXPIRATION", PROMO, -1000, "manual"), user, { productId: PROMO }), true, "promocional revocada para conceder otra");
    assert.equal(billing.refersToOlderPeriod(evt("CANCELLATION", PROMO, 5 * DAY, "manual"), user, { productId: PROMO }), true);
    assert.equal(billing.refersToOlderPeriod(evt("EXPIRATION", "trainfit_pro_monthly", -1000), user, customer), true, "producto anterior a un cambio de plan");
    assert.equal(billing.refersToOlderPeriod(evt("CANCELLATION", "trainfit_pro_annual", -1000), user, customer), false, "reembolso del producto vigente");
    assert.equal(billing.refersToOlderPeriod(evt("EXPIRATION", "trainfit_pro_annual", 10 * DAY), user, customer), false, "expiración del periodo vigente");
    assert.equal(billing.refersToOlderPeriod(evt("RENEWAL", "trainfit_pro_monthly", -1000), user, customer), false);
    assert.equal(
      billing.refersToOlderPeriod(evt("EXPIRATION", "trainfit_pro_monthly", -1000), { premium: { entitled: true, expiresAt: new Date(Date.now() - 1) } }, customer),
      false,
      "si ya no tiene acceso no hay periodo vigente que proteger",
    );
  });
});

test("validateWebhookAuth: falla cerrado sin secreto (salvo desarrollo); acepta Bearer o el secreto tal cual", () => {
  const saved = { auth: process.env.REVENUECAT_WEBHOOK_AUTH, secret: process.env.REVENUECAT_WEBHOOK_SECRET, env: process.env.NODE_ENV };
  const originalError = console.error;
  console.error = () => {};
  try {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    assert.equal(billing.validateWebhookAuth({ headers: { authorization: "Bearer cualquiera" } }), false);
    process.env.NODE_ENV = "development";
    assert.equal(billing.validateWebhookAuth({ headers: {} }), true);

    process.env.NODE_ENV = "production";
    process.env.REVENUECAT_WEBHOOK_AUTH = "s3cr3t";
    assert.equal(billing.validateWebhookAuth({ headers: {} }), false);
    assert.equal(billing.validateWebhookAuth({ headers: { authorization: "Bearer otro" } }), false);
    assert.equal(billing.validateWebhookAuth({ headers: { authorization: "Bearer s3cr3t" } }), true);
    assert.equal(billing.validateWebhookAuth({ headers: { authorization: " s3cr3t " } }), true);

    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    process.env.REVENUECAT_WEBHOOK_SECRET = "legacy";
    assert.equal(billing.validateWebhookAuth({ headers: { authorization: "Bearer legacy" } }), true, "nombre antiguo de la variable");
  } finally {
    console.error = originalError;
    for (const [key, name] of [["auth", "REVENUECAT_WEBHOOK_AUTH"], ["secret", "REVENUECAT_WEBHOOK_SECRET"], ["env", "NODE_ENV"]]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  }
});

test("derivePlan", () => {
  assert.equal(billing.derivePlan("trainfit_pro_monthly"), "monthly");
  assert.equal(billing.derivePlan("pro_mensual"), "monthly");
  assert.equal(billing.derivePlan("trainfit_pro_annual"), "annual");
  assert.equal(billing.derivePlan("pro_anual"), "annual");
  assert.equal(billing.derivePlan("pro_yearly"), "annual");
  assert.equal(billing.derivePlan("trainfit_pro"), "unknown");
  assert.equal(billing.derivePlan(null), "unknown");
});
