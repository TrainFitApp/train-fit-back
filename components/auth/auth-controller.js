const bcrypt = require("../util/bcrypt");
const userDto = require("../users/dto");
const userModel = require("../users/model");
const userSchema = require("../users/schema");
const TokenService = require("../../services/token.service");
const AuthSessionService = require("../../services/auth-session.service");
const mail = require("../util/mail");

const REFRESH_GRACE_MS = Number(process.env.REFRESH_TOKEN_GRACE_MS || 60000);
const AUTH_RESPONSE_EXPIRES_IN_SECONDS = 15 * 60;
const MAX_ACTIVE_SESSIONS_PER_USER = Math.max(
  1,
  Number(process.env.AUTH_MAX_ACTIVE_SESSIONS || 3) || 3
);
const LOGIN_INVALID_RESPONSE = {
  error: "INVALID_CREDENTIALS",
  message: "Correo o contraseña incorrectos",
};
const LOGIN_UNAVAILABLE_RESPONSE = {
  error: "LOGIN_UNAVAILABLE",
  message: "Ha ocurrido un error inesperado",
};

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

function sendInvalidLoginResponse(res) {
  return res.status(401).send(LOGIN_INVALID_RESPONSE);
}

function isPasswordValid(password, encryptedPassword) {
  if (!password || !encryptedPassword) {
    return false;
  }

  try {
    return bcrypt.comparePasswords(password, encryptedPassword);
  } catch (error) {
    console.warn("[AUTH] auth_login_password_compare_failed", {
      reason: error?.message || "password_compare_failed",
    });
    return false;
  }
}

function resolveClientContext(req) {
  const platformHeader = String(req.headers?.["x-client-platform"] || "")
    .trim()
    .toLowerCase();
  const clientFamily =
    String(req.headers?.["x-client-family"] || "").trim() || "trainfit-front";

  const platform = ["web", "ios", "android"].includes(platformHeader)
    ? platformHeader
    : "unknown";

  return {
    platform,
    clientFamily,
    audience: clientFamily,
    isNativeClient: platform === "ios" || platform === "android",
  };
}

async function buildAuthResponse({
  user,
  accessToken,
  refreshToken,
  clientContext,
}) {
  const response = {
    user: await userDto.single(user),
    access_token: accessToken,
    expires_in: AUTH_RESPONSE_EXPIRES_IN_SECONDS,
    token_type: "Bearer",
  };

  if (clientContext.isNativeClient && refreshToken) {
    response.refresh_token = refreshToken;
  }

  return response;
}

async function issueSession(user, req, res, sessionOptions = {}) {
  const clientContext = resolveClientContext(req);
  const sessionId = TokenService.generateSessionId();
  const userRoles = user.roles || ["user"];
  const passwordVersion = user.passwordVersion || 0;

  const refreshToken = TokenService.generateRefreshToken(
    {
      sub: user._id.toString(),
      sid: sessionId,
      pver: passwordVersion,
    },
    {
      audience: clientContext.audience,
    }
  );

  const accessToken = TokenService.generateAccessToken(
    {
      sub: user._id.toString(),
      sid: sessionId,
      email: user.email,
      roles: userRoles,
      provider: user.provider || null,
    },
    {
      audience: clientContext.audience,
    }
  );

  await AuthSessionService.createSession({
    sessionId,
    userId: user._id,
    clientFamily: clientContext.clientFamily,
    platform: clientContext.platform,
    refreshTokenHash: TokenService.hashToken(refreshToken),
    expiresAt: TokenService.getExpirationDate(refreshToken),
    passwordVersion,
    impersonatedByUserId: sessionOptions.impersonatedByUserId || null,
    impersonatedFromSessionId:
      sessionOptions.impersonatedFromSessionId || null,
    ip: req.ip,
    userAgent: req.headers?.["user-agent"] || null,
    deviceLabel: req.headers?.["x-device-label"] || null,
  });

  const limitResult = await AuthSessionService.enforceActiveSessionLimit(
    user._id,
    MAX_ACTIVE_SESSIONS_PER_USER,
    sessionId
  );
  const revokedByLimit =
    limitResult?.modifiedCount ?? limitResult?.nModified ?? 0;
  if (revokedByLimit > 0) {
    console.info("[AUTH] auth_session_revoked", {
      userId: user._id.toString(),
      reason: "session_limit_exceeded",
      count: revokedByLimit,
      replacedBySessionId: sessionId,
    });
  }

  if (!clientContext.isNativeClient) {
    TokenService.setRefreshTokenCookie(res, refreshToken);
  }

  console.info("[AUTH] auth_login_success", {
    userId: user._id.toString(),
    sessionId,
    platform: clientContext.platform,
    clientFamily: clientContext.clientFamily,
    impersonatedByUserId: sessionOptions.impersonatedByUserId || null,
  });

  return buildAuthResponse({
    user,
    accessToken,
    refreshToken,
    clientContext,
  });
}

