const trainerClientAccess = require("../components/trainerClients/trainer-client-access");

// Middleware reutilizable por cualquier ruta de dominio (tables, meals,
// nutritionalGoals... a partir de M3) que opere sobre un "cliente objetivo"
// de un trainer. Requiere que la ruta ya haya pasado por auth(["trainer"])
// y tenga un parámetro con el id del cliente (por defecto :clientId).
function requireActiveClient(scope, { clientIdParam = "clientId" } = {}) {
  return async function (req, res, next) {
    try {
      const clientId = req.params[clientIdParam];
      if (!clientId) {
        return res.status(400).send({ message: "clientId requerido" });
      }

      await trainerClientAccess.requireActiveRelation(
        req.user.id,
        clientId,
        scope
      );

      next();
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).send({
          message: error.message,
          code: error.code,
        });
      }
      next(error);
    }
  };
}

module.exports = { requireActiveClient };
