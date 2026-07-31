const trainerClientDao = require("./trainer-client-dao");
const mongoose = require("mongoose");

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

      if (!mongoose.isValidObjectId(clientId)) {
        return res.sendStatus(404);
      }

      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        trainerId,
        clientId,
        requiredScope
      );

      if (!relation) {
        return res.status(403).send({ message: "No tienes una relación activa con este cliente" });
      }

      req.trainerClientRelation = relation;
      next();
    } catch (e) {
      console.error("Error en requireActiveClient:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
}

module.exports = { requireActiveClient };
