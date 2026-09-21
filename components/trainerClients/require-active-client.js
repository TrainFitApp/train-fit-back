const trainerClientDao = require("./trainer-client-dao");
const { rejectIfReadOnly } = require("./trainer-seat-service");

/**
 * Middleware de autorización — la ÚNICA comprobación de "¿tiene este profesional
 * acceso a este cliente?" en todo el backend. Ningún endpoint bajo
 * /trainer/clients/:clientId/* debe reimplementar esta lógica ad-hoc.
 *
 * trainerId se deriva EXCLUSIVAMENTE de req.auth.userId (sesión verificada por
 * validateAuth.js) — nunca del body/query. Ver MVP-trainers/00-riesgos.md R1.
 *
 * @param {"training"|"nutrition"|null} requiredScope — si se omite, cualquier
 * scope activo del cliente con este profesional satisface la comprobación.
 */
function requireActiveClient(requiredScope) {
  return async (req, res, next) => {
    try {
      const trainerId = req.auth.userId;
      const clientId = req.params.clientId;

      // Rutinas -> Plantillas (rediseño 2026-08): un profesional editando su
      // propia biblioteca de plantillas (Table con userId=trainerId, sin
      // cliente — ver table-dao.js#createTableForTrainer) reutiliza rutas
      // /trainer/clients/:clientId/* tal cual cuando :clientId coincide con
      // su propio id (p. ej. aplicar una plantilla de un solo día dentro del
      // Planificador). No hay ninguna "relación cliente" que comprobar
      // cuando el cliente ES el propio profesional — mismo criterio "dueño
      // real" que ya usa tableAccess.canAccessUserTable, extendido aquí para
      // que sea el mismo en los dos únicos chokepoints de autorización del
      // módulo trainer/clients.
      if (String(clientId) === String(trainerId)) {
        req.trainerClientRelation = null;
        return next();
      }

      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        trainerId,
        clientId,
        requiredScope
      );

      if (!relation) {
        return res.status(403).send({ message: "No tienes una relación activa con este cliente" });
      }

      // Por encima del cupo del plan, los clientes fuera de las plazas activas
      // se pueden consultar pero no modificar (trainer-seat-service.js).
      if (await rejectIfReadOnly(req, res, clientId)) return;

      req.trainerClientRelation = relation;
      next();
    } catch (e) {
      console.error("Error en requireActiveClient:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
}

// Para rutas de alta (cuestionario/confirmación) que actúan antes de que la
// relación sea "active" y por eso no llevan requireActiveClient.
function requireWritableSeat() {
  return async (req, res, next) => {
    try {
      if (await rejectIfReadOnly(req, res, req.params.clientId)) return;
      next();
    } catch (e) {
      console.error("Error en requireWritableSeat:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
}

module.exports = { requireActiveClient, requireWritableSeat };
