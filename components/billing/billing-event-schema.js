const mongoose = require("mongoose");

const BillingEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, index: true },
    store: { type: String },
    appUserId: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    processedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "billing_events",
  },
);

module.exports = mongoose.model("BillingEvent", BillingEventSchema);
