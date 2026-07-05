const bcrypt = require("../util/bcrypt");
const userDto = require("../users/dto");
const userModel = require("../users/model");
const userSchema = require("../users/schema");
const TokenService = require("../../services/token.service");
const mail = require("../util/mail");

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

function generateAccessTokenForSession(user, sessionId, audience, extra = {}) {
  return TokenService.signAccess(
    {
      sub: user._id.toString(),
      sid: sessionId,
      roles: user.roles || ["user"],
      pver: user.passwordVersion || 0,
      ...extra,
    },
    { audience }
  );
}

function generateRefreshTokenForSession(user, sessionId, audience) {
  return TokenService.signRefresh(
    {
      sub: user._id.toString(),
      sid: sessionId,
      pver: user.passwordVersion || 0,
    },
    { audience }
  );
}

function isCurrentSession(user, sessionId) {
  return !!(user?.auth?.sessionId && user.auth.sessionId === sessionId);
}

async function clearUserAuthIfCurrent(userId, sessionId) {
  if (!userId || !sessionId) {
    return null;
  }

  return userSchema.findOneAndUpdate(
    { _id: userId, "auth.sessionId": sessionId },
    { $unset: { auth: 1 } },
    { new: true }
  );
}

function clearRefreshArtifacts(req, res) {
  const clientContext = resolveClientContext(req);
  if (!clientContext.isNativeClient) {
    TokenService.clearRefreshTokenCookie(res);
  }
}

function buildRefreshResponse(accessToken, user, isImpersonating = false) {
  return {
    user,
    access_token: accessToken,
    expires_in: TokenService.ACCESS_TOKEN_TTL_SECONDS,
    token_type: "Bearer",
    is_impersonating: isImpersonating,
  };
}

async function buildAuthResponse({
  user,
  accessToken,
  refreshToken,
  clientContext,
  isImpersonating,
}) {
  const response = buildRefreshResponse(
    accessToken,
    await userDto.single(user),
    isImpersonating
  );

  if (clientContext.isNativeClient && refreshToken) {
    response.refresh_token = refreshToken;
  }

  return response;
}

async function issueSession(user, req, res, sessionOptions = {}) {
  const clientContext = resolveClientContext(req);
  const sessionId = TokenService.generateSessionId();
  const refreshToken = generateRefreshTokenForSession(
    user,
    sessionId,
    clientContext.audience
  );
  const refreshExpiresAt = TokenService.getExpirationDate(refreshToken);
  const isImpersonating = !!sessionOptions.impersonatedByUserId;
  const accessToken = generateAccessTokenForSession(
    user,
    sessionId,
    clientContext.audience,
    isImpersonating ? { imp: true } : {}
  );
  const now = new Date();

  const updatedUser = await userSchema.findByIdAndUpdate(
    user._id,
    {
      $set: {
        lastLogin: now,
        auth: {
          sessionId,
          refreshTokenHash: TokenService.hashToken(refreshToken),
          refreshExpiresAt,
          clientFamily: clientContext.clientFamily,
          platform: clientContext.platform,
          issuedAt: now,
          lastUsedAt: now,
          impersonatedByUserId: sessionOptions.impersonatedByUserId || null,
          impersonatedFromSessionId:
            sessionOptions.impersonatedFromSessionId || null,
        },
      },
      $unset: {
        refreshToken: 1,
        previousRefreshToken: 1,
        tokenRotationTimestamp: 1,
      },
    },
    { new: true }
  );

  if (!clientContext.isNativeClient) {
    TokenService.setRefreshTokenCookie(res, refreshToken);
  }

  console.info("[AUTH] auth_session_issued", {
    userId: user._id.toString(),
    sessionId,
    platform: clientContext.platform,
    clientFamily: clientContext.clientFamily,
    impersonatedByUserId: sessionOptions.impersonatedByUserId || null,
  });

  return buildAuthResponse({
    user: updatedUser,
    accessToken,
    refreshToken,
    clientContext,
    isImpersonating,
  });
}

