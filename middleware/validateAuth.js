const userDao = require("../components/users/user-dao");
const TokenService = require("../components/auth/token-service");
const { normalizeTimeZone, timeZoneOf } = require("../components/util/date-util");

// La app manda su zona horaria en cada petición. Se guarda en el usuario solo
// cuando cambia (viajes, primera vez): de ahí la leen los cálculos que hace
// otro por él, como la ficha que ve su entrenador.
async function resolveTimeZone(req, user) {
  const fromHeader = normalizeTimeZone(String(req.headers?.["x-timezone"] || "").trim());
  if (fromHeader && fromHeader !== user.timezone) {
    await userDao.setTimeZone(user._id, fromHeader);
    user.timezone = fromHeader;
  }
  return timeZoneOf(user);
}

// Esta lectura se hace en CADA petición autenticada y el resultado viaja como
// `req.user`. Se excluye lo que puede crecer y ninguna petición necesita de
// aquí: listas de favoritos, preferencias de nutrición, ajustes del
// entrenador y recientes ocultos (cada servicio que los usa los lee aparte).
// Exclusión y no lista blanca: los servicios que reciben `req.user` leen
// premium, roles, consentimientos, zona horaria… y una lista blanca rompería
// el primero que se olvide.
const REQUEST_USER_EXCLUDED_FIELDS =
  "-favorites -nutritionPreferences -trainerSettings -hiddenRecentFoods -nutritionalGoals";

function resolveClientFamily(req) {
  return String(req.headers?.["x-client-family"] || "").trim() || "trainfit-front";
}

const basicAuth = async (req, res, next) => {
  if (!req.headers.authorization) {
    const err = new Error("Not Authenticated!");
    res.status(401).set("WWW-Authenticate", "Basic");
    next(err);
    return;
  }

  const credentials = Buffer.from(
    req.headers.authorization.split(" ")[1],
    "base64"
  )
    .toString()
    .split(":");

  req.body = {
    ...req.body,
    email: credentials[0],
    password: credentials[1],
  };

  next();
};

const auth = (permissions) => {
  return async (req, res, next) => {
    try {
      const token = TokenService.extractBearerToken(req);

      if (!token) {
        return res.status(401).send({ message: "No token provided" });
      }

      const clientFamily = resolveClientFamily(req);
      const verification = TokenService.verifyAccess(token, {
        audiences: [clientFamily],
      });
      const decoded = verification.payload;
      if (!decoded || decoded.type !== "access") {
        return res.status(401).send({
          message:
            verification.code === "ACCESS_EXPIRED"
              ? "Access token expired"
              : "Invalid access token",
          code: verification.code || "ACCESS_INVALID",
        });
      }

      if (decoded.aud !== clientFamily) {
        return res.status(401).send({
          message: "Invalid token audience",
          requiresRelogin: true,
        });
      }

      if (!decoded.sid || !decoded.sub) {
        return res.status(401).send({
          message: "Invalid session token",
          requiresRelogin: true,
        });
      }

      const user = await userDao.findForRequest(decoded.sub, REQUEST_USER_EXCLUDED_FIELDS);
      if (!user) {
        return res.status(401).send({
          message: "User not found",
          code: "USER_NOT_FOUND",
          requiresRelogin: true,
        });
      }

      const currentAuth = user.auth || {};
      if (!currentAuth.sessionId || currentAuth.sessionId !== decoded.sid) {
        return res.status(401).send({
          message: "Session replaced",
          code: "SESSION_REPLACED",
          requiresRelogin: true,
        });
      }

      if (currentAuth.clientFamily && currentAuth.clientFamily !== clientFamily) {
        return res.status(401).send({
          message: "Invalid session audience",
          code: "SESSION_REPLACED",
          requiresRelogin: true,
        });
      }

      if (
        currentAuth.refreshExpiresAt &&
        new Date(currentAuth.refreshExpiresAt) <= new Date()
      ) {
        await userDao.clearSession(user._id);
        return res.status(401).send({
          message: "Refresh session expired",
          code: "REFRESH_EXPIRED",
          requiresRelogin: true,
        });
      }

      if ((user.passwordVersion || 0) !== (decoded.pver || 0)) {
        await userDao.clearSession(user._id);
        return res.status(401).send({
          message: "Session expired by password change",
          code: "PASSWORD_CHANGED",
          requiresRelogin: true,
        });
      }

      const userRoles = user.roles || [];
      const hasPermission = userRoles.some((role) => permissions.includes(role));
      if (!hasPermission) {
        return res
          .status(403)
          .send({ message: "Tu cuenta no tiene acceso a esto", code: "ROLE_FORBIDDEN" });
      }

      req.auth = {
        userId: user._id.toString(),
        sessionId: currentAuth.sessionId,
        roles: userRoles,
        email: user.email,
        timeZone: await resolveTimeZone(req, user),
      };
      req.userData = {
        sub: user._id.toString(),
        sid: currentAuth.sessionId,
        email: user.email,
        roles: userRoles,
        provider: user.provider || null,
      };
      req.user = user;
      req.user.id = user._id.toString();

      next();
    } catch (e) {
      console.error("Error en el middleware de autenticación:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
};

module.exports = { auth, basicAuth };
