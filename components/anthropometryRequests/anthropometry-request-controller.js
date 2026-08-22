const anthropometryRequestDao = require("./anthropometry-request-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const notificationDao = require("../notifications/notification-dao");
const { ANTHROPOMETRY_REQUEST_FIELD_KEYS } = require("./anthropometry-request-fields");

function validFields(fields) {
  return Array.isArray(fields) && fields.length > 0 && fields.every((f) => ANTHROPOMETRY_REQUEST_FIELD_KEYS.includes(f));
}

module.exports = {
  // --- Lado profesional ---
  // GET /trainer/clients/:clientId/anthropometry-request
  async getForClient(req, res) {
    const request = await anthropometryRequestDao.findByTrainerAndClient(req.auth.userId, req.params.clientId);
    return res.send(request);
  },

  // PUT /trainer/clients/:clientId/anthropometry-request
  async upsertForClient(req, res) {
    const { fields, notes, cadence, customIntervalDays } = req.body || {};

    if (!validFields(fields)) {
      return res.status(400).send({ message: "fields debe incluir al menos una medida reconocida" });
    }
    const allowedCadences = ["once", "daily", "weekly", "monthly", "custom"];
    if (!allowedCadences.includes(cadence)) {
      return res.status(400).send({ message: "cadence no reconocida" });
    }
    if (cadence === "custom" && !(Number(customIntervalDays) > 0)) {
      return res.status(400).send({ message: "customIntervalDays es obligatorio y positivo con cadence=custom" });
    }

    const clientId = req.params.clientId;
    const trainerId = req.auth.userId;

    const request = await anthropometryRequestDao.upsert(trainerId, clientId, {
      fields,
      notes,
      cadence,
      customIntervalDays: cadence === "custom" ? Number(customIntervalDays) : null,
    });

    await notificationDao.create(clientId, trainerId, "anthropometry_requested", { fields, cadence });

    return res.status(201).send(request);
  },

  // DELETE /trainer/clients/:clientId/anthropometry-request
  async cancelForClient(req, res) {
    const request = await anthropometryRequestDao.cancel(req.auth.userId, req.params.clientId);
    if (!request) return res.status(404).send({ message: "No hay ninguna petición de medidas para este cliente" });
    return res.sendStatus(204);
  },

  // --- Lado cliente ---
  // GET /trainer/anthropometry-requests/mine — qué le piden, por cada
  // trainer con relación activa (mismo criterio que checkin-controller#listMine).
  async listMine(req, res) {
    const requests = await anthropometryRequestDao.findActiveByClient(req.auth.userId);
    const visible = [];
    for (const request of requests) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(request.trainerId, req.auth.userId);
      if (relation) visible.push(request);
    }
    return res.send(visible);
  },
};
