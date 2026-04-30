const AuthSession = require("../components/authSessions/schema");

class AuthSessionService {
  static async createSession({
    sessionId,
    userId,
    clientFamily,
    platform,
    refreshTokenHash,
    expiresAt,
    passwordVersion,
    ip,
    userAgent,
    deviceLabel,
  }) {
    return AuthSession.create({
      sessionId,
      userId,
      clientFamily,
      platform,
      refreshTokenHash,
      expiresAt,
      passwordVersion: passwordVersion || 0,
      ip: ip || null,
      userAgent: userAgent || null,
      deviceLabel: deviceLabel || null,
    });
  }

  static async getSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    return AuthSession.findOne({ sessionId });
  }

  static async getActiveSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    return AuthSession.findOne({ sessionId, revokedAt: null });
  }

  static async revokeSession(sessionId, reason = "logout", replacedBySessionId = null) {
    if (!sessionId) {
      return null;
    }

    return AuthSession.findOneAndUpdate(
      { sessionId, revokedAt: null },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: reason,
          replacedBySessionId: replacedBySessionId || null,
        },
      },
      { new: true }
    );
  }

  static async revokeAllUserSessions(
    userId,
    reason = "replaced_by_new_login",
    replacedBySessionId = null
  ) {
    if (!userId) {
      return;
    }

    await AuthSession.updateMany(
      { userId, revokedAt: null },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: reason,
          replacedBySessionId: replacedBySessionId || null,
        },
      }
    );
  }

  static async updateRotatedRefreshToken({
    sessionId,
    currentRefreshTokenHash,
    nextRefreshTokenHash,
    expiresAt,
    passwordVersion,
  }) {
    return AuthSession.findOneAndUpdate(
      { sessionId, revokedAt: null },
      {
        $set: {
          previousRefreshTokenHash: currentRefreshTokenHash,
          refreshTokenHash: nextRefreshTokenHash,
          rotationTimestamp: new Date(),
          lastUsedAt: new Date(),
          expiresAt,
          passwordVersion: passwordVersion || 0,
        },
      },
      { new: true }
    );
  }

  static async touchSession(sessionId) {
    if (!sessionId) {
      return null;
    }

    return AuthSession.findOneAndUpdate(
      { sessionId, revokedAt: null },
      { $set: { lastUsedAt: new Date() } },
      { new: true }
    );
  }
}

module.exports = AuthSessionService;
