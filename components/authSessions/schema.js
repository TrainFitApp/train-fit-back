const mongoose = require("mongoose");

const AuthSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clientFamily: { type: String, default: "trainfit-front" },
    platform: {
      type: String,
      enum: ["web", "ios", "android", "unknown"],
      default: "unknown",
    },
    refreshTokenHash: { type: String, required: true },
    previousRefreshTokenHash: { type: String, default: null },
    rotationTimestamp: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true, expires: 0 },
    revokedAt: { type: Date, default: null, index: true },
    revokedReason: { type: String, default: null },
    replacedBySessionId: { type: String, default: null },
    passwordVersion: { type: Number, default: 0 },
    impersonatedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    impersonatedFromSessionId: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    deviceLabel: { type: String, default: null },
  },
  {
    versionKey: false,
    collection: process.env.MONGODB_SESSION_STORAGE || "authsessions",
  }
);

AuthSessionSchema.index({ userId: 1, revokedAt: 1, lastUsedAt: 1 });

module.exports = mongoose.model("AuthSession", AuthSessionSchema);
