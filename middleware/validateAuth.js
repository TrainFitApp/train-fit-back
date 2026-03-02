const jwt = require("jsonwebtoken");
const axios = require("axios");
const userSchema = require("../components/users/schema");

// Cargar claves desde variables de entorno (PEM directo o Base64)
function decodeMaybeBase64(value) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.includes("BEGIN") ? decoded : value;
  } catch (_) {
    return value;
  }
}

function loadKeyFromEnv(envVarName) {
  const raw = process.env[envVarName];
  if (!raw) return null;
  const normalized = raw.replace(/\\n/g, "\n");
  return normalized.includes("BEGIN")
    ? normalized
    : decodeMaybeBase64(normalized);
}

const publicKey = loadKeyFromEnv("PUBLIC_KEY");

function requireKey(key, name) {
  if (!key) throw new Error(`${name} not configured`);
  return key;
}

const CLIENT_ID =
  "775987417074-s1e767h7tps05ectmrb85uqh7hhp9p8n.apps.googleusercontent.com";

const basicAuth = async (req, res, next) => {
  // If 'Authorization' header not present
  if (!req.headers.authorization) {
    const err = new Error("Not Authenticated!");
    // Set status code to '401 Unauthorized' and 'WWW-Authenticate' header to 'Basic'
    res.status(401).set("WWW-Authenticate", "Basic");
    next(err);
  }
  // If 'Authorization' header present
  else {
    // Decode the 'Authorization' header Base64 value
    const credentials = Buffer.from(
      req.headers.authorization.split(" ")[1],
      "base64",
    )
      // <Buffer 75 73 65 72 6e 61 6d 65 3a 70 61 73 73 77 6f 72 64>
      .toString()
      // username:password
      .split(":");
    // ['username', 'password']

    const email = credentials[0];
    const password = credentials[1];

    req.body = { email, password };
    // Continue the execution
    next();
  }
};

const auth = (permissions) => {
  return async (req, res, next) => {
    try {
      const token = req.headers["authorization"]
        ? req.headers["authorization"].replace("Bearer ", "")
        : undefined;

      if (!token) {
        // No enviar requiresRelogin aquí: el interceptor del frontend debe intentar
        // el refresh con la cookie antes de desloguear. requiresRelogin solo se usa
        // cuando el refresh token en sí es inválido o robado.
        return res.status(401).send({ message: "No token provided" });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
          algorithms: ["RS256"],
        });
      } catch (error) {
        if (error.name === "TokenExpiredError") {
          return res.status(401).send({ message: "Token expired" });
        }
        return res.status(401).send({ message: "Invalid token" });
      }

      req.userData = decoded;

      // Buscar usuario en BD para tener el ID disponible en controladores
      const user = await userSchema.findOne({ email: decoded.email });
      if (user) {
        req.user = user;
        req.user.id = user._id.toString(); // Compatibilidad con controladores que usan .id
      } else {
        // Fallback si no se encuentra (aunque debería si el token es válido)
        req.user = decoded;
      }

      // Verificar si el usuario tiene los permisos necesarios
      const userRoles = req.userData.roles || [];
      const hasPermission = userRoles.some((role) =>
        permissions.includes(role),
      );

      if (!hasPermission) {
        return res
          .status(403)
          .send({ message: "You don't have access to this data" });
      }

      // Si todo está bien, continuar con la solicitud
      next();
    } catch (e) {
      console.error("Error en el middleware de autenticación:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
};

module.exports = { auth, basicAuth };