function authTerminalResponse(res, status, code, message) {
  return res.status(status).send({
    message,
    code,
    requiresRelogin: true,
  });
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
        return res.status(400).send({
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
        await userModel.updateVerificationHash(user._id, hashTemp);

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
      const clientContext = resolveClientContext(req);

      if (!extracted.token) {
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          "REFRESH_INVALID",
          "No refresh token"
        );
      }

      const verification = TokenService.verifyRefresh(extracted.token, {
        audiences: [clientContext.audience],
      });
      const decoded = verification.payload;

      if (!decoded || decoded.type !== "refresh") {
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          verification.code || "REFRESH_INVALID",
          verification.code === "REFRESH_EXPIRED"
            ? "Refresh token expired"
            : "Invalid refresh token"
        );
      }

      if (decoded.aud !== clientContext.audience) {
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          "REFRESH_INVALID",
          "Invalid refresh token audience"
        );
      }

      const user = await userSchema.findById(decoded.sub);
      if (!user) {
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(res, 401, "REFRESH_INVALID", "User not found");
      }

      const currentAuth = user.auth || {};
      const currentTokenHash = TokenService.hashToken(extracted.token);
      if (
        !currentAuth.sessionId ||
        currentAuth.sessionId !== decoded.sid ||
        currentAuth.refreshTokenHash !== currentTokenHash ||
        currentAuth.clientFamily !== clientContext.clientFamily
      ) {
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          "SESSION_REPLACED",
          "Session replaced"
        );
      }

      if (
        currentAuth.refreshExpiresAt &&
        new Date(currentAuth.refreshExpiresAt) <= new Date()
      ) {
        await clearUserAuthIfCurrent(user._id, currentAuth.sessionId);
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          "REFRESH_EXPIRED",
          "Refresh session expired"
        );
      }

      if ((user.passwordVersion || 0) !== (decoded.pver || 0)) {
        await clearUserAuthIfCurrent(user._id, currentAuth.sessionId);
        clearRefreshArtifacts(req, res);
        return authTerminalResponse(
          res,
          401,
          "PASSWORD_CHANGED",
          "Session expired by password change"
        );
      }

      const isImpersonating = !!currentAuth.impersonatedByUserId;
      const accessToken = generateAccessTokenForSession(
        user,
        currentAuth.sessionId,
        clientContext.audience,
        isImpersonating ? { imp: true } : {}
      );

      const refreshedUser = await userSchema.findByIdAndUpdate(
        user._id,
        { $set: { "auth.lastUsedAt": new Date() } },
        { new: true }
      );

      return res.send(
        buildRefreshResponse(
          accessToken,
          await userDto.single(refreshedUser),
          isImpersonating
        )
      );
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

      if (accessPayload?.sid && accessPayload?.sub) {
        await clearUserAuthIfCurrent(accessPayload.sub, accessPayload.sid);
      } else {
        const extracted = TokenService.extractRefreshToken(req);
        if (extracted.token) {
          const refreshPayload = TokenService.verifyRefreshToken(extracted.token);
          if (refreshPayload?.sid && refreshPayload?.sub) {
            await clearUserAuthIfCurrent(refreshPayload.sub, refreshPayload.sid);
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
      is_impersonating: !!req.user?.auth?.impersonatedByUserId,
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

      const activatedUser = await userSchema.findByIdAndUpdate(
        user._id,
        { $unset: { hash: 1 } },
        { new: true }
      );

      return res.status(200).send(await issueSession(activatedUser, req, res));
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

      if (user.hash) {
        const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();
        await userModel.updateVerificationHash(user._id, hashTemp);

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

      if (user.hash) {
        const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();
        await userModel.updateVerificationHash(user._id, hashTemp);

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

      if (user && user.name && !user.hash) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }

      if (user && user.hash) {
        return res.status(403).send({
          error: "ACCOUNT_NOT_VERIFIED",
          message: "Cuenta no verificada. Verifica tu email antes de continuar.",
          email: user.email,
        });
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
      const currentAuth = req.user?.auth || {};
      if (
        !currentAuth.sessionId ||
        currentAuth.sessionId !== req.auth?.sessionId ||
        !currentAuth.impersonatedByUserId
      ) {
        return res.status(400).send({ message: "No active impersonation" });
      }

      const adminUser = await userSchema.findById(currentAuth.impersonatedByUserId);
      if (!adminUser || !(adminUser.roles || []).includes("admin")) {
        return authTerminalResponse(
          res,
          401,
          "SESSION_REPLACED",
          "Invalid impersonation revert"
        );
      }

      await clearUserAuthIfCurrent(req.user._id, currentAuth.sessionId);
      return res.status(200).send(await issueSession(adminUser, req, res));
    } catch (error) {
      console.error("Error en auth/impersonate/revert:", error);
      return res.status(500).send({
        message: "Error al volver a la sesion admin",
      });
    }
  },
};
