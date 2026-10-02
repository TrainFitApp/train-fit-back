// Catálogo cerrado de lo que se puede subir (docs/plan-medidas-multimedia.md).
// Cada propósito decide quién sube, qué formatos acepta, cuánto puede ocupar
// y cuánto dura. El backend nunca recibe los bytes: con esto firma la subida,
// y al confirmarla comprueba que lo subido respeta lo firmado.
//
// PURO: sin Mongo ni red.

const MB = 1024 * 1024;
const GB = 1024 * MB;

const IMAGE_MIMES = ["image/jpeg", "image/webp", "image/png"];
// Lo que graban o eligen iOS y Android, y lo que sube un escritorio.
const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp"];

// 3 min para todos (decisión 6 del plan).
const MAX_VIDEO_SECONDS = 180;
// Un vídeo de 3 min en 1080p pesa 150–350 MB; en 4K pasa de 1 GB. La app
// pide 1080p y avisa si el archivo se va por encima.
const MAX_VIDEO_BYTES = 1 * GB;
// La foto llega ya recomprimida del móvil (1600 px, JPEG ≈ 400 KB). El tope
// es holgado para no rechazar una foto buena en un móvil raro.
const MAX_IMAGE_BYTES = 8 * MB;
// Miniatura de la foto o fotograma de portada del vídeo (400 px).
const MAX_THUMB_BYTES = 1 * MB;

const PURPOSES = {
  progress_photo: {
    kind: "image",
    uploader: "client",
    mimes: IMAGE_MIMES,
    maxBytes: MAX_IMAGE_BYTES,
    retentionDays: null,
  },
  progress_video: {
    kind: "video",
    uploader: "client",
    mimes: VIDEO_MIMES,
    maxBytes: MAX_VIDEO_BYTES,
    maxDurationSec: MAX_VIDEO_SECONDS,
    retentionDays: null,
  },
  form_check: {
    kind: "video",
    uploader: "client",
    mimes: VIDEO_MIMES,
    maxBytes: MAX_VIDEO_BYTES,
    maxDurationSec: MAX_VIDEO_SECONDS,
    // Decisión 2: 90 días salvo «Conservar», con avisos antes de borrar.
    retentionDays: 90,
  },
  technique_video: {
    kind: "video",
    uploader: "trainer",
    mimes: VIDEO_MIMES,
    maxBytes: MAX_VIDEO_BYTES,
    maxDurationSec: MAX_VIDEO_SECONDS,
    retentionDays: null,
  },
};

const PURPOSE_IDS = Object.keys(PURPOSES);

// Revisiones de técnica que un cliente puede mandar en 7 días seguidos.
const FORM_CHECKS_PER_WEEK = 5;
// Cuándo empieza a avisarse de que una revisión va a borrarse.
const EXPIRY_WARNING_DAYS = 7;

// Cupo de la biblioteca de vídeos del entrenador, por plan. Está para frenar
// abusos, no para cobrar: el coste real es de céntimos.
const TRAINER_LIBRARY_BYTES = {
  trainer_pro: 10 * GB,
  trainer_growth: 25 * GB,
  trainer_scale: 75 * GB,
};
const TRAINER_LIBRARY_BYTES_FREE = 2 * GB;

const POSES = ["front", "side", "back", "extra"];

// hasOwnProperty y no `PURPOSES[id]`: `purpose` llega del cuerpo de la
// petición (media-service.js#createUpload), y con "__proto__" o "constructor"
// el acceso directo devolvía algo heredado de Object.prototype — truthy, así
// que se tomaba por un propósito válido y la validación reventaba al leer
// `def.mimes` (500 en vez del 400 con MEDIA_INVALID_PURPOSE).
function purposeOf(id) {
  return Object.prototype.hasOwnProperty.call(PURPOSES, id) ? PURPOSES[id] : null;
}

function libraryBytesFor(user) {
  const tier = user?.professionalPremium?.entitled ? user.professionalPremium.tier : null;
  return TRAINER_LIBRARY_BYTES[tier] || TRAINER_LIBRARY_BYTES_FREE;
}

/**
 * Valida la petición de subida contra el catálogo. Devuelve el propósito o
 * un { error, code } listo para responder 400.
 */
function validateUploadRequest({ purpose, mime, bytes, durationSec, thumbMime, thumbBytes } = {}) {
  const def = purposeOf(purpose);
  if (!def) return { error: "Tipo de archivo no permitido", code: "MEDIA_INVALID_PURPOSE" };
  if (!def.mimes.includes(String(mime || "").toLowerCase())) {
    return { error: "Formato no admitido", code: "MEDIA_INVALID_FORMAT" };
  }
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return { error: "Archivo vacío", code: "MEDIA_EMPTY" };
  if (size > def.maxBytes) return { error: "El archivo es demasiado grande", code: "MEDIA_TOO_LARGE" };
  if (def.kind === "video") {
    const seconds = Number(durationSec);
    if (!Number.isFinite(seconds) || seconds <= 0) return { error: "No se pudo leer la duración del vídeo", code: "MEDIA_NO_DURATION" };
    // Un segundo de margen: el redondeo de los metadatos varía por móvil.
    if (seconds > def.maxDurationSec + 1) return { error: "El vídeo dura más de 3 minutos", code: "MEDIA_TOO_LONG" };
  }
  if (thumbMime != null || thumbBytes != null) {
    if (!IMAGE_MIMES.includes(String(thumbMime || "").toLowerCase())) {
      return { error: "Formato de miniatura no admitido", code: "MEDIA_INVALID_FORMAT" };
    }
    const thumbSize = Number(thumbBytes);
    if (!Number.isFinite(thumbSize) || thumbSize <= 0 || thumbSize > MAX_THUMB_BYTES) {
      return { error: "Miniatura no válida", code: "MEDIA_INVALID_THUMB" };
    }
  }
  return { def };
}

function extensionFor(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/png": "png",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-m4v": "m4v",
    "video/3gpp": "3gp",
  };
  return map[String(mime || "").toLowerCase()] || "bin";
}

module.exports = {
  PURPOSES,
  PURPOSE_IDS,
  POSES,
  IMAGE_MIMES,
  VIDEO_MIMES,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  FORM_CHECKS_PER_WEEK,
  EXPIRY_WARNING_DAYS,
  TRAINER_LIBRARY_BYTES,
  TRAINER_LIBRARY_BYTES_FREE,
  purposeOf,
  libraryBytesFor,
  validateUploadRequest,
  extensionFor,
};
