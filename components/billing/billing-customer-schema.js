const mongoose = require("mongoose");

const BillingCustomerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    appUserId: { type: String, required: true, index: true, unique: true },
    originalAppUserId: { type: String },
    activeEntitlement: { type: String },
    store: { type: String },
    productId: { type: String },
    expiresAt: { type: Date },
    willRenew: { type: Boolean, default: false },
    lastEventAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "billing_customers",
  },
);

module.exports = mongoose.model("BillingCustomer", BillingCustomerSchema);
