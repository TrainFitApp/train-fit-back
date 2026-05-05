const bcrypt = require("../util/bcrypt");
const userDto = require("../users/dto");
const userModel = require("../users/model");
const userSchema = require("../users/schema");
const TokenService = require("../../services/token.service");
const AuthSessionService = require("../../services/auth-session.service");
const mail = require("../util/mail");

const REFRESH_GRACE_MS = Number(process.env.REFRESH_TOKEN_GRACE_MS || 60000);
const AUTH_RESPONSE_EXPIRES_IN_SECONDS = 15 * 60;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : null;
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

async function issueSession(user, req, res) {
  const clientContext = resolveClientContext(req);
  const sessionId = TokenService.generateSessionId();
  const userRoles = user.roles || ["user"];
  const passwordVersion = user.passwordVersion || 0;

  await AuthSessionService.revokeAllUserSessions(
    user._id,
    "replaced_by_new_login",
    sessionId
  );

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
    ip: req.ip,
    userAgent: req.headers?.["user-agent"] || null,
    deviceLabel: req.headers?.["x-device-label"] || null,
  });

  if (!clientContext.isNativeClient) {
    TokenService.setRefreshTokenCookie(res, refreshToken);
  }

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
          .send({ message: "Email y contraseña requeridos" });
      }

      const user = await userModel.getUserByEmail(email);
      if (!user) {
        return res.status(404).send({ message: "Este usuario no existe" });
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

      const isMatch = bcrypt.comparePasswords(password, user.password);
      if (!isMatch) {
        return res.status(401).send({ message: "Contraseña incorrecta" });
      }

      return res.status(200).send(await issueSession(user, req, res));
    } catch (error) {
      console.error("Error in auth/login:", error);
      return res.status(500).send({ message: "Error al iniciar sesión" });
    }
  },

  async refresh(req, res) {
    try {
      const extracted = TokenService.extractRefreshToken(req);

      if (extracted.source === "conflict") {
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Conflicting refresh token sources",
          requiresRelogin: true,
        });
      }

      if (!extracted.token) {
        clearRefreshArtifacts(req, res);
        return res
          .status(401)
          .send({ message: "No refresh token", requiresRelogin: true });
      }

      const decoded = TokenService.verifyRefreshToken(extracted.token);
      if (!decoded || decoded.type !== "refresh") {
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Invalid refresh token",
          requiresRelogin: true,
        });
      }

      const session = await AuthSessionService.getSessionById(decoded.sid);
      if (!session || session.revokedAt) {
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Session revoked",
          requiresRelogin: true,
        });
      }

      const user = await userSchema.findById(decoded.sub);
      if (!user) {
        await AuthSessionService.revokeSession(session.sessionId, "user_missing");
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
        clearRefreshArtifacts(req, res);
        return res.status(401).send({
          message: "Session expired by password change",
          requiresRelogin: true,
        });
      }

      if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
        await AuthSessionService.revokeSession(session.sessionId, "refresh_expired");
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
      const clientContext = resolveClientContext(req);

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

          return res.send({
            access_token: accessToken,
            expires_in: AUTH_RESPONSE_EXPIRES_IN_SECONDS,
            token_type: "Bearer",
          });
        }

        await AuthSessionService.revokeSession(
          session.sessionId,
          "refresh_token_reuse_detected"
        );
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

      await AuthSessionService.updateRotatedRefreshToken({
        sessionId: session.sessionId,
        currentRefreshTokenHash: currentTokenHash,
        nextRefreshTokenHash: TokenService.hashToken(nextRefreshToken),
        expiresAt: TokenService.getExpirationDate(nextRefreshToken),
        passwordVersion,
      });

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
      } else {
        const extracted = TokenService.extractRefreshToken(req);
        if (extracted.token) {
          const refreshPayload = TokenService.verifyRefreshToken(extracted.token);
          if (refreshPayload?.sid) {
            await AuthSessionService.revokeSession(refreshPayload.sid, "logout");
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
          req.body?.email
        );
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
};
