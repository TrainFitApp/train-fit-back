const jwt = require("jsonwebtoken");
const crypto = require("crypto");

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
  // Convertir secuencias \\n literales a saltos de línea reales
  const normalized = raw.replace(/\\n/g, "\n");
  if (normalized.includes("BEGIN")) {
    return normalized;
  }
  return decodeMaybeBase64(normalized);
}

const publicKey = loadKeyFromEnv("PUBLIC_KEY");
const privateKey = loadKeyFromEnv("PRIVATE_KEY");

function requireKey(key, name) {
  if (!key) throw new Error(`${name} not configured`);
  return key;
}

/**
 * Token Service - Centraliza generación y verificación de JWT
 */
class TokenService {
  /**
   * Genera un Access Token (JWT) con duración por defecto de 15 minutos
   * @param {Object} payload - Datos a incluir en el token (email, roles)
   * @param {string|number} [expiresIn="15m"] - Tiempo de expiración opcional
   * @returns {string} JWT firmado
   */
  static generateAccessToken(payload, expiresIn = "180d") {
    return jwt.sign(payload, requireKey(privateKey, "PRIVATE_KEY"), {
      algorithm: "RS256",
      expiresIn,
    });
  }

  /**
   * Genera un Refresh Token (JWT) con duración por defecto de 30 días
   * @param {Object} payload - Datos a incluir en el token (email, roles, tokenVersion)
   * @param {string|number} [expiresIn="30d"] - Tiempo de expiración opcional
   * @returns {string} JWT firmado
   */
  static generateRefreshToken(payload, expiresIn = "30d") {
    return jwt.sign(
      { ...payload, tokenVersion: Date.now() },
      requireKey(privateKey, "PRIVATE_KEY"),
      {
        algorithm: "RS256",
        expiresIn,
      },
    );
  }

  /**
   * Verifica un Access Token
   * @param {string} token - Token a verificar
   * @returns {Object|null} Payload decodificado o null si inválido
   */
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Verifica un Refresh Token
   * @param {string} token - Token a verificar
   * @returns {Object|null} Payload decodificado o null si inválido
   */
  static verifyRefreshToken(token) {
    try {
      return jwt.verify(token, requireKey(publicKey, "PUBLIC_KEY"), {
        algorithms: ["RS256"],
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Hash de un token usando SHA-256 para almacenamiento seguro en DB
   * @param {string} token - Token a hashear
   * @returns {string} Hash hexadecimal
   */
  static hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Configura cookie de refresh token con opciones seguras
   * @param {Object} res - Response object de Express
   * @param {string} refreshToken - Token a almacenar en cookie
   */
  static setRefreshTokenCookie(res, refreshToken) {
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true, // Localhost is treated as secure context naturally, so this is safe and required for 'none'
      sameSite: "none", // Obligatorio para peticiones cruzadas (ej: :8100 y :3000) debido a port-bound cookies
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días (sesión deslizante)
      path: "/api",
    });
  }

  /**
   * Limpia la cookie de refresh token
   * @param {Object} res - Response object de Express
   */
  static clearRefreshTokenCookie(res) {
    // Flags DEBEN ser idénticos a los de setRefreshTokenCookie
    // Si no coinciden, el browser no identifica la cookie a borrar
    res.cookie("refreshToken", "", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 0,
      path: "/api",
    });
  }
}

module.exports = TokenService;
