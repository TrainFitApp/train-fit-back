const crypto = require("crypto");
const jwt = require("jsonwebtoken");

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

function requireKey(key, name) {
  if (!key) throw new Error(`${name} not configured`);
  return key;
}

const publicKey = loadKeyFromEnv("PUBLIC_KEY");
const privateKey = loadKeyFromEnv("PRIVATE_KEY");
const ISSUER = process.env.JWT_ISSUER || "trainfit-auth";
const REFRESH_COOKIE_NAME = "refreshToken";
const DEFAULT_ALLOWED_AUDIENCES = (
  process.env.JWT_ALLOWED_AUDIENCES ||
  "trainfit-front,train-fit-management"
)
  .split(",")
  .map((audience) => audience.trim())
  .filter(Boolean);

class TokenService {
  static getRefreshCookieOptions(maxAge = 30 * 24 * 60 * 60 * 1000) {
    const envSecure = process.env.COOKIE_SECURE;
    const secure =
      envSecure !== undefined
        ? String(envSecure).toLowerCase() === "true"
        : process.env.NODE_ENV === "production";

    let sameSite = process.env.COOKIE_SAMESITE || (secure ? "none" : "lax");
    sameSite = String(sameSite).toLowerCase();

    if (!secure && sameSite === "none") {
      sameSite = "lax";
    }

    return {
      httpOnly: true,
      secure,
      sameSite,
      maxAge,
      path: "/api/auth",
    };
  }

  static generateSessionId() {
    return crypto.randomUUID();
  }

  static hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static getAllowedAudiences() {
    return DEFAULT_ALLOWED_AUDIENCES;
  }

  static generateAccessToken(payload, options = {}) {
    const { audience = "trainfit-front", expiresIn = "15m" } = options;
    return jwt.sign(
      {
        ...payload,
        type: "access",
      },
      requireKey(privateKey, "PRIVATE_KEY"),
      {
        algorithm: "RS256",
        expiresIn,
        issuer: ISSUER,
        audience,
      }
    );
  }

  static generateRefreshToken(payload, options = {}) {
    const { audience = "trainfit-front", expiresIn = "30d" } = options;
    return jwt.sign(
      {
        ...payload,
        type: "refresh",
        jti: crypto.randomUUID(),
      },
      requireKey(privateKey, "PRIVATE_KEY"),
      {
        algorithm: "RS256",
        expiresIn,
        issuer: ISSUER,
        audience,
      }
    );
  }

  static verifyAccessToken(token, options = {}) {
    try {
      return jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: options.audiences || TokenService.getAllowedAudiences(),
      });
    } catch (error) {
      return null;
    }
  }

  static verifyRefreshToken(token, options = {}) {
    try {
      return jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: options.audiences || TokenService.getAllowedAudiences(),
      });
    } catch (error) {
      return null;
    }
  }

  static decode(token) {
    try {
      return jwt.decode(token);
    } catch (_error) {
      return null;
    }
  }

  static getExpirationDate(token) {
    const payload = TokenService.decode(token);
    if (!payload?.exp) {
      return null;
    }
    return new Date(payload.exp * 1000);
  }

  static setRefreshTokenCookie(res, refreshToken) {
    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshToken,
      TokenService.getRefreshCookieOptions()
    );
  }

  static clearRefreshTokenCookie(res) {
    res.cookie(
      REFRESH_COOKIE_NAME,
      "",
      TokenService.getRefreshCookieOptions(0)
    );
  }

  static extractBearerToken(req) {
    const authHeader = req.headers?.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.slice("Bearer ".length).trim() || null;
  }

  static extractRefreshToken(req) {
    const headerToken = req.headers?.["x-refresh-token"];
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (headerToken && cookieToken && headerToken !== cookieToken) {
      return {
        token: null,
        source: "conflict",
      };
    }

    if (headerToken) {
      return { token: String(headerToken), source: "header" };
    }

    if (cookieToken) {
      return { token: String(cookieToken), source: "cookie" };
    }

    return { token: null, source: null };
  }
}

module.exports = TokenService;
