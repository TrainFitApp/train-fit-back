const userSchema = require("../users/user-schema");
const BillingCustomer = require("./billing-customer-schema");
const BillingEvent = require("./billing-event-schema");

// Datos del premium de cliente (RevenueCat): la proyección `User.premium`, el
// cliente de RevenueCat de cada usuario y los eventos de webhook ya
// procesados (idempotencia).
module.exports = {
  findUser: (userId) => userSchema.findById(userId),

  setUserPremium: (userId, premium) => userSchema.findOneAndUpdate({ _id: userId }, { $set: { premium } }, { new: true }),

  setUserPlan: (userId, plan) => userSchema.updateOne({ _id: userId }, { $set: { "premium.plan": plan } }),

  // Quita el premium caducado solo si sigue siendo el mismo (`expiresAt`):
  // nunca pisa una renovación que haya llegado entre medias.
  expireUserPremium(userId, expiresAt) {
    return userSchema.updateOne(
      { _id: userId, "premium.entitled": true, "premium.expiresAt": expiresAt },
      { $set: { "premium.entitled": false } },
    );
  },

  // Premium caducado en BD, por lotes de `_id` (job de reconciliación).
  listExpiredPremium(now, afterId, limit) {
    return userSchema
      .find({
        "premium.entitled": true,
        "premium.expiresAt": { $lte: now },
        ...(afterId ? { _id: { $gt: afterId } } : {}),
      })
      .sort({ _id: 1 })
      .select("_id premium")
      .limit(limit)
      .lean();
  },

  findCustomerByAppUserId: (appUserId) => BillingCustomer.findOne({ appUserId }),
  findCustomerByOriginalAppUserId: (originalAppUserId) => BillingCustomer.findOne({ originalAppUserId }),
  findCustomerByUserId: (userId) => BillingCustomer.findOne({ userId }).lean(),

  upsertCustomer: (appUserId, set) => BillingCustomer.findOneAndUpdate({ appUserId }, { $set: set }, { upsert: true, new: true }),

  // Enlaza el usuario con su cliente de RevenueCat sin tocar el estado de la
  // suscripción.
  linkCustomer(userId, appUserId) {
    return BillingCustomer.findOneAndUpdate(
      { appUserId },
      { $set: { userId }, $setOnInsert: { appUserId, originalAppUserId: appUserId, willRenew: false } },
      { upsert: true, new: true },
    );
  },

  // Lanza E11000 si el evento ya se procesó.
  createEvent: (event) => BillingEvent.create(event),

  setEventUser: (eventId, userId) => BillingEvent.updateOne({ eventId }, { $set: { userId } }),
};
