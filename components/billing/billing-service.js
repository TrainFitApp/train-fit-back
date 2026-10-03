const axios = require("axios");
const mongoose = require("mongoose");
const userSchema = require("../users/schema");
const billingCustomerSchema = require("./billing-customer-schema");
const billingEventSchema = require("./billing-event-schema");
const { isEffectivelyEntitled } = require("./feature-access-service");

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";
const ENTITLEMENT_ID =
  process.env.REVENUECAT_ENTITLEMENT_ID || "no_adds_and_features";
// RevenueCat solo gestiona la suscripción de cliente (User.premium). La de
// entrenadores va por Stripe (components/trainerBilling, decisión 2026-10-02).

// Se leen en cada uso (no al cargar el módulo): así un cambio de entorno no
// exige reiniciar nada más que el proceso, y los tests pueden activarlos.
const webhookAuth = () =>
  process.env.REVENUECAT_WEBHOOK_AUTH ||
  process.env.REVENUECAT_WEBHOOK_SECRET ||
  "";
const secretApiKey = () => process.env.REVENUECAT_SECRET_API_KEY || "";

const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de negocio de una concesión manual desde management.
const MAX_PROMOTIONAL_MS = 365 * DAY_MS;
const PRESET_DURATIONS = {
  "1d": 1 * DAY_MS,
  "1w": 7 * DAY_MS,
  "1m": 31 * DAY_MS,
  "1y": 365 * DAY_MS,
};
// Margen para decidir que un EXPIRATION/CANCELLATION habla de un periodo
// anterior al que el usuario tiene ahora (relojes y redondeos de RevenueCat).
const PERIOD_TOLERANCE_MS = 60 * 1000;

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateFromMsOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return null;
  return toDateOrNull(new Date(numericValue));
}

function laterDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return b.getTime() > a.getTime() ? b : a;
}

// Fin real del acceso de un producto o entitlement: la caducidad o, si la
// tienda está en periodo de gracia por un cobro fallido, el fin de la gracia
// (RevenueCat mantiene el entitlement activo durante la gracia).
function accessEndOf(payload) {
  return laterDate(
    toDateOrNull(payload?.expires_date),
    toDateOrNull(payload?.grace_period_expires_date),
  );
}

function normalizeEventType(type) {
  return String(type || "unknown").toUpperCase();
}

function parseBooleanRenewalFlag(payload) {
  if (typeof payload?.will_renew === "boolean") {
    return payload.will_renew;
  }

  if (typeof payload?.auto_renew_status === "boolean") {
    return payload.auto_renew_status;
  }

  if (
    payload?.auto_renew_status === 1 ||
    payload?.auto_renew_status === "1" ||
    payload?.auto_renew_status === "true"
  ) {
    return true;
  }

  if (
    payload?.auto_renew_status === 0 ||
    payload?.auto_renew_status === "0" ||
    payload?.auto_renew_status === "false"
  ) {
    return false;
  }

  return null;
}

function derivePlan(productId) {
  const id = (productId || "").toLowerCase();
  if (
    id.includes("year") ||
    id.includes("annual") ||
    id.includes("anual") ||
    id.includes("yearly")
  ) {
    return "annual";
  }
  if (
    id.includes("month") ||
    id.includes("mensual") ||
    id.includes("monthly")
  ) {
    return "monthly";
  }
  return "unknown";
}

function isPromotionalStore(store) {
  const normalized = String(store || "").trim().toLowerCase();
  return normalized === "promotional" || normalized === "promotional_entitlement";
}

function isPromotionalProduct(store, productId) {
  return isPromotionalStore(store) || String(productId || "").startsWith("rc_promo_");
}

function resolvePremiumSource(store, productId) {
  return isPromotionalProduct(store, productId) ? "manual" : "revenuecat";
}

function getSubscriberSubscription(subscriber, productId) {
  if (!productId) return null;
  return subscriber?.subscriptions?.[productId] || null;
}

function resolveActiveSubscriptionEntry(subscriber) {
  const subscriptions = subscriber?.subscriptions || {};
  const entries = Object.entries(subscriptions);
  if (!entries.length) {
    return null;
  }

  let winner = null;
  let winnerTimestamp = -1;
  const now = Date.now();

  for (const [productId, payload] of entries) {
    const expiresAt = accessEndOf(payload);
    if (!expiresAt || expiresAt.getTime() <= now) continue;

    const timestamp = expiresAt.getTime();
    if (timestamp > winnerTimestamp) {
      winnerTimestamp = timestamp;
      winner = { productId, payload, expiresAt };
    }
  }

  return winner;
}

function resolveSubscriberProductId(subscriber) {
  const subscriptions = subscriber?.subscriptions || {};
  const entries = Object.entries(subscriptions);
  if (!entries.length) {
    return null;
  }

  let winner = null;
  let winnerTimestamp = -1;

  for (const [productId, payload] of entries) {
    const expiresAt = accessEndOf(payload);
    // M2: ignorar suscripciones ya expiradas para no elegirlas por encima de activas
    if (expiresAt && expiresAt.getTime() < Date.now()) continue;

    const purchasedAt = toDateOrNull(payload?.purchase_date);
    const timestamp =
      expiresAt?.getTime() || purchasedAt?.getTime() || winnerTimestamp;

    if (timestamp > winnerTimestamp) {
      winnerTimestamp = timestamp;
      winner = productId;
    }
  }

  return winner;
}

