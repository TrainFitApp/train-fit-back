const trainerClientDao = require("./trainer-client-dao");

/**
 * ¿Puede quien llama actuar sobre los datos de `subjectId`? Para los endpoints
 * que reciben el id de un usuario en la URL o en el cuerpo en vez de sacarlo
 * del token (rutas de compatibilidad, búsquedas en nombre de un cliente…).
 *
 * El propio usuario y un admin, siempre. Un profesional, solo si se pasa
 * `trainerScope` y tiene relación ACTIVA de ese scope con ese cliente (mismo
 * criterio que require-active-client.js para las rutas /trainer/clients).
 */
async function canActOnSubject(req, subjectId, { trainerScope = null } = {}) {
  if (!subjectId) return false;
  const requesterId = req.auth?.userId;
  const roles = req.auth?.roles || [];
  if (String(subjectId) === String(requesterId)) return true;
  if (roles.includes("admin")) return true;
  if (trainerScope && roles.includes("trainer")) {
    return trainerClientDao.isActivePair(requesterId, subjectId, trainerScope);
  }
  return false;
}

module.exports = { canActOnSubject };
