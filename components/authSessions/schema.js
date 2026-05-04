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
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null, index: true },
    revokedReason: { type: String, default: null },
    replacedBySessionId: { type: String, default: null },
    passwordVersion: { type: Number, default: 0 },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    deviceLabel: { type: String, default: null },
  },
  {
    versionKey: false,
  }
);

module.exports = mongoose.model("AuthSession", AuthSessionSchema);
