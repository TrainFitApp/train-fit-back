// RevenueCat de mentira para los tests de integración: sustituye axios.get y
// axios.post (los que usa components/billing/billing-service.js) y responde
// como la API v1 real a las tres llamadas que hace el backend:
//
//   GET  /v1/subscribers/:id
//   POST /v1/subscribers/:id/entitlements/:entitlement/promotional   { end_time_ms }
//   POST /v1/subscribers/:id/entitlements/:entitlement/revoke_promotionals
//
// Guarda el estado de cada suscriptor (productos de tienda y promocionales)
// para que el test pueda "comprar", "renovar", "cancelar", "transferir"... y
// generar el webhook que RevenueCat mandaría. `shift(ms)` hace pasar el
// tiempo: resta `ms` a todas las fechas guardadas (equivale a esperar).
//
// Uso:
//
//   const rc = createFakeRevenueCat({ apiKey: "sk_test" });
//   rc.install();            // en before()
//   rc.uninstall();          // en after()

const axios = require("axios");

const DAY = 24 * 60 * 60 * 1000;

function httpError(status, message) {
  const error = new Error(`Request failed with status code ${status}`);
  error.isAxiosError = true;
  error.response = { status, data: { code: status, message } };
  return error;
}

function createFakeRevenueCat({ apiKey, entitlementId = "no_adds_and_features" } = {}) {
  const subscribers = new Map();
  const calls = [];
  const failures = [];
  let originalGet = null;
  let originalPost = null;
  let seq = 0;

  const promoProductId = `rc_promo_${entitlementId}_custom`;
  const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

  function subscriberState(appUserId) {
    if (!subscribers.has(appUserId)) {
      subscribers.set(appUserId, { firstSeen: Date.now(), products: new Map() });
    }
    return subscribers.get(appUserId);
  }

  function accessEnd(product) {
    return Math.max(product.expiresMs ?? -Infinity, product.graceMs ?? -Infinity);
  }

  // Lo que devuelve GET /subscribers/:id. Como la real: las suscripciones
  // caducadas siguen apareciendo (con su fecha pasada) y el entitlement
  // apunta al producto que da acceso más tarde.
  function snapshot(appUserId) {
    const state = subscriberState(appUserId);
    const subscriptions = {};
    let winner = null;
    for (const [productId, product] of state.products) {
      subscriptions[productId] = {
        expires_date: iso(product.expiresMs),
        grace_period_expires_date: iso(product.graceMs),
        purchase_date: iso(product.purchaseMs),
        original_purchase_date: iso(product.originalPurchaseMs ?? product.purchaseMs),
        store: product.store,
        is_sandbox: false,
        period_type: "normal",
        unsubscribe_detected_at: iso(product.unsubscribeMs),
        billing_issues_detected_at: iso(product.billingIssueMs),
        refunded_at: iso(product.refundedMs),
      };
      if (!winner || accessEnd(product) > accessEnd(winner.product)) winner = { productId, product };
    }
    const entitlements = {};
    if (winner) {
      entitlements[entitlementId] = {
        expires_date: iso(winner.product.expiresMs),
        grace_period_expires_date: iso(winner.product.graceMs),
        product_identifier: winner.productId,
        purchase_date: iso(winner.product.purchaseMs),
      };
    }
    return {
      original_app_user_id: appUserId,
      first_seen: iso(state.firstSeen),
      entitlements,
      subscriptions,
      non_subscriptions: {},
      other_purchases: {},
    };
  }

  function takeFailure(method, kind) {
    const index = failures.findIndex(
      (failure) => (!failure.method || failure.method === method) && (!failure.kind || failure.kind === kind),
    );
    if (index === -1) return null;
    const failure = failures[index];
    failure.times -= 1;
    if (failure.times <= 0) failures.splice(index, 1);
    return failure;
  }

  async function handle(method, url, body, config) {
    const match = /^https:\/\/api\.revenuecat\.com\/v1\/subscribers\/([^/]+)(?:\/entitlements\/([^/]+)\/(promotional|revoke_promotionals))?$/.exec(url);
    if (!match) throw new Error(`fake-revenuecat: URL inesperada ${method} ${url}`);
    const appUserId = decodeURIComponent(match[1]);
    const entitlement = match[2] ? decodeURIComponent(match[2]) : null;
    const kind = match[3] || "subscriber";
    calls.push({ method, kind, appUserId, entitlement, body, at: Date.now() });

    const failure = takeFailure(method, kind);
    if (failure) {
      if (!failure.status) {
        const error = new Error("socket hang up");
        error.isAxiosError = true;
        error.code = "ECONNRESET";
        throw error;
      }
      throw httpError(failure.status, failure.message || "fake failure");
    }

    if (config?.headers?.Authorization !== `Bearer ${apiKey}`) {
      throw httpError(401, "Invalid API key");
    }

    if (kind === "promotional") {
      if (entitlement !== entitlementId) throw httpError(404, "Entitlement not found");
      if (body?.duration || body?.start_time_ms) throw httpError(400, "duration/start_time_ms son obsoletos en este fake: usa end_time_ms");
      const endMs = Number(body?.end_time_ms);
      if (!Number.isFinite(endMs) || endMs <= Date.now()) throw httpError(400, "end_time_ms must be in the future");
      subscriberState(appUserId).products.set(promoProductId, {
        store: "promotional",
        purchaseMs: Date.now(),
        expiresMs: endMs,
      });
    } else if (kind === "revoke_promotionals") {
      for (const product of subscriberState(appUserId).products.values()) {
        if (product.store === "promotional" && product.expiresMs > Date.now()) product.expiresMs = Date.now();
      }
    }

    return { status: 200, data: { request_date_ms: Date.now(), subscriber: snapshot(appUserId) } };
  }

  const rc = {
    calls,
    promoProductId,

    install() {
      originalGet = axios.get;
      originalPost = axios.post;
      axios.get = (url, config) => handle("GET", url, undefined, config);
      axios.post = (url, body, config) => handle("POST", url, body, config);
    },

    uninstall() {
      if (originalGet) axios.get = originalGet;
      if (originalPost) axios.post = originalPost;
    },

    reset() {
      subscribers.clear();
      calls.length = 0;
      failures.length = 0;
    },

    /** Las próximas `times` llamadas (filtrables por método y tipo) fallan. status 0 = red caída. */
    fail({ status = 503, times = 1, method, kind, message } = {}) {
      failures.push({ status, times, method, kind, message });
    },

    clearFailures() {
      failures.length = 0;
    },

    callsFor(appUserId, kind) {
      return calls.filter((call) => call.appUserId === appUserId && (!kind || call.kind === kind));
    },

    subscriber: snapshot,

    product(appUserId, productId) {
      return subscriberState(appUserId).products.get(productId) || null;
    },

    /** Compra en tienda (App Store / Play) que dura `days` desde ahora. */
    purchase(appUserId, productId = "trainfit_pro_monthly", { days = 30, store = "app_store" } = {}) {
      subscriberState(appUserId).products.set(productId, {
        store,
        purchaseMs: Date.now(),
        expiresMs: Date.now() + days * DAY,
      });
    },

    renew(appUserId, productId = "trainfit_pro_monthly", { days = 30 } = {}) {
      const product = subscriberState(appUserId).products.get(productId);
      product.purchaseMs = Date.now();
      product.expiresMs = Math.max(product.expiresMs, Date.now()) + days * DAY;
      product.unsubscribeMs = null;
      product.billingIssueMs = null;
      product.graceMs = null;
    },

    cancel(appUserId, productId = "trainfit_pro_monthly") {
      subscriberState(appUserId).products.get(productId).unsubscribeMs = Date.now();
    },

    billingIssue(appUserId, productId = "trainfit_pro_monthly", { graceDays = 0 } = {}) {
      const product = subscriberState(appUserId).products.get(productId);
      product.billingIssueMs = Date.now();
      product.graceMs = graceDays ? product.expiresMs + graceDays * DAY : null;
    },

    expire(appUserId, productId = "trainfit_pro_monthly") {
      const product = subscriberState(appUserId).products.get(productId);
      product.expiresMs = Date.now() - 1000;
      product.graceMs = null;
    },

    refund(appUserId, productId = "trainfit_pro_monthly") {
      const product = subscriberState(appUserId).products.get(productId);
      product.expiresMs = Date.now() - 1000;
      product.refundedMs = Date.now();
    },

    /** La compra de tienda pasa de una cuenta a otra (mismo Apple ID / Google). */
    transfer(fromAppUserId, toAppUserId) {
      const from = subscriberState(fromAppUserId);
      const to = subscriberState(toAppUserId);
      for (const [productId, product] of [...from.products]) {
        if (product.store === "promotional") continue;
        to.products.set(productId, product);
        from.products.delete(productId);
      }
    },

    /** Pasa el tiempo para estos suscriptores (todos si no se indica). */
    shift(ms, appUserIds = [...subscribers.keys()]) {
      for (const appUserId of appUserIds) {
        const state = subscribers.get(appUserId);
        if (!state) continue;
        state.firstSeen -= ms;
        for (const product of state.products.values()) {
          for (const key of ["purchaseMs", "originalPurchaseMs", "expiresMs", "graceMs", "unsubscribeMs", "billingIssueMs", "refundedMs"]) {
            if (typeof product[key] === "number") product[key] -= ms;
          }
        }
      }
    },

    /**
     * Webhook tal como lo manda RevenueCat para un producto del suscriptor.
     * `overrides` pisa cualquier campo del evento.
     */
    event(type, appUserId, productId = "trainfit_pro_monthly", overrides = {}) {
      seq += 1;
      const product = productId ? subscriberState(appUserId).products.get(productId) : null;
      return {
        api_version: "1.0",
        event: {
          id: `evt_${Date.now()}_${seq}`,
          type,
          app_user_id: appUserId,
          original_app_user_id: appUserId,
          aliases: [appUserId],
          product_id: productId,
          entitlement_ids: [entitlementId],
          period_type: "NORMAL",
          store: product?.store === "promotional" ? "PROMOTIONAL" : (product?.store || "app_store").toUpperCase(),
          environment: "PRODUCTION",
          event_timestamp_ms: Date.now(),
          purchased_at_ms: product?.purchaseMs ?? null,
          expiration_at_ms: product?.expiresMs ?? null,
          ...overrides,
        },
      };
    },
  };

  return rc;
}

module.exports = { createFakeRevenueCat, DAY };
