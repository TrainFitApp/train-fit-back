// PURO — qué escribir en CoachAlert tras una evaluación, sin tocar la BD.
//
// Lo comparten las señales del sistema (coach-alert-service.js) y las reglas
// del coach (coach-rule-service.js). Antes cada alerta costaba 2 consultas
// secuenciales (buscar la abierta y luego crearla o refrescarla); ahora que la
// evaluación corre dentro de la petición del entrenador, eso era latencia
// directa. El servicio lee las abiertas UNA vez, esto decide, y el DAO lo
// aplica en un único bulkWrite (coach-alert-dao#applyWritePlan).

/**
 * @param {Array} candidates alertas que la evaluación quiere abiertas:
 *   { dedupeKey, trainerId, clientId, type, priority, reason, context, ruleId? }
 * @param {Object} state
 * @param {Map} state.openIdByKey dedupeKey -> _id de la alerta abierta ahora
 * @param {Set} [state.silencedKeys] dedupeKey cerradas a mano dentro del
 *   periodo de silencio: no se reabren
 * @param {Date} state.now
 * @returns {{ inserts: Array, refreshes: Array, keptKeys: string[], skipped: number }}
 *   keptKeys = las que deben seguir abiertas; el resto del mismo ámbito se
 *   cierra solo.
 */
function planAlertWrites(candidates, { openIdByKey, silencedKeys = new Set(), now }) {
  // Una clave repetida en la misma pasada es UNA alerta: gana la última,
  // igual que cuando el segundo candidato refrescaba la alerta recién
  // creada. Sin esto, el segundo insert chocaría con el índice único parcial.
  const byKey = new Map();
  for (const candidate of candidates) byKey.set(candidate.dedupeKey, candidate);

  const inserts = [];
  const refreshes = [];
  const keptKeys = [];
  let skipped = 0;

  for (const [dedupeKey, candidate] of byKey) {
    const openId = openIdByKey.get(dedupeKey);
    if (openId) {
      refreshes.push({
        _id: openId,
        set: {
          reason: candidate.reason,
          context: candidate.context,
          priority: candidate.priority,
          lastSeenAt: now,
        },
      });
      keptKeys.push(dedupeKey);
      continue;
    }

    if (silencedKeys.has(dedupeKey)) {
      skipped++;
      continue;
    }

    inserts.push({ ...candidate, lastSeenAt: now, createdAt: now });
    keptKeys.push(dedupeKey);
  }

  return { inserts, refreshes, keptKeys, skipped };
}

module.exports = { planAlertWrites };
