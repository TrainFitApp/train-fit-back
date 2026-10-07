// Quién puede subir y quién puede ver qué (docs/plan-medidas-multimedia.md).
// Toda la política de acceso a fotos y vídeos vive aquí para que no haya dos
// versiones de la misma regla repartidas por los controllers.
//
// PURO: entran usuario, relaciones y documentos; salen booleanos. Sin Mongo.

const { isoDateInZone } = require("../util/date-util");

// La regla de quién sube vive con el resto de límites de plan.
const { canUploadMedia } = require("../billing/feature-access");

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

/** ¿Mandó el cliente este día a ESTE profesional (check-in o cuestionario de alta)? */
function sentToTrainer(day, trainerId) {
  const mine = (link) => String(link.trainerId) === String(trainerId);
  return (day?.checkins || []).some(mine) || (day?.intakes || []).some(mine);
}

/**
 * Decisión 4: ¿ve el profesional este día de progreso del cliente?
 *   1. La relación está activa (quien llama ya lo ha comprobado).
 *   2. Si el día responde a un check-in o al cuestionario de alta de ESTE
 *      profesional, lo ve siempre: responder ya es enviárselo.
 *   3. Si no, el día no puede estar oculto y tiene que ser del inicio de la
 *      relación en adelante, salvo que el cliente le haya compartido su
 *      historial.
 */
// `timeZone`: la del cliente — la relación empezó en un instante, y el día
// que cuenta es el de su calendario.
function trainerCanSeeProgressDay(day, { trainerId, relationStart, historyShared, timeZone } = {}) {
  if (!day) return false;
  if (sentToTrainer(day, trainerId)) return true;
  if (day.hiddenFromTrainers) return false;
  if (historyShared) return true;
  if (!relationStart) return false;
  return String(day.date) >= isoDateInZone(relationStart, timeZone);
}

module.exports = {
  MEDIA_CONSENT_VERSION,
  hasMediaConsent,
  canUploadMedia,
  uploadBlockReason,
  sentToTrainer,
  trainerCanSeeProgressDay,
};
