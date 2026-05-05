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
    impersonatedByUserId,
    impersonatedFromSessionId,
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
      impersonatedByUserId: impersonatedByUserId || null,
      impersonatedFromSessionId: impersonatedFromSessionId || null,
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

    return AuthSession.updateMany(
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

  static async enforceActiveSessionLimit(
    userId,
    maxActiveSessions = 3,
    keepSessionId = null
  ) {
    if (!userId || maxActiveSessions < 1) {
      return [];
    }

    const activeSessions = await AuthSession.find({
      userId,
      revokedAt: null,
    })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .lean();

    if (activeSessions.length <= maxActiveSessions) {
      return [];
    }

    const keptSessionIds = new Set();
    const sessionsToKeep = [];
    if (keepSessionId) {
      keptSessionIds.add(keepSessionId);
      sessionsToKeep.push(keepSessionId);
    }

    for (const session of activeSessions) {
      if (sessionsToKeep.length >= maxActiveSessions) {
        break;
      }

      if (keptSessionIds.has(session.sessionId)) {
        continue;
      }

      keptSessionIds.add(session.sessionId);
      sessionsToKeep.push(session.sessionId);
    }

    return AuthSession.updateMany(
      {
        userId,
        revokedAt: null,
        sessionId: { $nin: sessionsToKeep },
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: "session_limit_exceeded",
          replacedBySessionId: keepSessionId || null,
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
      {
        sessionId,
        revokedAt: null,
        refreshTokenHash: currentRefreshTokenHash,
      },
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

  static async updateRotatedRefreshTokenFromPreviousGrace({
    sessionId,
    previousRefreshTokenHash,
    nextPreviousRefreshTokenHash,
    nextRefreshTokenHash,
    expiresAt,
    passwordVersion,
    graceStartedAfter,
  }) {
    return AuthSession.findOneAndUpdate(
      {
        sessionId,
        revokedAt: null,
        previousRefreshTokenHash,
        rotationTimestamp: { $gte: graceStartedAfter },
      },
      {
        $set: {
          previousRefreshTokenHash: nextPreviousRefreshTokenHash || null,
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
