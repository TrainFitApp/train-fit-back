// Almacenamiento en disco para desarrollo. Imita el contrato de R2 y Bunny
// (subida directa con URL firmada, lectura con URL que caduca) para poder
// probar el flujo completo sin cuentas externas. No transcodifica: el vídeo
// se reproduce tal cual se subió.
//
// Las URL llevan un token HMAC con la operación, la clave, el tamaño máximo y
// la caducidad. Se sirven desde media-routes.js (/api/media/local/:token).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../.media-local");
// Sin MEDIA_LOCAL_SECRET se deriva de la clave privada de los JWT, para que
// las URL sigan valiendo tras los reinicios de `node --watch`. Si tampoco
// hay clave, uno aleatorio por arranque.
const SECRET =
  process.env.MEDIA_LOCAL_SECRET ||
  (process.env.PRIVATE_KEY
    ? crypto.createHash("sha256").update(`media-local:${process.env.PRIVATE_KEY}`).digest("hex")
    : crypto.randomBytes(32).toString("hex"));

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmac(payload) {
  return base64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
}

function sign(claims) {
  const payload = base64url(JSON.stringify(claims));
  return `${payload}.${hmac(payload)}`;
}

/** Claims del token o null si no es válido o ha caducado. */
function verify(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = hmac(payload);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return null;
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims?.key || !claims.exp || claims.exp < Date.now()) return null;
  return claims;
}

function filePathOf(key) {
  const resolved = path.resolve(ROOT, key);
  // Nada fuera de la carpeta, aunque la clave viniera manipulada.
  if (!resolved.startsWith(ROOT + path.sep)) throw new Error("Clave de media fuera de la carpeta local");
  return resolved;
}

function urlFor(baseUrl, token) {
  return `${baseUrl}/api/media/local/${token}`;
}

module.exports = {
  name: "local",
  ROOT,
  verify,
  filePathOf,

  uploadTarget(key, { mime, bytes }, { baseUrl, ttlSec = 2 * 3600 } = {}) {
    const token = sign({ op: "put", key, mime, max: bytes, exp: Date.now() + ttlSec * 1000 });
    return { method: "PUT", url: urlFor(baseUrl, token), headers: { "Content-Type": mime } };
  },

  readUrl(key, { baseUrl, ttlSec = 3600 } = {}) {
    const token = sign({ op: "get", key, exp: Date.now() + ttlSec * 1000 });
    return urlFor(baseUrl, token);
  },

  async head(key) {
    try {
      const stat = await fs.promises.stat(filePathOf(key));
      return { bytes: stat.size };
    } catch {
      return null;
    }
  },

  async deleteKeys(keys) {
    for (const key of keys.filter(Boolean)) {
      await fs.promises.rm(filePathOf(key), { force: true });
    }
  },
};
