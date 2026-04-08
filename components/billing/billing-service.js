const axios = require("axios");
const mongoose = require("mongoose");
const userSchema = require("../users/schema");
const billingCustomerSchema = require("./billing-customer-schema");
const billingEventSchema = require("./billing-event-schema");

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";
const ENTITLEMENT_ID =
  process.env.REVENUECAT_ENTITLEMENT_ID || "no_adds_and_features";
const WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH || "";
const SECRET_API_KEY = process.env.REVENUECAT_SECRET_API_KEY || "";

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function derivePlan(productId) {
  const id = (productId || "").toLowerCase();
  if (id.includes("year") || id.includes("annual") || id.includes("anual")) {
    return "annual";
  }
  if (id.includes("month") || id.includes("mensual")) {
    return "monthly";
  }
  return "unknown";
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

  const expiresAt = toDateOrNull(entitlement?.expires_date);
  const now = Date.now();
  const entitled = Boolean(expiresAt && expiresAt.getTime() > now);

  return {
    entitled,
    plan: derivePlan(entitlement?.product_identifier),
    expiresAt,
    source: "revenuecat",
    productId: entitlement?.product_identifier || null,
    store: entitlement?.store || null,
    willRenew: entitled,
    activeEntitlement: entitlement ? ENTITLEMENT_ID : null,
  };
}

async function updateUserPremium(userId, premiumState) {
  if (!userId) return null;

  const update = {
    premium: {
      entitled: Boolean(premiumState?.entitled),
      plan: premiumState?.plan || null,
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
  const eventId =
    payload?.id ||
    payload?.event_id ||
    `${payload?.type || "unknown"}-${payload?.app_user_id || "unknown"}-${payload?.event_timestamp_ms || Date.now()}`;

  const expiresAt = payload?.expiration_at_ms
    ? new Date(Number(payload.expiration_at_ms))
    : toDateOrNull(payload?.expiration_at);

  const now = Date.now();
  const isTerminalEvent =
    payload?.type === "EXPIRATION" ||
    payload?.type === "REFUND" ||
    payload?.type === "REVOKE";

  const entitled = isTerminalEvent
    ? false
    : Boolean(expiresAt && expiresAt.getTime() > now);

  return {
    eventId,
    appUserId: payload?.app_user_id || null,
    originalAppUserId: payload?.original_app_user_id || payload?.app_user_id || null,
    activeEntitlement:
      Array.isArray(payload?.entitlement_ids) && payload.entitlement_ids.length
        ? payload.entitlement_ids[0]
        : ENTITLEMENT_ID,
    store: payload?.store || null,
    productId: payload?.product_id || null,
    expiresAt: expiresAt || null,
    willRenew: Boolean(payload?.renewal_number || payload?.period_type === "NORMAL"),
    entitled,
    plan: derivePlan(payload?.product_id),
    type: payload?.type || "unknown",
    payload,
  };
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

  validateWebhookAuth(req) {
    if (!WEBHOOK_AUTH) {
      return true;
    }

    const authHeader = req.headers?.authorization || "";
    return authHeader === `Bearer ${WEBHOOK_AUTH}`;
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

  async syncFromCustomerInfo(user, customerInfo) {
    const premiumState = parseSDKCustomerInfo(customerInfo);
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
    const event = parseWebhookEvent(rawPayload);
    const shouldProcess = await ensureEventNotProcessed(event.eventId, event.payload);
    if (!shouldProcess) {
      return { processed: false, duplicated: true };
    }

    if (!event.appUserId) {
      return { processed: false, reason: "missing_app_user_id" };
    }

    let user = null;
    if (mongoose.Types.ObjectId.isValid(event.appUserId)) {
      user = await userSchema.findById(event.appUserId);
    }

    if (!user) {
      const billingCustomer = await billingCustomerSchema.findOne({
        appUserId: event.appUserId,
      });
      if (billingCustomer?.userId) {
        user = await userSchema.findById(billingCustomer.userId);
      }
    }

    if (user) {
      await updateUserPremium(user._id, event);
      await billingEventSchema.updateOne(
        { eventId: event.eventId },
        { $set: { userId: user._id } },
      );
    }

    await upsertBillingCustomer({
      userId: user?._id || null,
      appUserId: event.appUserId,
      originalAppUserId: event.originalAppUserId,
      activeEntitlement: event.activeEntitlement,
      store: event.store,
      productId: event.productId,
      expiresAt: event.expiresAt,
      willRenew: event.willRenew,
      lastEventAt: new Date(),
    });

    return { processed: true, duplicated: false };
  },
};
