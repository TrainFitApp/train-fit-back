const sessionService = require("./session-service");
const TokenService = require("./token-service");
const userService = require("../users/user-service");
const mail = require("../util/mail");
const { normalizeEmail } = require("../util/normalize-email");
const { isValidVerificationCodeFormat } = require("../util/verification-code");
const { clientContextOf } = require("./client-context");
const { badRequest } = require("../util/http-error");

// En web el refresh viaja en una cookie httpOnly por app; en nativo, en el
// cuerpo (session-service.js#issue).
function sendSession(req, res, { body, refreshToken }, status = 200) {
  const clientContext = clientContextOf(req);
  if (!clientContext.isNativeClient) {
    TokenService.setRefreshTokenCookie(res, refreshToken, clientContext.clientFamily);
  }
  res.status(status).send(body);
}

// Borra la cookie del refresh de esta app (solo web). La usa también
// auth-routes.js cuando la sesión ha terminado.
function clearRefreshCookie(req, res) {
  const clientContext = clientContextOf(req);
  if (!clientContext.isNativeClient) TokenService.clearRefreshTokenCookie(res, clientContext.clientFamily);
}

module.exports = {
  clearRefreshCookie,

  async login(req, res) {
    sendSession(req, res, await sessionService.login(req.body?.email, req.body?.password, clientContextOf(req)));
  },

  async refresh(req, res) {
    const { token } = TokenService.extractRefreshToken(req);
    sendSession(req, res, await sessionService.refresh(token, clientContextOf(req)));
  },

  async logout(req, res) {
    await sessionService.logout(TokenService.extractBearerToken(req), TokenService.extractRefreshToken(req).token);
    clearRefreshCookie(req, res);
    res.send({ ok: true });
  },

  async me(req, res) {
    // Lectura completa: `req.user` llega sin las listas que validateAuth no
    // carga en cada petición (favoritos…), y el perfil sí las devuelve.
    const user = await userService.getUserById(req.user.id);
    res.send({
      user: await userService.view(user),
      is_impersonating: !!req.user?.auth?.impersonatedByUserId,
    });
  },

  async activate(req, res) {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    if (!email || !code) throw badRequest("Faltan datos requeridos");
    // La app ya limita el campo a dígitos; aquí se revalida el formato antes
    // de tocar la base.
    if (!isValidVerificationCodeFormat(code)) throw badRequest("Código inválido", "INVALID_CODE");
    const user = await userService.verifyActivationCode(email, code);
    sendSession(req, res, await sessionService.issueFor(user, clientContextOf(req)));
  },

  async resendActivationCode(req, res) {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw badRequest("Falta el email");
    await userService.resendVerificationCode(email);
    res.send({ message: "Se ha enviado un nuevo código de verificación." });
  },

  async verifyGoogle(req, res) {
    sendSession(req, res, await sessionService.verifyGoogle(req.body?.tokenGoogle, clientContextOf(req)));
  },

  async verifyApple(req, res) {
    sendSession(req, res, await sessionService.verifyApple(req.body?.tokenApple, req.body?.email, clientContextOf(req)));
  },

  async registerSocial(req, res) {
    sendSession(req, res, await sessionService.registerSocial(req.body, clientContextOf(req)), 201);
  },

  async completeSocial(req, res) {
    const user = await userService.completeSocialProfile(req.user._id, req.body || {}, req.auth.timeZone);
    mail.notifyUserRegistered(user, {
      source: "auth.completeSocial",
      provider: user.provider,
      ip: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
    res.send({ user: await userService.view(user) });
  },

  async impersonate(req, res) {
    sendSession(req, res, await sessionService.impersonate(req.user, req.auth.sessionId, req.body?.userId, clientContextOf(req)));
  },

  async revertImpersonation(req, res) {
    sendSession(req, res, await sessionService.revertImpersonation(req.user, req.auth?.sessionId, clientContextOf(req)));
  },
};