// ¿Tiene el suscriptor una suscripción de tienda (App Store / Play) vigente?
// Las promocionales (las que concede management) no cuentan.
function hasActiveStoreSubscription(subscriber) {
  const now = Date.now();
  return Object.entries(subscriber?.subscriptions || {}).some(([productId, payload]) => {
    if (isPromotionalProduct(payload?.store, productId)) return false;
    const accessEnd = accessEndOf(payload);
    return Boolean(accessEnd && accessEnd.getTime() > now);
  });
}

function parseSDKCustomerInfoWithPreferredId(customerInfo, preferredId) {
  const active = customerInfo?.entitlements?.active || {};
  const selectedEntitlement =
    active[preferredId] || Object.values(active || {})[0] || null;

  const expiresAt = toDateOrNull(selectedEntitlement?.expirationDate);
  const entitled = Boolean(selectedEntitlement?.isActive);
  const source = resolvePremiumSource(
    selectedEntitlement?.store,
    selectedEntitlement?.productIdentifier,
  );

  return {
    entitled,
    plan: source === "manual" ? "manual" : derivePlan(selectedEntitlement?.productIdentifier),
    expiresAt,
    source,
    productId: selectedEntitlement?.productIdentifier || null,
    store: selectedEntitlement?.store || null,
    willRenew: source !== "manual" && Boolean(selectedEntitlement?.willRenew),
    activeEntitlement: selectedEntitlement?.identifier || preferredId,
  };
}

function parseSDKCustomerInfo(customerInfo) {
  return parseSDKCustomerInfoWithPreferredId(customerInfo, ENTITLEMENT_ID);
}

function parseRCSubscriberPayloadForId(subscriber, entitlementId) {
  const active = subscriber?.entitlements || {};
  const entitlement = active?.[entitlementId];
  const activeSubscription = resolveActiveSubscriptionEntry(subscriber);
  const resolvedProductId =
    activeSubscription?.productId ||
    entitlement?.product_identifier ||
    resolveSubscriberProductId(subscriber);
  const subscriptionPayload = getSubscriberSubscription(subscriber, resolvedProductId);

  const entitlementExpiresAt = accessEndOf(entitlement);
  const subscriptionExpiresAt =
    activeSubscription?.expiresAt || accessEndOf(subscriptionPayload);
  const now = Date.now();
  const expiresAt =
    subscriptionExpiresAt &&
      (!entitlementExpiresAt ||
        entitlementExpiresAt.getTime() <= now ||
        subscriptionExpiresAt.getTime() > entitlementExpiresAt.getTime())
      ? subscriptionExpiresAt
      : entitlementExpiresAt;
  const entitled = Boolean(expiresAt && expiresAt.getTime() > now);
  const store = subscriptionPayload?.store || entitlement?.store || null;
  const source = resolvePremiumSource(store, resolvedProductId);

  // Una promocional no se renueva nunca: termina en su fecha.
  const willRenew =
    source !== "manual" && !subscriptionPayload?.unsubscribe_detected_at && entitled;

  return {
    entitled,
    plan: source === "manual" ? "manual" : derivePlan(resolvedProductId),
    expiresAt,
    source,
    productId: resolvedProductId || null,
    store,
    willRenew,
    activeEntitlement: entitlement || entitled ? entitlementId : null,
  };
}

function parseRCSubscriberPayload(subscriber) {
  return parseRCSubscriberPayloadForId(subscriber, ENTITLEMENT_ID);
}

async function updateUserPremium(userId, premiumState) {
  if (!userId) return null;
  const normalizedPlan =
    premiumState?.plan === "monthly" ||
      premiumState?.plan === "annual" ||
      premiumState?.plan === "manual"
      ? premiumState.plan
      : null;
  const isEntitled = Boolean(premiumState?.entitled);
  const normalizedSource =
    !isEntitled ? null : premiumState?.source === "manual" ? "manual" : "revenuecat";

  const fieldUpdate = {
    entitled: isEntitled,
    plan: normalizedPlan,
    expiresAt: premiumState?.expiresAt || null,
    source: normalizedSource,
    lastSyncAt: new Date(),
  };

  return userSchema.findOneAndUpdate(
    { _id: userId },
    { $set: { premium: fieldUpdate }, $unset: { isPremium: 1 } },
    { new: true },
  );
}

async function upsertBillingCustomer({
  userId,
  appUserId,
  originalAppUserId,
  activeEntitlement,
  store,
  productId,
  expiresAt,
  willRenew,
  lastEventAt,
}) {
  if (!appUserId) return null;

  return billingCustomerSchema.findOneAndUpdate(
    { appUserId },
    {
      $set: {
        userId,
        appUserId,
        originalAppUserId: originalAppUserId || appUserId,
        activeEntitlement: activeEntitlement || null,
        store: store || null,
        productId: productId || null,
        expiresAt: expiresAt || null,
        willRenew: Boolean(willRenew),
        lastEventAt: lastEventAt || new Date(),
      },
    },
    { upsert: true, new: true },
  );
}

