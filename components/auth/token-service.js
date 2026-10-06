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
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "tfRefreshToken";
const COOKIE_CLIENT_FAMILIES = new Set(["trainfit-front", "train-fit-management", "trainfit-trainers"]);
const DEFAULT_ALLOWED_AUDIENCES = (
  process.env.JWT_ALLOWED_AUDIENCES ||
  "trainfit-front,train-fit-management,trainfit-trainers"
)
  .split(",")
  .map((audience) => audience.trim())
  .filter(Boolean);

class TokenService {
  static get ACCESS_TOKEN_TTL_SECONDS() {
    return 15 * 60;
  }

  static get REFRESH_TOKEN_TTL_SECONDS() {
    return 30 * 24 * 60 * 60;
  }

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

  static signAccess(payload, options = {}) {
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

  static signRefresh(payload, options = {}) {
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
    return TokenService.verifyAccess(token, options).payload;
  }

  static verifyAccess(token, options = {}) {
    try {
      const payload = jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: options.audiences || TokenService.getAllowedAudiences(),
      });
      return { payload, code: null, error: null };
    } catch (error) {
      return {
        payload: null,
        code: error?.name === "TokenExpiredError" ? "ACCESS_EXPIRED" : "ACCESS_INVALID",
        error,
      };
    }
  }

  static verifyRefreshToken(token, options = {}) {
    return TokenService.verifyRefresh(token, options).payload;
  }

  static verifyRefresh(token, options = {}) {
    try {
      const payload = jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: options.audiences || TokenService.getAllowedAudiences(),
      });
      return { payload, code: null, error: null };
    } catch (error) {
      return {
        payload: null,
        code: error?.name === "TokenExpiredError" ? "REFRESH_EXPIRED" : "REFRESH_INVALID",
        error,
      };
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

  static getRefreshCookieName(clientFamily) {
    return COOKIE_CLIENT_FAMILIES.has(clientFamily)
      ? `${REFRESH_COOKIE_NAME}-${clientFamily}`
      : REFRESH_COOKIE_NAME;
  }

  static setRefreshTokenCookie(res, refreshToken, clientFamily) {
    const expiration = TokenService.getExpirationDate(refreshToken);
    const maxAge = expiration
      ? Math.max(0, expiration.getTime() - Date.now())
      : TokenService.REFRESH_TOKEN_TTL_SECONDS * 1000;
    res.cookie(
      TokenService.getRefreshCookieName(clientFamily),
      refreshToken,
      TokenService.getRefreshCookieOptions(maxAge)
    );
  }

  static clearRefreshTokenCookie(res, clientFamily) {
    res.cookie(
      TokenService.getRefreshCookieName(clientFamily),
      "",
      TokenService.getRefreshCookieOptions(0)
    );
  }

  static getCookieValues(req, cookieName) {
    const rawCookieHeader = req.headers?.cookie || "";
    const values = [];

    for (const cookiePair of rawCookieHeader.split(";")) {
      const separatorIndex = cookiePair.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }

      const name = cookiePair.slice(0, separatorIndex).trim();
      if (name !== cookieName) {
        continue;
      }

      const rawValue = cookiePair.slice(separatorIndex + 1).trim();
      try {
        values.push(decodeURIComponent(rawValue));
      } catch (_error) {
        values.push(rawValue);
      }
    }

    const parsedCookie = req.cookies?.[cookieName];
    if (parsedCookie && !values.includes(parsedCookie)) {
      values.push(String(parsedCookie));
    }

    return values.filter(Boolean);
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

    if (headerToken) {
      return { token: String(headerToken), source: "header" };
    }

    const clientFamily = String(req.headers?.["x-client-family"] || "trainfit-front").trim();
    const scopedName = TokenService.getRefreshCookieName(clientFamily);
    const cookieValues = TokenService.getCookieValues(req, scopedName);
    if (cookieValues.length > 0) {
      return { token: cookieValues[0], source: "cookie" };
    }
    return { token: null, source: null };
  }
}

module.exports = TokenService;
