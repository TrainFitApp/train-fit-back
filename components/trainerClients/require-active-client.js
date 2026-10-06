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
 * @param {{allowReadOnly?: boolean}} options — allowReadOnly deja pasar
 * escrituras con el cliente en solo lectura. Solo para estado propio del
 * entrenador que no toca datos del cliente (p. ej. marcar notas como vistas).
 */
function requireActiveClient(requiredScope, { allowReadOnly = false } = {}) {
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
        req.trainerClientPair = null;
        return next();
      }

      const pair = await trainerClientDao.findActivePair(trainerId, clientId, requiredScope);

      if (!pair) {
        return res.status(403).send({ message: "No tienes una relación activa con este cliente" });
      }

      // Por encima del cupo del plan, los clientes fuera de las plazas activas
      // se pueden consultar pero no modificar (trainer-seat-service.js).
      if (!allowReadOnly && await rejectIfReadOnly(req, res, clientId)) return;

      req.trainerClientPair = pair;
      next();
    } catch (e) {
      console.error("Error en requireActiveClient:", e.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
}

// Para rutas que comprueban la relación en su servicio (cuestionario de
// alta) pero tampoco pueden escribir sobre un cliente en solo lectura.
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