async function ensureEventNotProcessed(eventId, payload) {
  if (!eventId) return true;

  try {
    await billingEventSchema.create({
      eventId,
      type: payload?.type || "unknown",
      store: payload?.store || null,
      appUserId: payload?.app_user_id || null,
      payload,
      processedAt: new Date(),
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
}

function parseWebhookEvent(rawPayload) {
  const payload = rawPayload?.event || rawPayload || {};
  const type = normalizeEventType(payload?.type);
  // I5: añadir entropía al fallback para evitar colisiones en eventos simultáneos
  const eventId =
    payload?.id ||
    payload?.event_id ||
    `${type || "unknown"}-${payload?.app_user_id || "unknown"}-${payload?.event_timestamp_ms || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const expiresAt = laterDate(
    payload?.expiration_at_ms
      ? toDateFromMsOrNull(payload.expiration_at_ms)
      : toDateOrNull(payload?.expiration_at),
    // BILLING_ISSUE con periodo de gracia: el acceso dura hasta el fin de la gracia.
    toDateFromMsOrNull(payload?.grace_period_expiration_at_ms),
  );

  const eventTimestamp =
    toDateFromMsOrNull(payload?.event_timestamp_ms) ||
    toDateOrNull(payload?.event_timestamp) ||
    new Date();

  const now = Date.now();
  const hasAccessByExpiry = Boolean(expiresAt && expiresAt.getTime() > now);
  const explicitWillRenew = parseBooleanRenewalFlag(payload);

  let entitled = hasAccessByExpiry;
  let willRenew = false;
  let applyEntitlementUpdate = true;
  let keepExistingSubscriptionState = false;

  if (type === "REFUND" || type === "REVOKE" || type === "EXPIRATION") {
    entitled = false;
    willRenew = false;
  } else if (type === "CANCELLATION") {
    // Cancelar solo apaga la renovación: el acceso sigue hasta la fecha que
    // el usuario ya tiene. Si la fecha ya pasó (reembolso, revocación de una
    // promocional), sí lo corta. Nunca concede ni alarga acceso: un
    // CANCELLATION de una promocional revocada trae su fecha original.
    entitled = false;
    willRenew = false;
    applyEntitlementUpdate = !hasAccessByExpiry;
  } else if (type === "RENEWAL" || type === "INITIAL_PURCHASE") {
    entitled = hasAccessByExpiry;
    willRenew = true;
  } else if (type === "BILLING_ISSUE") {
    entitled = hasAccessByExpiry;
    willRenew = explicitWillRenew === null ? false : explicitWillRenew;
  } else if (type === "TRANSFER" || type === "SUBSCRIBER_ALIAS") {
    applyEntitlementUpdate = false;
    keepExistingSubscriptionState = true;
    entitled = false;
    willRenew = false;
  } else {
    entitled = hasAccessByExpiry;
    willRenew =
      explicitWillRenew !== null
        ? explicitWillRenew
        : Boolean(payload?.renewal_number || payload?.period_type === "NORMAL");
  }

  const source = resolvePremiumSource(payload?.store, payload?.product_id);
  if (source === "manual") willRenew = false;

  const transferredFrom = Array.isArray(payload?.transferred_from) ? payload.transferred_from : [];
  const transferredTo = Array.isArray(payload?.transferred_to) ? payload.transferred_to : [];

  return {
    eventId,
    eventTimestamp,
    // Un TRANSFER puede no traer app_user_id: el destinatario va en transferred_to.
    appUserId: payload?.app_user_id || (type === "TRANSFER" ? transferredTo[0] || null : null),
    originalAppUserId: payload?.original_app_user_id || payload?.app_user_id || null,
    activeEntitlement:
      Array.isArray(payload?.entitlement_ids) && payload.entitlement_ids.length
        ? payload.entitlement_ids[0]
        : ENTITLEMENT_ID,
    store: payload?.store || null,
    productId: payload?.product_id || null,
    expiresAt: expiresAt || null,
    willRenew,
    entitled,
    plan: source === "manual" ? "manual" : derivePlan(payload?.product_id),
    source,
    type,
    applyEntitlementUpdate,
    keepExistingSubscriptionState,
    transferredFrom,
    transferredTo,
    payload,
  };
}

function shouldApplyEventByOrder(event, billingCustomer) {
  const customerTimestamp = billingCustomer?.lastEventAt
    ? new Date(billingCustomer.lastEventAt).getTime()
    : null;
  const eventTimestamp = event?.eventTimestamp
    ? new Date(event.eventTimestamp).getTime()
    : null;

  if (!customerTimestamp || !eventTimestamp) {
    return true;
  }

  return eventTimestamp >= customerTimestamp;
}

// Un EXPIRATION/CANCELLATION de algo que ya no es lo vigente (la promocional
// que management revocó para conceder otra, el producto anterior tras un
// cambio de plan…) no puede quitar el acceso del periodo actual. Un reembolso
// o una expiración del MISMO producto de tienda sí se aplica aunque la fecha
// sea anterior: es justo lo que corta el acceso.
function refersToOlderPeriod(event, user, billingCustomer) {
  if (event?.type !== "EXPIRATION" && event?.type !== "CANCELLATION") return false;
  if (!isEffectivelyEntitled(user?.premium)) return false;
  const currentExpiresAt = toDateOrNull(user.premium.expiresAt);
  if (!currentExpiresAt || !event.expiresAt) return false;
  if (currentExpiresAt.getTime() - event.expiresAt.getTime() <= PERIOD_TOLERANCE_MS) return false;
  const currentProductId = billingCustomer?.productId || null;
  return event.source === "manual" || !currentProductId || event.productId !== currentProductId;
}

async function getRevenueCatSubscriber(appUserId) {
  if (!secretApiKey() || !appUserId) {
    return null;
  }

  const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(appUserId)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${secretApiKey()}`,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });

  return response?.data?.subscriber || null;
}

function assertRevenueCatSecret() {
  if (!secretApiKey()) {
    const error = new Error("RevenueCat secret API key is not configured");
    error.status = 500;
    throw error;
  }
}

function getRevenueCatHeaders() {
  assertRevenueCatSecret();
  return {
    Authorization: `Bearer ${secretApiKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// RevenueCat acepta la fecha de fin exacta (`end_time_ms`). `duration` y
// `start_time_ms` están obsoletos: obligaban a redondear a un tramo (diario,
// semanal, mensual…) y la caducidad real no coincidía con la elegida.
function getPromotionPayloadForTarget(targetExpiresAt) {
  const targetMs = new Date(targetExpiresAt).getTime();
  const requestedMs = targetMs - Date.now();

  if (!Number.isFinite(targetMs) || requestedMs <= 0) {
    const error = new Error("La fecha de expiracion debe estar en el futuro");
    error.status = 400;
    throw error;
  }

  if (requestedMs > MAX_PROMOTIONAL_MS) {
    const error = new Error("La duracion maxima permitida es 1 año");
    error.status = 400;
    throw error;
  }

  return { end_time_ms: targetMs };
}

async function grantPromotionalEntitlement(appUserId, targetExpiresAt) {
  const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(
    appUserId,
  )}/entitlements/${encodeURIComponent(ENTITLEMENT_ID)}/promotional`;
  const payload = getPromotionPayloadForTarget(targetExpiresAt);
  const response = await axios.post(url, payload, {
    headers: getRevenueCatHeaders(),
    timeout: 10000,
  });

  return response?.data?.subscriber || null;
}

function ensureManualGrantWasApplied(premiumState) {
  if (
    premiumState?.entitled !== true ||
    premiumState?.source !== "manual" ||
    premiumState?.plan !== "manual" ||
    !premiumState?.expiresAt ||
    new Date(premiumState.expiresAt).getTime() <= Date.now()
  ) {
    const error = new Error(
      "RevenueCat no devolvio un entitlement promocional activo para este usuario",
    );
    error.status = 502;
    throw error;
  }
}

async function revokePromotionalEntitlement(appUserId) {
  const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(
    appUserId,
  )}/entitlements/${encodeURIComponent(ENTITLEMENT_ID)}/revoke_promotionals`;
  const response = await axios.post(url, {}, {
    headers: getRevenueCatHeaders(),
    timeout: 10000,
  });

  return response?.data?.subscriber || null;
}

function normalizeDurationRequest(duration) {
  if (!duration || typeof duration !== "object") {
    const error = new Error("Duracion requerida");
    error.status = 400;
    throw error;
  }

  if (duration.type === "preset") {
    const durationMs = PRESET_DURATIONS[duration.value];
    if (!durationMs) {
      const error = new Error("Duracion predefinida no valida");
      error.status = 400;
      throw error;
    }
    return { type: "preset", durationMs };
  }

  if (duration.type === "customDate") {
    const expiresAt = toDateOrNull(duration.expiresAt);
    if (!expiresAt) {
      const error = new Error("Fecha personalizada no valida");
      error.status = 400;
      throw error;
    }
    return { type: "customDate", expiresAt };
  }

  const error = new Error("Tipo de duracion no valido");
  error.status = 400;
  throw error;
}

function getManualBaseDate(user) {
  const expiresAt = toDateOrNull(user?.premium?.expiresAt);
  const isManualActive =
    user?.premium?.source === "manual" &&
    user?.premium?.entitled === true &&
    expiresAt &&
    expiresAt.getTime() > Date.now();

  return isManualActive ? expiresAt : new Date();
}

function resolveTargetExpiration(user, duration, mode) {
  const normalizedDuration = normalizeDurationRequest(duration);
  if (normalizedDuration.type === "customDate") {
    return normalizedDuration.expiresAt;
  }

  const baseDate = mode === "extend" ? getManualBaseDate(user) : new Date();
  return new Date(baseDate.getTime() + normalizedDuration.durationMs);
}

// Premium de tienda VIGENTE. Un `entitled: true` cuya fecha ya pasó (webhook
// de EXPIRATION perdido) no cuenta: si no, management no podría conceder
// tiempo a quien ya no paga.
function isRealStorePremium(user, billingCustomer) {
  if (!isEffectivelyEntitled(user?.premium)) return false;
  if (user?.premium?.source === "manual") return false;
  if (isPromotionalStore(billingCustomer?.store)) return false;
  return user?.premium?.source === "revenuecat" || Boolean(billingCustomer?.store);
}

function storeSubscriptionConflict() {
  const error = new Error("El usuario tiene una suscripcion activa de tienda");
  error.status = 409;
  return error;
}

// Aplica en BD el estado que RevenueCat da para un suscriptor (fuente de
// verdad: lo que dice su API en este momento). El plan desconocido (base
// plans de Google Play sin sufijo en el productId) se toma del que sabe el
// front o del que ya había en BD.
async function applyRevenueCatSubscriber(user, subscriber, appUserId, options = {}) {
  const premiumState = parseRCSubscriberPayload(subscriber);
  const knownPlan = (plan) => plan === "monthly" || plan === "annual";
  if (premiumState.plan === "unknown") {
    if (knownPlan(options.explicitPlan)) premiumState.plan = options.explicitPlan;
    else if (knownPlan(user?.premium?.plan)) premiumState.plan = user.premium.plan;
  }
  if (options.expectManualGrant) {
    ensureManualGrantWasApplied(premiumState);
  }

  const updatedUser = await updateUserPremium(user._id, premiumState);
  await upsertBillingCustomer({
    userId: user._id,
    appUserId,
    originalAppUserId: subscriber?.original_app_user_id || appUserId,
    activeEntitlement: premiumState.activeEntitlement,
    store: premiumState.store,
    productId: premiumState.productId,
    expiresAt: premiumState.expiresAt,
    willRenew: premiumState.willRenew,
    lastEventAt: new Date(),
  });

  return { updatedUser, premiumState };
}

// Corrige en BD un premium.entitled=true cuya expiresAt ya pasó, sin esperar
// a que llegue (o no llegue) el webhook de EXPIRATION. Es best-effort y no
// bloqueante: si falla, la próxima lectura (o el job de reconciliación) lo
// reintentará. El filtro por expiresAt en el $match evita pisar una
// renovación que haya llegado entre medias.
async function reconcileExpiredPremiumIfNeeded(user) {
  const premium = user?.premium;
  if (!premium?.entitled || !premium?.expiresAt) return;
  if (new Date(premium.expiresAt).getTime() > Date.now()) return;

  try {
    await userSchema.updateOne(
      {
        _id: user._id,
        "premium.entitled": true,
        "premium.expiresAt": premium.expiresAt,
      },
      { $set: { "premium.entitled": false } },
    );
  } catch (error) {
    console.error(
      "[Billing] Error auto-corrigiendo premium expirado",
      user?._id?.toString(),
      error,
    );
  }
}

// Red de seguridad periódica (cron): corrige usuarios que quedaron con
// entitled=true tras su expiresAt sin que nadie haya vuelto a abrir la app
// (nadie disparó reconcileExpiredPremiumIfNeeded) y, cuando es posible,
// reconsulta RevenueCat en vivo antes de revocar por si el webhook perdido
// era en realidad una RENEWAL (no una EXPIRATION real). Recorre TODOS los
// candidatos por lotes (antes solo los 200 primeros de cada noche).
async function runExpiredPremiumReconciliation({ batchSize = 200 } = {}) {
  const now = new Date();
  let candidatesCount = 0;
  let reconciled = 0;
  let selfHealed = 0;
  let skipped = 0;
  let lastId = null;

  for (;;) {
    const candidates = await userSchema
      .find({
        "premium.entitled": true,
        "premium.expiresAt": { $lte: now },
        ...(lastId ? { _id: { $gt: lastId } } : {}),
      })
      .sort({ _id: 1 })
      .select("_id premium")
      .limit(batchSize)
      .lean();
    if (!candidates.length) break;
    lastId = candidates[candidates.length - 1]._id;
    candidatesCount += candidates.length;

    for (const candidate of candidates) {
      const appUserId = candidate._id.toString();

      // Distinguir "RevenueCat confirmó que no hay entitlement" de "no pudimos
      // preguntarle a RevenueCat" (caída de red/API). Un fallo transitorio de
      // conexión NUNCA debe degradar a un usuario — solo se reintenta en el
      // siguiente ciclo del cron.
      let subscriber = null;
      let rcCallFailed = false;

      if (secretApiKey()) {
        try {
          subscriber = await getRevenueCatSubscriber(appUserId);
        } catch (error) {
          rcCallFailed = true;
          console.error(
            "[BillingReconciliation] Fallo consultando RevenueCat, se reintentará",
            appUserId,
            error?.message || error,
          );
        }
      }

      if (rcCallFailed) {
        skipped += 1;
        continue;
      }

      try {
        if (subscriber) {
          // Llamada a RC exitosa: aplicar el estado real (puede ser una
          // RENEWAL cuyo webhook se perdió, no necesariamente una expiración).
          await applyRevenueCatSubscriber(candidate, subscriber, appUserId);
          reconciled += 1;
        } else {
          // RC no está configurado (SECRET_API_KEY ausente) y expiresAt local
          // es la única fuente disponible: expiresAt ya pasado basta.
          await userSchema.updateOne(
            {
              _id: candidate._id,
              "premium.expiresAt": candidate.premium.expiresAt,
            },
            { $set: { "premium.entitled": false } },
          );
          selfHealed += 1;
        }
      } catch (error) {
        skipped += 1;
        console.error(
          "[BillingReconciliation] Error reconciliando usuario",
          appUserId,
          error?.message || error,
        );
      }
    }
  }

  const summary = { candidates: candidatesCount, reconciled, selfHealed, skipped };
  console.info("[BillingReconciliation]", JSON.stringify(summary));
  return summary;
}

async function syncFromCustomerInfo(user, customerInfo, explicitPlan) {
  const premiumState = parseSDKCustomerInfo(customerInfo);

  // Si derivePlan no pudo determinar el plan desde el productId pero el frontend
  // lo conoce con certeza (viene de purchasePlan), usarlo directamente
  if (
    premiumState.plan === "unknown" &&
    (explicitPlan === "monthly" || explicitPlan === "annual")
  ) {
    premiumState.plan = explicitPlan;
  }

  // Si el plan sigue siendo "unknown" (base plans de Google Play sin sufijo en el productId),
  // preservar el plan que ya tiene el usuario en BD para no machacar lo que el webhook pudo haber sincronizado
  if (
    premiumState.plan === "unknown" &&
    (user?.premium?.plan === "monthly" || user?.premium?.plan === "annual")
  ) {
    premiumState.plan = user.premium.plan;
  }

  const appUserId = user?._id?.toString();

  await Promise.all([
    updateUserPremium(user._id, premiumState),
    upsertBillingCustomer({
      userId: user._id,
      appUserId,
      originalAppUserId: appUserId,
      activeEntitlement: premiumState.activeEntitlement,
      store: premiumState.store,
      productId: premiumState.productId,
      expiresAt: premiumState.expiresAt,
      willRenew: premiumState.willRenew,
      lastEventAt: new Date(),
    }),
  ]);

  return premiumState;
}

async function findBillingCustomer(appUserId, originalAppUserId) {
  let billingCustomer = await billingCustomerSchema.findOne({ appUserId });
  if (!billingCustomer && originalAppUserId) {
    billingCustomer = await billingCustomerSchema.findOne({ originalAppUserId });
  }
  return billingCustomer;
}

async function findUserForAppUserId(appUserId, billingCustomer) {
  let user = null;
  if (mongoose.Types.ObjectId.isValid(appUserId)) {
    user = await userSchema.findById(appUserId);
  }
  if (!user && billingCustomer?.userId) {
    user = await userSchema.findById(billingCustomer.userId);
  }
  return user;
}

// Con la clave secreta configurada, un webhook solo dice "algo cambió en este
// suscriptor": se pregunta a RevenueCat el estado completo y se aplica tal
// cual (lo que RevenueCat recomienda). Así da igual el orden en que lleguen
// los eventos, que el evento hable de otro producto (la promocional caducada
// de alguien que ya paga en la tienda) o que sea de una transferencia (el que
// la pierde y el que la recibe). Devuelve null si no hay a quién aplicarlo;
// un fallo de RevenueCat lanza, y quien llama vuelve al estado del evento.
async function resyncFromRevenueCat(event, user, billingCustomer) {
  const targets = new Map();
  if (user) targets.set(event.appUserId, user);
  if (event.type === "TRANSFER") {
    for (const appUserId of [...event.transferredFrom, ...event.transferredTo]) {
      if (!appUserId || targets.has(appUserId)) continue;
      const otherCustomer = await findBillingCustomer(appUserId, null);
      const otherUser = await findUserForAppUserId(appUserId, otherCustomer);
      if (otherUser) targets.set(appUserId, otherUser);
    }
  }
  if (!targets.size) return null;

  const applied = [];
  for (const [appUserId, targetUser] of targets) {
    const subscriber = await getRevenueCatSubscriber(appUserId);
    if (!subscriber) throw new Error("RevenueCat no devolvio el suscriptor");
    const { premiumState } = await applyRevenueCatSubscriber(targetUser, subscriber, appUserId);
    applied.push({ userId: targetUser._id, entitled: premiumState.entitled });
  }

  if (user) {
    await billingEventSchema.updateOne({ eventId: event.eventId }, { $set: { userId: user._id } });
  }
  return { applied, billingCustomerId: billingCustomer?._id || null };
}

function logWebhook(event, extra) {
  console.info(
    "[BillingWebhook]",
    JSON.stringify({
      eventId: event.eventId,
      type: event.type,
      appUserId: event.appUserId,
      productId: event.productId,
      ...extra,
    }),
  );
}

async function loadAdminTarget(userId) {
  const user = await userSchema.findById(userId);
  if (!user) {
    const error = new Error("Usuario no encontrado");
    error.status = 404;
    throw error;
  }
  const appUserId = user._id.toString();
  const billingCustomer = await billingCustomerSchema.findOne({ appUserId });
  return { user, appUserId, billingCustomer };
}

// Conceder ("grant") o ampliar ("extend") premium manual desde management:
// una promocional de RevenueCat con la fecha de fin exacta.
async function applyAdminPremium(userId, duration, mode) {
  assertRevenueCatSecret();
  const { user, appUserId, billingCustomer } = await loadAdminTarget(userId);
  if (isRealStorePremium(user, billingCustomer)) {
    throw storeSubscriptionConflict();
  }

  const targetExpiresAt = resolveTargetExpiration(user, duration, mode);
  // Valida la fecha antes de tocar nada en RevenueCat.
  getPromotionPayloadForTarget(targetExpiresAt);

  // La BD puede ir atrasada (webhook de compra perdido): se pregunta a
  // RevenueCat si paga en la tienda antes de superponer una promocional.
  const current = await getRevenueCatSubscriber(appUserId);
  if (hasActiveStoreSubscription(current)) {
    throw storeSubscriptionConflict();
  }

  await revokePromotionalEntitlement(appUserId).catch((error) => {
    const status = error?.response?.status;
    if (status !== 400 && status !== 404) {
      throw error;
    }
  });
  await grantPromotionalEntitlement(appUserId, targetExpiresAt);
  const subscriber = await getRevenueCatSubscriber(appUserId);
  if (!subscriber) {
    const error = new Error("No se pudo sincronizar la suscripcion con RevenueCat");
    error.status = 502;
    throw error;
  }

  const { updatedUser } = await applyRevenueCatSubscriber(user, subscriber, appUserId, {
    expectManualGrant: true,
  });
  return updatedUser;
}

module.exports = {
  entitlementId: ENTITLEMENT_ID,
  derivePlan,
  parseRCSubscriberPayload,
  parseSDKCustomerInfo,
  parseWebhookEvent,
  shouldApplyEventByOrder,
  refersToOlderPeriod,
  hasActiveStoreSubscription,
  isRealStorePremium,
  getPromotionPayloadForTarget,
  resolveTargetExpiration,
  reconcileExpiredPremiumIfNeeded,
  runExpiredPremiumReconciliation,

  validateWebhookAuth(req) {
    // Sin secreto configurado se falla CERRADO (antes cualquiera podía
    // mandar un evento falso y darse premium). Solo en desarrollo local se
    // deja pasar, para probar webhooks sin configurar nada.
    const secret = webhookAuth();
    if (!secret) {
      if (process.env.NODE_ENV === "development") return true;
      console.error("[billing] Webhook de RevenueCat rechazado: falta REVENUECAT_WEBHOOK_AUTH");
      return false;
    }

    const authHeader = (req.headers?.authorization || "").trim();
    if (!authHeader) {
      return false;
    }

    return authHeader === secret || authHeader === `Bearer ${secret}`;
  },

  // El app user id de RevenueCat es siempre el _id del usuario (el front hace
  // Purchases.logIn con él). No se acepta otro del cliente: enlazar el id de
  // otra persona daba su suscripción a quien lo enlazaba. Tampoco se pisa el
  // estado de suscripción ni lastEventAt: abrir la app no puede hacer que un
  // webhook de RENEWAL/EXPIRATION posterior se descarte por "antiguo".
  async linkCustomer(user) {
    const appUserId = user?._id?.toString();
    if (!appUserId) {
      return null;
    }

    return billingCustomerSchema.findOneAndUpdate(
      { appUserId },
      {
        $set: { userId: user._id },
        $setOnInsert: { appUserId, originalAppUserId: appUserId, willRenew: false },
      },
      { upsert: true, new: true },
    );
  },

  // "Restaurar compras" y cada CustomerInfo que empuja el SDK. Con la clave
  // secreta, manda RevenueCat (su API): el CustomerInfo viene del cliente y
  // se puede falsificar. Solo si RevenueCat no responde se usa el del SDK.
  async restore(user, { customerInfo = null, explicitPlan = null } = {}) {
    const appUserId = user._id.toString();
    if (secretApiKey()) {
      try {
        const subscriber = await getRevenueCatSubscriber(appUserId);
        if (subscriber) {
          const { premiumState } = await applyRevenueCatSubscriber(user, subscriber, appUserId, {
            explicitPlan,
          });
          return premiumState;
        }
      } catch (error) {
        console.error(
          "[Billing] RevenueCat no responde al restaurar; se usa el CustomerInfo del SDK",
          appUserId,
          error?.message || error,
        );
      }
    }

    if (customerInfo) {
      return syncFromCustomerInfo(user, customerInfo, explicitPlan);
    }
    return null;
  },

  async getAdminSubscriptionStatus(userId) {
    const { user, appUserId, billingCustomer } = await loadAdminTarget(userId);
    return {
      userId: appUserId,
      isPremium: isEffectivelyEntitled(user?.premium),
      source: user?.premium?.source || null,
      plan: user?.premium?.plan || null,
      expiresAt: user?.premium?.expiresAt || null,
      store: billingCustomer?.store || null,
      productId: billingCustomer?.productId || null,
      willRenew: Boolean(billingCustomer?.willRenew),
    };
  },

  grantAdminPremium(userId, duration) {
    return applyAdminPremium(userId, duration, "grant");
  },

  extendAdminPremium(userId, duration) {
    return applyAdminPremium(userId, duration, "extend");
  },

  async revokeAdminPremium(userId) {
    assertRevenueCatSecret();
    const { user, appUserId, billingCustomer } = await loadAdminTarget(userId);
    if (isRealStorePremium(user, billingCustomer)) {
      throw storeSubscriptionConflict();
    }

    const subscriber =
      (await revokePromotionalEntitlement(appUserId)) ||
      (await getRevenueCatSubscriber(appUserId));
    if (!subscriber) {
      const error = new Error("No se pudo sincronizar la suscripcion con RevenueCat");
      error.status = 502;
      throw error;
    }

    const { updatedUser } = await applyRevenueCatSubscriber(user, subscriber, appUserId);
    return updatedUser;
  },

  async processWebhook(rawPayload) {
    const event = parseWebhookEvent(rawPayload);
    const shouldProcess = await ensureEventNotProcessed(event.eventId, event.payload);
    if (!shouldProcess) {
      logWebhook(event, { applied: false, reason: "duplicate_event" });
      return { processed: false, duplicated: true };
    }

    if (!event.appUserId) {
      logWebhook(event, { applied: false, reason: "missing_app_user_id" });
      return { processed: false, reason: "missing_app_user_id" };
    }

    const billingCustomer = await findBillingCustomer(event.appUserId, event.originalAppUserId);
    const user = await findUserForAppUserId(event.appUserId, billingCustomer);

    if (secretApiKey()) {
      try {
        const synced = await resyncFromRevenueCat(event, user, billingCustomer);
        if (synced) {
          logWebhook(event, { applied: true, reason: "resynced_from_revenuecat", users: synced.applied });
          return { processed: true, duplicated: false, applied: true, resynced: true };
        }
      } catch (error) {
        console.error(
          "[BillingWebhook] RevenueCat no responde; se aplica el estado del evento",
          event.eventId,
          error?.message || error,
        );
      }
    }

    // Sin clave (o con RevenueCat caído): se aplica lo que dice el evento.
    if (!shouldApplyEventByOrder(event, billingCustomer)) {
      logWebhook(event, { entitled: event.entitled, willRenew: event.willRenew, applied: false, reason: "stale_event" });
      return { processed: true, duplicated: false, applied: false, reason: "stale_event" };
    }

    if (!event.productId && billingCustomer?.productId) {
      event.productId = billingCustomer.productId;
    }
    if (event.plan === "unknown" && event.productId) {
      event.plan = derivePlan(event.productId);
    }
    if (event.plan === "unknown" && user?.premium?.plan) {
      event.plan = user.premium.plan;
    }

    if (event.applyEntitlementUpdate && refersToOlderPeriod(event, user, billingCustomer)) {
      event.applyEntitlementUpdate = false;
      event.keepExistingSubscriptionState = true;
    }

    if (user && event.applyEntitlementUpdate) {
      await updateUserPremium(user._id, event);
      await billingEventSchema.updateOne(
        { eventId: event.eventId },
        { $set: { userId: user._id } },
      );
    }

    const resolvedCustomerState = {
      activeEntitlement: event.keepExistingSubscriptionState
        ? billingCustomer?.activeEntitlement || null
        : event.activeEntitlement,
      store: event.store || billingCustomer?.store || null,
      productId: event.productId || billingCustomer?.productId || null,
      expiresAt: event.keepExistingSubscriptionState
        ? billingCustomer?.expiresAt || null
        : event.expiresAt,
      willRenew: event.keepExistingSubscriptionState
        ? Boolean(billingCustomer?.willRenew)
        : event.willRenew,
    };

    await upsertBillingCustomer({
      userId: user?._id || null,
      appUserId: event.appUserId,
      originalAppUserId: event.originalAppUserId,
      activeEntitlement: resolvedCustomerState.activeEntitlement,
      store: resolvedCustomerState.store,
      productId: resolvedCustomerState.productId,
      expiresAt: resolvedCustomerState.expiresAt,
      willRenew: resolvedCustomerState.willRenew,
      lastEventAt: event.eventTimestamp || new Date(),
    });

    logWebhook(event, {
      productId: resolvedCustomerState.productId,
      entitled: event.applyEntitlementUpdate ? event.entitled : null,
      willRenew: resolvedCustomerState.willRenew,
      applied: true,
      reason: event.applyEntitlementUpdate ? "updated_entitlement" : "mapping_only",
    });

    return {
      processed: true,
      duplicated: false,
      applied: true,
      mappingOnly: !event.applyEntitlementUpdate,
    };
  },
};
