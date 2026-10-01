const progressMediaService = require("./progress-media-service");
const { baseUrlOf, send } = require("../media/media-controller");

function rangeOf(query) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "") ? query.from : undefined;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to : undefined;
  return { from, to };
}

module.exports = {
  // --- Lado cliente ---

  // GET /progress-media/mine?from&to — sus días con fotos y vídeos.
  async listMine(req, res) {
    return res.send(await progressMediaService.listMine(req.user, rangeOf(req.query), { baseUrl: baseUrlOf(req) }));
  },

  // PUT /progress-media/mine/:date/photos/:pose { assetId }
  async setPhoto(req, res) {
    const { date, pose } = req.params;
    return send(res, await progressMediaService.setPhoto(req.user, date, pose, req.body?.assetId, { baseUrl: baseUrlOf(req) }));
  },

  // DELETE /progress-media/mine/:date/photos/:pose
  async removePhoto(req, res) {
    const { date, pose } = req.params;
    return send(res, await progressMediaService.removePhoto(req.user, date, pose, { baseUrl: baseUrlOf(req) }));
  },

  // POST /progress-media/mine/:date/videos { assetId, note }
  async addVideo(req, res) {
    return send(
      res,
      await progressMediaService.addVideo(req.user, req.params.date, req.body?.assetId, req.body?.note, { baseUrl: baseUrlOf(req) })
    );
  },

  // DELETE /progress-media/mine/:date/videos/:assetId
  async removeVideo(req, res) {
    const { date, assetId } = req.params;
    return send(res, await progressMediaService.removeVideo(req.user, date, assetId, { baseUrl: baseUrlOf(req) }));
  },

  // PATCH /progress-media/mine/:date { note?, hiddenFromTrainers? }
  async updateDay(req, res) {
    return send(res, await progressMediaService.updateDay(req.user, req.params.date, req.body, { baseUrl: baseUrlOf(req) }));
  },

  // GET /progress-media/mine/trainers — con quién comparte y desde cuándo.
  async listTrainers(req, res) {
    return res.send(await progressMediaService.trainersForHistory(req.user));
  },

  // PUT /progress-media/mine/trainers/:trainerId/history { shared }
  async setHistory(req, res) {
    return send(res, await progressMediaService.setHistoryShared(req.user, req.params.trainerId, req.body?.shared));
  },

  // --- Lado profesional ---

  // GET /trainer/clients/:clientId/progress-media?from&to
  async listForTrainer(req, res) {
    return res.send(
      await progressMediaService.listForTrainer(req.auth.userId, req.params.clientId, rangeOf(req.query), {
        baseUrl: baseUrlOf(req),
      })
    );
  },

  // GET /trainer/clients/:clientId/progress-media/:dayId — un día concreto
  // (p. ej. el que respondió un check-in).
  async dayForTrainer(req, res) {
    const day = await progressMediaService.dayViewForTrainer(req.auth.userId, req.params.clientId, req.params.dayId, {
      baseUrl: baseUrlOf(req),
    });
    if (!day) return res.status(404).send({ message: "No encontrado" });
    return res.send({ day });
  },
};
