// Punto único de comprobación "¿tiene este trainer una relación ACTIVA con
// este cliente, en este ámbito?". Reutilizado por requireActiveClient()
// (middleware de rutas) y por cualquier controller de dominio que necesite
// comprobarlo directamente. Ver docs/trainfit-trainers/04-problemas-y-riesgos.md
// — en refactor-claude esta misma pregunta se resolvía en 3 sitios distintos;
// aquí solo en este módulo.
const trainerClientDao = require("./trainer-client-dao");

module.exports = {
  async hasActiveRelation(trainerId, clientId, scope) {
    const relation = await trainerClientDao.findActiveByTrainerAndClient(
      trainerId,
      clientId,
      scope
    );
    return Boolean(relation);
  },

  async requireActiveRelation(trainerId, clientId, scope) {
    const relation = await trainerClientDao.findActiveByTrainerAndClient(
      trainerId,
      clientId,
      scope
    );
    if (!relation) {
      const error = new Error("No hay una relación activa con este cliente");
      error.statusCode = 403;
      error.code = "NO_ACTIVE_RELATION";
      throw error;
    }
    return relation;
  },
};
