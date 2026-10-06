const TokenService = require("./token-service");
const userService = require("../users/user-service");
const bcrypt = require("../util/bcrypt");
const { normalizeEmail } = require("../util/normalize-email");
const { httpError, badRequest, forbidden, notFound, conflict } = require("../util/http-error");
const { wrongAppMessage } = require("./client-context");

// Sesiones: una por cuenta (User.auth), con access token corto y refresh de
// 30 días (cookie httpOnly en web, cuerpo de la respuesta en nativo). Cada
// función devuelve `{ body, refreshToken }`; la cookie la pone el controller.

const unauthorized = (message, code, details) => httpError(401, message, code, details);

// La sesión ya no vale: la app tiene que volver a pedir login.
// auth-routes.js borra la cookie del refresh al responder.
const sessionEnded = (code, message) => unauthorized(message, code, { requiresRelogin: true });

function signAccess(user, sessionId, audience, extra = {}) {
  return TokenService.signAccess(
    {
      sub: user._id.toString(),
      sid: sessionId,
      roles: user.roles || ["user"],
      pver: user.passwordVersion || 0,
      ...extra,
    },
    { audience },
  );
}

function signRefresh(user, sessionId, audience) {
  return TokenService.signRefresh(
    { sub: user._id.toString(), sid: sessionId, pver: user.passwordVersion || 0 },
    { audience },
  );
}

async function sessionBody(user, accessToken, isImpersonating) {
  return {
    user: await userService.view(user),
    access_token: accessToken,
    expires_in: TokenService.ACCESS_TOKEN_TTL_SECONDS,
    token_type: "Bearer",
    is_impersonating: isImpersonating,
  };
}

// Sesión nueva (sustituye a la que tuviera la cuenta).
async function issue(user, clientContext, { impersonatedByUserId = null, impersonatedFromSessionId = null } = {}) {
  const sessionId = TokenService.generateSessionId();
  const refreshToken = signRefresh(user, sessionId, clientContext.audience);
  const isImpersonating = !!impersonatedByUserId;
  const accessToken = signAccess(user, sessionId, clientContext.audience, isImpersonating ? { imp: true } : {});
  const now = new Date();

  const updatedUser = await userService.startSession(
    user._id,
    {
      sessionId,
      refreshTokenHash: TokenService.hashToken(refreshToken),
      refreshExpiresAt: TokenService.getExpirationDate(refreshToken),
      clientFamily: clientContext.clientFamily,
      platform: clientContext.platform,
      issuedAt: now,
      lastUsedAt: now,
      impersonatedByUserId,
      impersonatedFromSessionId,
    },
    now,
  );

  console.info("[AUTH] auth_session_issued", {
    userId: user._id.toString(),
    sessionId,
    platform: clientContext.platform,
    clientFamily: clientContext.clientFamily,
    impersonatedByUserId,
  });

  const body = await sessionBody(updatedUser, accessToken, isImpersonating);
  if (clientContext.isNativeClient) body.refresh_token = refreshToken;
  return { body, refreshToken };
}

function passwordMatches(password, encryptedPassword) {
  if (!password || !encryptedPassword) return false;
  try {
    return bcrypt.comparePasswords(password, encryptedPassword);
  } catch (error) {
    console.warn("[AUTH] auth_login_password_compare_failed", { reason: error?.message || "password_compare_failed" });
    return false;
  }
}

function assertRightApp(user, clientContext) {
  const message = wrongAppMessage(user, clientContext);
  if (message) throw forbidden(message, "WRONG_APP_FOR_ROLE");
}

// Cuenta sin verificar: código nuevo por correo y fuera.
async function assertVerified(user) {
  if (!user.hash) return;
  await userService.sendFreshVerificationCode(user);
  throw forbidden("Cuenta no verificada. Se ha enviado un nuevo código.", "ACCOUNT_NOT_VERIFIED", { email: user.email });
}

