const AuthSession = require("../components/authSessions/schema");

class AuthSessionService {
  static async createSession({
    sessionId,
    userId,
    platform,
    refreshTokenHash,
    expiresAt,
  }) {
    return AuthSession.create({
      sessionId,
      userId,
      platform,
      refreshTokenHash,
      expiresAt,
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

  static async revokeSession(sessionId) {
    if (!sessionId) {
      return null;
    }

    return AuthSession.findOneAndUpdate(
      { sessionId, revokedAt: null },
      {
        $set: {
          revokedAt: new Date(),
        },
      },
      { new: true }
    );
  }

  static async revokeAllUserSessions(userId) {
    if (!userId) {
      return;
    }

    await AuthSession.updateMany(
      { userId, revokedAt: null },
      {
        $set: {
          revokedAt: new Date(),
        },
      }
    );
  }

  static async updateRotatedRefreshToken({
    sessionId,
    currentRefreshTokenHash,
    nextRefreshTokenHash,
    expiresAt,
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
