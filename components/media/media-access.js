// Quién puede subir y quién puede ver qué (docs/plan-medidas-multimedia.md).
// Toda la política de acceso a fotos y vídeos vive aquí para que no haya dos
// versiones de la misma regla repartidas por los controllers.
//
// PURO: entran usuario, relaciones y documentos; salen booleanos. Sin Mongo.

const { isoDate } = require("../util/date-util");

// La regla de quién sube vive con el resto de límites de plan.
const { canUploadMedia } = require("../billing/feature-access-service");

// Versión del texto del consentimiento de fotos y vídeos que enseña la app
// (MediaConsentSheetComponent). Si cambia lo que se le cuenta al usuario, se
// sube la versión y la app vuelve a pedirlo antes de la siguiente subida.
const MEDIA_CONSENT_VERSION = "2026-10";

/** ¿Ha dado el consentimiento explícito vigente? */
function hasMediaConsent(user) {
  return Boolean(user?.mediaConsentAt) && user.mediaConsentVersion === MEDIA_CONSENT_VERSION;
}

/** Motivo por el que no puede subir, para que la app enseñe la card correcta. */
function uploadBlockReason(user, hasActiveTrainerRelation = false) {
  if (canUploadMedia(user, hasActiveTrainerRelation)) return null;
  return "premium_required";
}

/**
 * Inicio de la relación de un profesional con el cliente: la aceptación más
 * antigua entre sus relaciones activas (hay una por scope).
 */
function relationStartOf(relations) {
  const dates = (relations || [])
    .map((relation) => relation.respondedAt || relation.invitedAt)
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  return dates.length ? new Date(Math.min(...dates)) : null;
}

/**
 * Decisión 4: ¿ve el profesional este día de progreso del cliente?
 *   1. La relación está activa (quien llama ya lo ha comprobado).
 *   2. Si el día responde a un check-in de ESTE profesional, lo ve siempre:
 *      responder ya es enviárselo.
 *   3. Si no, el día no puede estar oculto y tiene que ser del inicio de la
 *      relación en adelante, salvo que el cliente le haya compartido su
 *      historial.
 */
function trainerCanSeeProgressDay(day, { trainerId, relationStart, historyShared } = {}) {
  if (!day) return false;
  const answersHisCheckin = (day.checkins || []).some(
    (checkin) => String(checkin.trainerId) === String(trainerId)
  );
  if (answersHisCheckin) return true;
  if (day.hiddenFromTrainers) return false;
  if (historyShared) return true;
  if (!relationStart) return false;
  return String(day.date) >= isoDate(relationStart);
}

/** Decisión 3: el admin no ve nunca fotos ni vídeos. Se niega aquí de forma explícita. */
function adminCanSeeContent() {
  return false;
}

module.exports = {
  MEDIA_CONSENT_VERSION,
  hasMediaConsent,
  canUploadMedia,
  uploadBlockReason,
  relationStartOf,
  trainerCanSeeProgressDay,
  adminCanSeeContent,
};
