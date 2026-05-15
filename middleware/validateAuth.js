const userSchema = require("../components/users/schema");
const TokenService = require("../services/token.service");

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

      const user = await userSchema.findById(decoded.sub);
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
        await userSchema.findByIdAndUpdate(user._id, { $unset: { auth: 1 } });
        return res.status(401).send({
          message: "Refresh session expired",
          code: "REFRESH_EXPIRED",
          requiresRelogin: true,
        });
      }

      if ((user.passwordVersion || 0) !== (decoded.pver || 0)) {
        await userSchema.findByIdAndUpdate(user._id, { $unset: { auth: 1 } });
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
          .send({ message: "You don't have access to this data" });
      }

      req.auth = {
        userId: user._id.toString(),
        sessionId: currentAuth.sessionId,
        roles: userRoles,
        email: user.email,
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