async function googleIdentity(token) {
  if (!token) throw badRequest("Token requerido");
  const payload = await userService.validateGoogleToken(token).catch(() => null);
  const email = normalizeEmail(payload?.email);
  if (!email || !payload.email_verified) throw unauthorized("Token de Google inválido o expirado");
  return { provider: "google", email, appleId: null };
}

async function appleIdentity(token, fallbackEmail = null) {
  if (!token) throw badRequest("Token requerido");
  const payload = await userService.validateAppleToken(token).catch(() => null);
  if (!payload?.sub) throw unauthorized("Token de Apple inválido o expirado");
  return { provider: "apple", email: normalizeEmail(payload.email) || normalizeEmail(fallbackEmail), appleId: payload.sub };
}

module.exports = {
  // Sesión para una cuenta ya comprobada (activación con código).
  issueFor: (user, clientContext) => issue(user, clientContext),

  async login(emailRaw, password, clientContext) {
    const email = normalizeEmail(emailRaw);
    if (!email || !password) throw badRequest("Email y contraseña requeridos", "INVALID_LOGIN_REQUEST");
    const user = await userService.getUserByEmail(email);
    if (!user || !passwordMatches(password, user.password)) {
      throw unauthorized("Correo o contraseña incorrectos", "INVALID_CREDENTIALS");
    }
    assertRightApp(user, clientContext);
    await assertVerified(user);
    return issue(user, clientContext);
  },

  // Nuevo access token con el mismo refresh (no se rota ni se amplía).
  async refresh(refreshToken, clientContext) {
    if (!refreshToken) throw sessionEnded("REFRESH_INVALID", "No refresh token");

    const verification = TokenService.verifyRefresh(refreshToken, { audiences: [clientContext.audience] });
    const decoded = verification.payload;
    if (!decoded || decoded.type !== "refresh") {
      throw sessionEnded(
        verification.code || "REFRESH_INVALID",
        verification.code === "REFRESH_EXPIRED" ? "Refresh token expired" : "Invalid refresh token",
      );
    }
    if (decoded.aud !== clientContext.audience) {
      throw sessionEnded("REFRESH_INVALID", "Invalid refresh token audience");
    }

    const user = await userService.getUserById(decoded.sub);
    if (!user) throw sessionEnded("REFRESH_INVALID", "User not found");

    const current = user.auth || {};
    if (
      !current.sessionId ||
      current.sessionId !== decoded.sid ||
      current.refreshTokenHash !== TokenService.hashToken(refreshToken) ||
      current.clientFamily !== clientContext.clientFamily
    ) {
      throw sessionEnded("SESSION_REPLACED", "Session replaced");
    }
    if (current.refreshExpiresAt && new Date(current.refreshExpiresAt) <= new Date()) {
      await userService.clearSessionIfCurrent(user._id, current.sessionId);
      throw sessionEnded("REFRESH_EXPIRED", "Refresh session expired");
    }
    if ((user.passwordVersion || 0) !== (decoded.pver || 0)) {
      await userService.clearSessionIfCurrent(user._id, current.sessionId);
      throw sessionEnded("PASSWORD_CHANGED", "Session expired by password change");
    }

    const isImpersonating = !!current.impersonatedByUserId;
    const accessToken = signAccess(user, current.sessionId, clientContext.audience, isImpersonating ? { imp: true } : {});
    const refreshedUser = await userService.touchSession(user._id);
    return { body: await sessionBody(refreshedUser, accessToken, isImpersonating), refreshToken };
  },

  // Cierra la sesión del token que llegue (access o, si no, refresh). Mejor
  // esfuerzo: salir de la app nunca falla.
  async logout(accessToken, refreshToken) {
    const payload =
      (accessToken && TokenService.verifyAccessToken(accessToken)) ||
      (refreshToken && TokenService.verifyRefreshToken(refreshToken)) ||
      null;
    if (!payload?.sid || !payload?.sub) return;
    await userService.clearSessionIfCurrent(payload.sub, payload.sid).catch((error) => {
      console.error("[AUTH] auth_logout_failed", { message: error?.message });
    });
  },

  async verifyGoogle(token, clientContext) {
    const identity = await googleIdentity(token);
    const user = await userService.getUserByEmail(identity.email);
    if (!user) {
      throw notFound("Usuario no encontrado", "REGISTRATION_REQUIRED", { provider: "google", email: identity.email });
    }
    assertRightApp(user, clientContext);
    await assertVerified(user);
    return issue(user, clientContext);
  },

  async verifyApple(token, fallbackEmail, clientContext) {
    const identity = await appleIdentity(token, fallbackEmail);
    let user = await userService.getUserByAppleId(identity.appleId);
    if (!user && identity.email) user = await userService.getUserByEmail(identity.email);
    if (!user) {
      throw notFound("Usuario no encontrado", "REGISTRATION_REQUIRED", {
        provider: "apple",
        email: identity.email,
        appleId: identity.appleId,
      });
    }
    assertRightApp(user, clientContext);
    if (user.appleId && user.appleId !== identity.appleId) throw unauthorized("Apple ID no corresponde al usuario");
    if (!user.appleId) user = await userService.linkAppleId(user._id, identity.appleId);
    await assertVerified(user);
    return issue(user, clientContext);
  },

  // Alta con Google o Apple: la cuenta nace sin perfil (lo completa
  // PUT /auth/social/complete) y con sesión.
  async registerSocial(body, clientContext) {
    const provider = String(body?.provider || "").trim().toLowerCase();
    if (!["google", "apple"].includes(provider)) throw badRequest("Proveedor inválido");

    const identity =
      provider === "google"
        ? await googleIdentity(body?.tokenGoogle)
        : await appleIdentity(body?.tokenApple, body?.email || body?.user?.email);
    if (!identity.email) throw badRequest("Email requerido para completar el registro social");

    let user = identity.appleId ? await userService.getUserByAppleId(identity.appleId) : null;
    if (!user) user = await userService.getUserByEmail(identity.email);

    if (user?.name && !user.hash) throw conflict("Este usuario ya está registrado");
    if (user?.hash) {
      throw forbidden("Cuenta no verificada. Verifica tu email antes de continuar.", "ACCOUNT_NOT_VERIFIED", { email: user.email });
    }
    if (provider === "apple" && user?.appleId && user.appleId !== identity.appleId) {
      throw conflict("Este email ya esta vinculado a otra cuenta de Apple");
    }

    if (!user) {
      user = await userService.createSocialUser({ email: identity.email, appleId: identity.appleId, provider });
    } else if (identity.appleId && !user.appleId) {
      user = await userService.linkAppleId(user._id, identity.appleId);
    }
    return issue(user, clientContext);
  },

  // El admin entra como otra cuenta; la sesión recuerda la suya para volver.
  async impersonate(admin, adminSessionId, targetUserId, clientContext) {
    if (!targetUserId) throw badRequest("userId requerido");
    const target = await userService.getUserById(targetUserId);
    if (!target) throw notFound("Usuario no encontrado");
    return issue(target, clientContext, { impersonatedByUserId: admin._id, impersonatedFromSessionId: adminSessionId });
  },

  async revertImpersonation(user, sessionId, clientContext) {
    const current = user?.auth || {};
    if (!current.sessionId || current.sessionId !== sessionId || !current.impersonatedByUserId) {
      throw badRequest("No active impersonation");
    }
    const admin = await userService.getUserById(current.impersonatedByUserId);
    if (!admin || !(admin.roles || []).includes("admin")) {
      throw sessionEnded("SESSION_REPLACED", "Invalid impersonation revert");
    }
    await userService.clearSessionIfCurrent(user._id, current.sessionId);
    return issue(admin, clientContext);
  },
};
