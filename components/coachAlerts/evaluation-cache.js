const trainerClientDao = require("../trainerClients/trainer-client-dao");

// Cuándo se evaluaron por última vez las alertas de cada profesional (en
// memoria; ver coach-alert-service.js#ensureEvaluatedToday). Va aparte para
// que quien cambia algo que las afecta (una regla del profesional, un dato
// nuevo del cliente) las invalide sin depender del servicio de alertas, que
// ya depende de las reglas.
//
// 2026-10 (QA) — antes la evaluación valía el día entero: una regla creada
// hoy, o un dolor 7/10 apuntado después de la primera visita del día, no
// saltaba hasta mañana salvo con «Revisar ahora». Ahora vale como mucho
// FRESH_MS, y lo invalidan al momento los cambios de reglas y los datos
// nuevos del cliente que las alimentan.

const FRESH_MS = 15 * 60 * 1000;
const evaluations = new Map(); // String(trainerId) -> { day, startedAt, pending, promise }

/** La evaluación que se puede reutilizar (en curso, o de hoy y reciente), o null. */
function reusable(trainerId, day, nowMs) {
  const entry = evaluations.get(String(trainerId));
  if (!entry) return null;
  if (entry.pending) return entry;
  return entry.day === day && nowMs - entry.startedAt < FRESH_MS ? entry : null;
}

function invalidate(trainerId) {
  const key = String(trainerId);
  const entry = evaluations.get(key);
  // Una en curso se deja terminar; la siguiente lectura vuelve a evaluar.
  if (entry?.pending) entry.stale = true;
  else evaluations.delete(key);
}

/** Datos nuevos de un cliente: invalida a sus profesionales activos. */
async function invalidateForClient(clientId) {
  try {
    for (const trainerId of await trainerClientDao.findActiveTrainerIds(clientId)) invalidate(trainerId);
  } catch (error) {
    // Nunca rompe la escritura del cliente: como mucho la alerta llega en FRESH_MS.
    console.error("[coach-alerts] no se pudo invalidar la evaluación:", error.message);
  }
}

module.exports = { FRESH_MS, evaluations, reusable, invalidate, invalidateForClient };
