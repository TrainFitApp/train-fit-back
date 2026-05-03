const userSchema = require("../components/users/schema");
const AuthSessionService = require("../services/auth-session.service");
const TokenService = require("../services/token.service");

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

      const decoded = TokenService.verifyAccessToken(token);
      if (!decoded || decoded.type !== "access") {
        return res.status(401).send({ message: "Invalid or expired token" });
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
        sessionId: decoded.sid,
        roles: userRoles,
        email: user.email,
      };
      req.userData = {
        sub: user._id.toString(),
        sid: decoded.sid,
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
