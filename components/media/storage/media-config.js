// Qué almacenamiento se usa, según el entorno. Nunca imprime valores.
//
//   Fotos y miniaturas: Cloudflare R2 si están las R2_*, si no el disco local
//   (solo en desarrollo o con MEDIA_LOCAL=1).
//   Vídeos: Bunny Stream si están las BUNNY_<CLIENT|TRAINER>_*, si no el disco
//   local con las mismas condiciones.
//
// En producción sin configurar, media queda desactivado (503) en vez de
// escribir fotos de clientes en el disco del servidor.

function r2Config() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  // Bucket con jurisdicción UE: su endpoint lleva ".eu".
  const jurisdiction = String(process.env.R2_JURISDICTION || "eu").toLowerCase();
  const host = jurisdiction === "eu" ? `${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com` : `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return {
    endpoint: `https://${host}`,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

// Dos librerías de Bunny: `client` (revisiones y progreso, 360p/720p sin
// original) y `trainer` (biblioteca, hasta 1080p). Cada una con su clave.
// Sin BUNNY_<CLIENT|TRAINER>_LIBRARY_ID se usan las genéricas BUNNY_*: una
// sola librería para las dos (lo normal en local). Se toma el bloque entero de
// un sitio u otro para no mezclar la clave de una librería con el ID de otra.
function bunnyConfig(library) {
  const specific = library === "trainer" ? "BUNNY_TRAINER_" : "BUNNY_CLIENT_";
  const prefix = process.env[`${specific}LIBRARY_ID`] ? specific : "BUNNY_";
  const libraryId = process.env[`${prefix}LIBRARY_ID`];
  const apiKey = process.env[`${prefix}API_KEY`];
  const cdnHost = process.env[`${prefix}CDN_HOST`];
  if (!libraryId || !apiKey || !cdnHost) return null;
  return {
    library,
    libraryId: String(libraryId),
    apiKey,
    cdnHost,
    // Clave de "Token Authentication" de la pull zone de la librería.
    cdnTokenKey: process.env[`${prefix}CDN_TOKEN_KEY`] || null,
  };
}

function localAllowed() {
  return process.env.NODE_ENV === "development" || process.env.MEDIA_LOCAL === "1";
}

module.exports = { r2Config, bunnyConfig, localAllowed };
