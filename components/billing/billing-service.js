const axios = require("axios");
const mongoose = require("mongoose");
const userSchema = require("../users/schema");
const billingCustomerSchema = require("./billing-customer-schema");
const billingEventSchema = require("./billing-event-schema");

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";
const ENTITLEMENT_ID =
  process.env.REVENUECAT_ENTITLEMENT_ID || "no_adds_and_features";
const WEBHOOK_AUTH =
  process.env.REVENUECAT_WEBHOOK_AUTH ||
  process.env.REVENUECAT_WEBHOOK_SECRET ||
  "";
const SECRET_API_KEY = process.env.REVENUECAT_SECRET_API_KEY || "";

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateFromMsOrNull(value) {
  if (value === null || value === undefined) return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return null;
  return toDateOrNull(new Date(numericValue));
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

function resolveSubscriberProductId(subscriber) {
  const subscriptions = subscriber?.subscriptions || {};
  const entries = Object.entries(subscriptions);
  if (!entries.length) {
    return null;
  }

  let winner = null;
  let winnerTimestamp = -1;

  for (const [productId, payload] of entries) {
    const expiresAt = toDateOrNull(payload?.expires_date);
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

function parseSDKCustomerInfo(customerInfo) {
  const active = customerInfo?.entitlements?.active || {};
  const selectedEntitlement =
    active[ENTITLEMENT_ID] || Object.values(active || {})[0] || null;

  const expiresAt = toDateOrNull(selectedEntitlement?.expirationDate);
  const entitled = Boolean(selectedEntitlement?.isActive);

  return {
    entitled,
    plan: derivePlan(selectedEntitlement?.productIdentifier),
    expiresAt,
    source: "revenuecat",
    productId: selectedEntitlement?.productIdentifier || null,
    store: selectedEntitlement?.store || null,
    willRenew: Boolean(selectedEntitlement?.willRenew),
    activeEntitlement: selectedEntitlement?.identifier || ENTITLEMENT_ID,
  };
}

function parseRCSubscriberPayload(subscriber) {
  const active = subscriber?.entitlements || {};
  const entitlement = active?.[ENTITLEMENT_ID];
  const resolvedProductId =
    entitlement?.product_identifier || resolveSubscriberProductId(subscriber);

  const expiresAt = toDateOrNull(entitlement?.expires_date);
  const now = Date.now();
  const entitled = Boolean(expiresAt && expiresAt.getTime() > now);

  // I4: willRenew debe ser false si el usuario canceló (aunque siga con acceso hasta expiración)
  const willRenew =
    !subscriber?.subscriptions?.[resolvedProductId]?.unsubscribe_detected_at &&
    entitled;

  return {
    entitled,
    plan: derivePlan(resolvedProductId),
    expiresAt,
    source: "revenuecat",
    productId: resolvedProductId || null,
    store: entitlement?.store || null,
    willRenew,
    activeEntitlement: entitlement ? ENTITLEMENT_ID : null,
  };
}

async function updateUserPremium(userId, premiumState) {
  if (!userId) return null;
  const normalizedPlan =
    premiumState?.plan === "monthly" || premiumState?.plan === "annual"
      ? premiumState.plan
      : null;

  const update = {
    premium: {
      entitled: Boolean(premiumState?.entitled),
      plan: normalizedPlan,
      expiresAt: premiumState?.expiresAt || null,
      source: "revenuecat",
      lastSyncAt: new Date(),
    },
    isPremium: Boolean(premiumState?.entitled),
  };

  return userSchema.findByIdAndUpdate(userId, { $set: update }, { new: true });
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

  const expiresAt = payload?.expiration_at_ms
    ? new Date(Number(payload.expiration_at_ms))
    : toDateOrNull(payload?.expiration_at);

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
    entitled = hasAccessByExpiry;
    willRenew = false;
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

  return {
    eventId,
    eventTimestamp,
    appUserId: payload?.app_user_id || null,
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
    plan: derivePlan(payload?.product_id),
    type,
    applyEntitlementUpdate,
    keepExistingSubscriptionState,
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

async function getRevenueCatSubscriber(appUserId) {
  if (!SECRET_API_KEY || !appUserId) {
    return null;
  }

  const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(appUserId)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${SECRET_API_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });

  return response?.data?.subscriber || null;
}

module.exports = {
  entitlementId: ENTITLEMENT_ID,
  derivePlan,

  validateWebhookAuth(req) {
    if (!WEBHOOK_AUTH) {
      return true;
    }

    const authHeader = (req.headers?.authorization || "").trim();
    if (!authHeader) {
      return false;
    }

    if (authHeader === WEBHOOK_AUTH) {
      return true;
    }

    if (authHeader === `Bearer ${WEBHOOK_AUTH}`) {
      return true;
    }

    return false;
  },

  async linkCustomer(user, appUserId) {
    const resolvedAppUserId = (appUserId || user?._id?.toString() || "").trim();
    if (!resolvedAppUserId) {
      return null;
    }

    return upsertBillingCustomer({
      userId: user._id,
      appUserId: resolvedAppUserId,
      originalAppUserId: resolvedAppUserId,
      activeEntitlement: user?.premium?.entitled ? ENTITLEMENT_ID : null,
      store: user?.premium?.source || null,
      productId: null,
      expiresAt: user?.premium?.expiresAt || null,
      willRenew: false,
      lastEventAt: new Date(),
    });
  },

  async syncFromCustomerInfo(user, customerInfo, explicitPlan) {
    const premiumState = parseSDKCustomerInfo(customerInfo);

    // Si derivePlan no pudo determinar el plan desde el productId pero el frontend
    // lo conoce con certeza (viene de purchasePlan), usarlo directamente
    if (
      premiumState.plan === "unknown" &&
      (explicitPlan === "monthly" || explicitPlan === "annual")
    ) {
      premiumState.plan = explicitPlan;
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
  },

  async restoreFromRevenueCat(user, appUserId) {
    const resolvedAppUserId = appUserId || user?._id?.toString();
    const subscriber = await getRevenueCatSubscriber(resolvedAppUserId);
    if (!subscriber) {
      return null;
    }

    const premiumState = parseRCSubscriberPayload(subscriber);

    await Promise.all([
      updateUserPremium(user._id, premiumState),
      upsertBillingCustomer({
        userId: user._id,
        appUserId: resolvedAppUserId,
        originalAppUserId: subscriber?.original_app_user_id || resolvedAppUserId,
        activeEntitlement: premiumState.activeEntitlement,
        store: premiumState.store,
        productId: premiumState.productId,
        expiresAt: premiumState.expiresAt,
        willRenew: premiumState.willRenew,
        lastEventAt: new Date(),
      }),
    ]);

    return premiumState;
  },

  async processWebhook(rawPayload) {
    let event = parseWebhookEvent(rawPayload);
    const shouldProcess = await ensureEventNotProcessed(event.eventId, event.payload);
    if (!shouldProcess) {
      console.info(
        "[BillingWebhook]",
        JSON.stringify({
          eventId: event.eventId,
          type: event.type,
          appUserId: event.appUserId,
          productId: event.productId,
          applied: false,
          reason: "duplicate_event",
        }),
      );
      return { processed: false, duplicated: true };
    }

    if (!event.appUserId) {
      console.info(
        "[BillingWebhook]",
        JSON.stringify({
          eventId: event.eventId,
          type: event.type,
          appUserId: event.appUserId,
          productId: event.productId,
          applied: false,
          reason: "missing_app_user_id",
        }),
      );
      return { processed: false, reason: "missing_app_user_id" };
    }

    let billingCustomer = await billingCustomerSchema.findOne({
      appUserId: event.appUserId,
    });

    if (!billingCustomer && event.originalAppUserId) {
      billingCustomer = await billingCustomerSchema.findOne({
        originalAppUserId: event.originalAppUserId,
      });
    }

    if (!shouldApplyEventByOrder(event, billingCustomer)) {
      console.info(
        "[BillingWebhook]",
        JSON.stringify({
          eventId: event.eventId,
          type: event.type,
          appUserId: event.appUserId,
          productId: event.productId,
          entitled: event.entitled,
          willRenew: event.willRenew,
          applied: false,
          reason: "stale_event",
        }),
      );
      return { processed: true, duplicated: false, applied: false, reason: "stale_event" };
    }

    if (!event.productId && billingCustomer?.productId) {
      event.productId = billingCustomer.productId;
    }
    if (event.plan === "unknown" && event.productId) {
      event.plan = derivePlan(event.productId);
    }

    let user = null;
    if (mongoose.Types.ObjectId.isValid(event.appUserId)) {
      user = await userSchema.findById(event.appUserId);
    }

    if (!user && billingCustomer?.userId) {
      user = await userSchema.findById(billingCustomer.userId);
    }

    if (event.plan === "unknown" && user?.premium?.plan) {
      event.plan = user.premium.plan;
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

    console.info(
      "[BillingWebhook]",
      JSON.stringify({
        eventId: event.eventId,
        type: event.type,
        appUserId: event.appUserId,
        productId: resolvedCustomerState.productId,
        entitled: event.applyEntitlementUpdate ? event.entitled : null,
        willRenew: resolvedCustomerState.willRenew,
        applied: true,
        reason: event.applyEntitlementUpdate ? "updated_entitlement" : "mapping_only",
      }),
    );

    return {
      processed: true,
      duplicated: false,
      applied: true,
      mappingOnly: !event.applyEntitlementUpdate,
    };
  },
};