function clearRefreshArtifacts(req, res) {
  const clientContext = resolveClientContext(req);
  if (!clientContext.isNativeClient) {
    TokenService.clearRefreshTokenCookie(res);
  }
}

async function revokeSessionByPayload(payload, reason = "logout") {
  const sessionId = payload?.sid;
  if (!sessionId) {
    return;
  }
  await AuthSessionService.revokeSession(sessionId, reason);
}

async function getValidatedGoogleIdentity(tokenGoogle) {
  const payload = await userModel.validateGoogleToken(tokenGoogle);
  const email = normalizeEmail(payload?.email);

  if (!email) {
    throw new Error("Google account email not available");
  }

  if (!payload?.email_verified) {
    throw new Error("Google account email is not verified");
  }

  return {
    email,
    provider: "google",
    payload,
  };
}

async function getValidatedAppleIdentity(tokenApple, fallbackEmail = null) {
  const payload = await userModel.validateAppleToken(tokenApple);
  const appleId = payload?.sub || null;
  const email = normalizeEmail(payload?.email) || normalizeEmail(fallbackEmail);

  if (!appleId) {
    throw new Error("Apple account identifier not available");
  }

  return {
    appleId,
    email,
    provider: "apple",
    payload,
  };
}

module.exports = {
  async login(req, res) {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = req.body?.password;

      if (!email || !password) {
        return res
          .status(400)
          .send({
            error: "INVALID_LOGIN_REQUEST",
            message: "Email y contraseña requeridos",
          });
      }

      const user = await userModel.getUserByEmail(email);
      if (!user) {
        return sendInvalidLoginResponse(res);
      }

      const isMatch = isPasswordValid(password, user.password);
      if (!isMatch) {
        return sendInvalidLoginResponse(res);
      }

      if (user.hash) {
        const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();
        user.hash = hashTemp;
        await userModel.updateUser(user);

        const header1 = `Hola ${user.name}, verifique su cuenta`;
        const description =
          "Introduce el siguiente código en la aplicación para finalizar el registro.";
        const htmlMail = mail.generateHashMail(header1, description, hashTemp);
        await mail.sendMailSES(
          user.email,
          "Verificación de cuenta - TrainFit",
          htmlMail
        );

        return res.status(403).send({
          error: "ACCOUNT_NOT_VERIFIED",
          message: "Cuenta no verificada. Se ha enviado un nuevo código.",
          email: user.email,
        });
      }

      return res.status(200).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("[AUTH] auth_login_unexpected_error", {
        message: error?.message,
        stack: error?.stack,
      });
      return res.status(500).send(LOGIN_UNAVAILABLE_RESPONSE);
    }
  },

  async refresh(req, res) {
    try {
      const extracted = TokenService.extractRefreshToken(req);

      if (extracted.source === "conflict") {
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "conflicting_refresh_token_sources",
          source: extracted.source,
          platform: resolveClientContext(req).platform,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Conflicting refresh token sources",
          requiresRelogin: true,
        });
      }

      if (!extracted.token) {
        console.warn("[AUTH] auth_refresh_missing_token", {
          reason: "missing_refresh_token",
          source: extracted.source || null,
          platform: resolveClientContext(req).platform,
        });
        clearRefreshArtifacts(req, res);
        return res
          .status(401)
          .send({ message: "No refresh token", requiresRelogin: true });
      }

      const decoded = TokenService.verifyRefreshToken(extracted.token);
      if (!decoded || decoded.type !== "refresh") {
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "invalid_refresh_token",
          source: extracted.source,
          hasDecodedPayload: !!decoded,
          tokenType: decoded?.type || null,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Invalid refresh token",
          requiresRelogin: true,
        });
      }

      const clientContext = resolveClientContext(req);
      if (decoded.aud !== clientContext.audience) {
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "invalid_refresh_token_audience",
          source: extracted.source,
          expectedAudience: clientContext.audience,
          tokenAudience: decoded.aud || null,
          sessionId: decoded.sid || null,
          userId: decoded.sub || null,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Invalid refresh token audience",
          requiresRelogin: true,
        });
      }

      const session = await AuthSessionService.getSessionById(decoded.sid);
      if (!session || session.revokedAt) {
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: session?.revokedAt ? "session_revoked" : "session_missing",
          source: extracted.source,
          sessionId: decoded.sid,
          userId: decoded.sub,
          revokedReason: session?.revokedReason || null,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Session revoked",
          requiresRelogin: true,
        });
      }

      const user = await userSchema.findById(decoded.sub);
      if (!user) {
        await AuthSessionService.revokeSession(session.sessionId, "user_missing");
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "user_missing",
          source: extracted.source,
          sessionId: session.sessionId,
          userId: decoded.sub,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "User not found",
          requiresRelogin: true,
        });
      }

      const passwordVersion = user.passwordVersion || 0;
      if (
        decoded.pver !== passwordVersion ||
        session.passwordVersion !== passwordVersion
      ) {
        await AuthSessionService.revokeSession(
          session.sessionId,
          "password_changed"
        );
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "password_version_mismatch",
          source: extracted.source,
          sessionId: session.sessionId,
          userId: user._id.toString(),
          tokenPasswordVersion: decoded.pver,
          userPasswordVersion: passwordVersion,
          sessionPasswordVersion: session.passwordVersion,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Session expired by password change",
          requiresRelogin: true,
        });
      }

      if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
        await AuthSessionService.revokeSession(session.sessionId, "refresh_expired");
        console.warn("[AUTH] auth_refresh_invalid_cookie", {
          reason: "refresh_expired",
          source: extracted.source,
          sessionId: session.sessionId,
          userId: user._id.toString(),
          expiresAt: session.expiresAt,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Refresh session expired",
          requiresRelogin: true,
        });
      }

      const currentTokenHash = TokenService.hashToken(extracted.token);
      const isCurrent = session.refreshTokenHash === currentTokenHash;
      const isPrevious = session.previousRefreshTokenHash === currentTokenHash;
      const withinGrace =
        !!session.rotationTimestamp &&
        Date.now() - new Date(session.rotationTimestamp).getTime() <
          REFRESH_GRACE_MS;

      if (!isCurrent) {
        if (isPrevious && withinGrace) {
          const accessToken = TokenService.generateAccessToken(
            {
              sub: user._id.toString(),
              sid: session.sessionId,
              email: user.email,
              roles: user.roles || ["user"],
              provider: user.provider || null,
            },
            { audience: clientContext.audience }
          );

          const response = {
            access_token: accessToken,
            expires_in: AUTH_RESPONSE_EXPIRES_IN_SECONDS,
            token_type: "Bearer",
            refresh_already_rotated: true,
          };

          console.info("[AUTH] auth_refresh_grace_reuse", {
            userId: user._id.toString(),
            sessionId: session.sessionId,
            source: extracted.source,
          });

          return res.send(response);
        }

        await AuthSessionService.revokeSession(
          session.sessionId,
          "refresh_token_reuse_detected"
        );
        console.warn("[AUTH] auth_refresh_reuse_detected", {
          userId: user._id.toString(),
          sessionId: session.sessionId,
          source: extracted.source,
          reason: "refresh_token_reuse_detected",
          withinGrace,
        });
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Refresh token reuse detected",
          requiresRelogin: true,
        });
      }

      const nextRefreshToken = TokenService.generateRefreshToken(
        {
          sub: user._id.toString(),
          sid: session.sessionId,
          pver: passwordVersion,
        },
        { audience: clientContext.audience }
      );

      const accessToken = TokenService.generateAccessToken(
        {
          sub: user._id.toString(),
          sid: session.sessionId,
          email: user.email,
          roles: user.roles || ["user"],
          provider: user.provider || null,
        },
        { audience: clientContext.audience }
      );

      const rotatedSession = await AuthSessionService.updateRotatedRefreshToken({
        sessionId: session.sessionId,
        currentRefreshTokenHash: currentTokenHash,
        nextRefreshTokenHash: TokenService.hashToken(nextRefreshToken),
        expiresAt: TokenService.getExpirationDate(nextRefreshToken),
        passwordVersion,
      });

      if (!rotatedSession) {
        const latestSession = await AuthSessionService.getSessionById(
          session.sessionId
        );
        const lostRaceWithinGrace =
          latestSession?.previousRefreshTokenHash === currentTokenHash &&
          !!latestSession.rotationTimestamp &&
          Date.now() - new Date(latestSession.rotationTimestamp).getTime() <
            REFRESH_GRACE_MS &&
          !latestSession.revokedAt;

        if (lostRaceWithinGrace) {
          console.info("[AUTH] auth_refresh_grace_reuse", {
            userId: user._id.toString(),
            sessionId: session.sessionId,
            source: extracted.source,
            reason: "lost_rotation_race",
          });

          return res.send({
            access_token: accessToken,
            expires_in: AUTH_RESPONSE_EXPIRES_IN_SECONDS,
            token_type: "Bearer",
            refresh_already_rotated: true,
          });
        }

        return res.status(409).send({
          message: "Refresh token already rotated",
        });
      }

      if (!clientContext.isNativeClient) {
        TokenService.setRefreshTokenCookie(res, nextRefreshToken);
      }

      const response = {
        access_token: accessToken,
        expires_in: AUTH_RESPONSE_EXPIRES_IN_SECONDS,
        token_type: "Bearer",
      };

      if (clientContext.isNativeClient) {
        response.refresh_token = nextRefreshToken;
      }

      console.info("[AUTH] auth_refresh_success", {
        userId: user._id.toString(),
        sessionId: session.sessionId,
        platform: clientContext.platform,
        source: extracted.source,
      });

      return res.send(response);
    } catch (error) {
      console.error("Error in auth/refresh:", error);
      return res.status(500).send({ message: "Internal server error" });
    }
  },

  async logout(req, res) {
    try {
      const accessToken = TokenService.extractBearerToken(req);
      const accessPayload = accessToken
        ? TokenService.verifyAccessToken(accessToken)
        : null;

      if (accessPayload?.sid) {
        await AuthSessionService.revokeSession(accessPayload.sid, "logout");
        console.info("[AUTH] auth_logout_called", {
          source: "access_token",
          sessionId: accessPayload.sid,
          userId: accessPayload.sub || null,
        });
      } else {
        const extracted = TokenService.extractRefreshToken(req);
        if (extracted.token) {
          const refreshPayload = TokenService.verifyRefreshToken(extracted.token);
          if (refreshPayload?.sid) {
            await AuthSessionService.revokeSession(refreshPayload.sid, "logout");
            console.info("[AUTH] auth_logout_called", {
              source: extracted.source,
              sessionId: refreshPayload.sid,
              userId: refreshPayload.sub || null,
            });
          }
        }
      }

      clearRefreshArtifacts(req, res);
      return res.status(200).send({ ok: true });
    } catch (error) {
      console.error("Error in auth/logout:", error);
      clearRefreshArtifacts(req, res);
      return res.status(200).send({ ok: true });
    }
  },

  async me(req, res) {
    return res.send({
      user: await userDto.single(req.user),
    });
  },

  async activate(req, res) {
    try {
      const email = normalizeEmail(req.body?.email);
      const code = String(req.body?.code || "").trim();

      if (!email || !code) {
        return res.status(400).send({ message: "Faltan datos requeridos" });
      }

      const user = await userModel.getUserByEmail(email);
      if (!user) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      if (user.hash !== code) {
        return res.status(400).send({ message: "Código incorrecto" });
      }

      await userSchema.findByIdAndUpdate(user._id, {
        $unset: { hash: 1 },
      });

      return res.status(200).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("Error en auth/activate:", error);
      return res.status(500).send({ message: "Error interno del servidor" });
    }
  },

  async verifyGoogle(req, res) {
    try {
      const tokenGoogle = req.body?.tokenGoogle;
      if (!tokenGoogle) {
        return res.status(400).send({ message: "Token requerido" });
      }

      const identity = await getValidatedGoogleIdentity(tokenGoogle);
      const user = await userModel.getUserByEmail(identity.email);

      if (!user) {
        return res.status(404).send({
          message: "Usuario no encontrado",
          registrationRequired: true,
          provider: "google",
          email: identity.email,
        });
      }

      return res.status(200).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("Error en auth/social/google/verify:", error);
      return res
        .status(401)
        .send({ message: "Token de Google inválido o expirado" });
    }
  },

  async verifyApple(req, res) {
    try {
      const tokenApple = req.body?.tokenApple;
      if (!tokenApple) {
        return res.status(400).send({ message: "Token requerido" });
      }

      const identity = await getValidatedAppleIdentity(
        tokenApple,
        req.body?.email
      );

      let user = await userModel.getUserByAppleId(identity.appleId);
      if (!user && identity.email) {
        user = await userModel.getUserByEmail(identity.email);
      }

      if (!user) {
        return res.status(404).send({
          message: "Usuario no encontrado",
          registrationRequired: true,
          provider: "apple",
          email: identity.email,
          appleId: identity.appleId,
        });
      }

      if (user.appleId && user.appleId !== identity.appleId) {
        return res.status(401).send({
          message: "Apple ID no corresponde al usuario",
        });
      }

      if (!user.appleId) {
        user = await userSchema.findByIdAndUpdate(
          user._id,
          { $set: { appleId: identity.appleId } },
          { new: true }
        );
      }

      return res.status(200).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("Error en auth/social/apple/verify:", error);
      return res
        .status(401)
        .send({ message: "Token de Apple inválido o expirado" });
    }
  },

  async registerSocial(req, res) {
    try {
      const provider = String(req.body?.provider || "").trim().toLowerCase();
      if (!["google", "apple"].includes(provider)) {
        return res.status(400).send({ message: "Proveedor inválido" });
      }

      let identity;
      if (provider === "google") {
        identity = await getValidatedGoogleIdentity(req.body?.tokenGoogle);
      } else {
        identity = await getValidatedAppleIdentity(
          req.body?.tokenApple,
          req.body?.email || req.body?.user?.email
        );
      }

      if (!identity.email) {
        return res.status(400).send({
          message: "Email requerido para completar el registro social",
        });
      }

      let user = null;
      if (provider === "apple" && identity.appleId) {
        user = await userModel.getUserByAppleId(identity.appleId);
      }
      if (!user && identity.email) {
        user = await userModel.getUserByEmail(identity.email);
      }

      if (user && user.name) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }

      if (
        provider === "apple" &&
        user?.appleId &&
        user.appleId !== identity.appleId
      ) {
        return res.status(409).send({
          message: "Este email ya esta vinculado a otra cuenta de Apple",
        });
      }

      if (!user) {
        user = await userSchema.create({
          email: identity.email,
          appleId: identity.appleId || undefined,
          roles: ["user"],
          provider,
        });
        mail.notifyUserRegistered(user, {
          source: "auth.registerSocial",
          provider,
          ip: req.ip,
          userAgent: req.headers?.["user-agent"],
        });
      } else if (provider === "apple" && identity.appleId && !user.appleId) {
        user = await userSchema.findByIdAndUpdate(
          user._id,
          { $set: { appleId: identity.appleId } },
          { new: true }
        );
      }

      return res.status(201).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("Error en auth/social/register:", error);
      return res.status(500).send({ message: "No se pudo crear el usuario" });
    }
  },

  async completeSocial(req, res) {
    try {
      if (!req.user) {
        return res.status(401).send({ message: "Usuario no autenticado" });
      }

      const profile = {
        ...(req.body || {}),
        email: req.user.email,
        _id: req.user._id,
      };

      let updatedUser;
      if (req.user.provider === "apple") {
        updatedUser = await userModel.updateAppleUser(profile, new Date());
      } else {
        updatedUser = await userModel.updateGoogleUser(profile, new Date());
      }

      return res.send({
        user: await userDto.single(updatedUser),
      });
    } catch (error) {
      console.error("Error en auth/social/complete:", error);
      return res
        .status(500)
        .send({ message: "No se pudo completar el perfil social" });
    }
  },

  async impersonate(req, res) {
    try {
      const targetUserId = req.body?.userId;
      if (!targetUserId) {
        return res.status(400).send({ message: "userId requerido" });
      }

      const targetUser = await userSchema.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      await userSchema.findByIdAndUpdate(targetUser._id, {
        $set: { lastLogin: new Date() },
      });

      const response = await issueSession(targetUser, req, res, {
        impersonatedByUserId: req.user._id,
        impersonatedFromSessionId: req.auth.sessionId,
      });

      return res.status(200).send(response);
    } catch (error) {
      console.error("Error en auth/impersonate:", error);
      return res.status(500).send({ message: "Error al impersonar usuario" });
    }
  },

  async revertImpersonation(req, res) {
    try {
      const currentSession = await AuthSessionService.getSessionById(
        req.auth?.sessionId
      );

      if (
        !currentSession ||
        !currentSession.impersonatedByUserId ||
        !currentSession.impersonatedFromSessionId
      ) {
        return res.status(400).send({ message: "No active impersonation" });
      }

      const adminAccessToken = req.headers?.["x-admin-access-token"];
      if (!adminAccessToken) {
        return res.status(401).send({
          message: "Admin token required",
          requiresRelogin: true,
        });
      }

      const clientContext = resolveClientContext(req);
      const adminPayload = TokenService.verifyAccessToken(adminAccessToken, {
        audiences: [clientContext.audience],
      });

      if (
        !adminPayload ||
        adminPayload.type !== "access" ||
        !adminPayload.sid ||
        !adminPayload.sub
      ) {
        return res.status(401).send({
          message: "Invalid admin token",
          requiresRelogin: true,
        });
      }

      const adminSession = await AuthSessionService.getActiveSessionById(
        adminPayload.sid
      );
      const adminUser = await userSchema.findById(adminPayload.sub);
      const isExpectedAdmin =
        currentSession.impersonatedByUserId.toString() ===
          adminPayload.sub.toString() &&
        currentSession.impersonatedFromSessionId === adminPayload.sid;

      if (
        !adminSession ||
        !adminUser ||
        !(adminUser.roles || []).includes("admin") ||
        !isExpectedAdmin
      ) {
        return res.status(401).send({
          message: "Invalid impersonation revert",
          requiresRelogin: true,
        });
      }

      await AuthSessionService.revokeSession(
        currentSession.sessionId,
        "impersonation_reverted",
        adminSession.sessionId
      );

      return res.status(200).send(await issueSession(adminUser, req, res));
    } catch (error) {
      console.error("Error en auth/impersonate/revert:", error);
      return res.status(500).send({
        message: "Error al volver a la sesion admin",
      });
    }
  },
};
