const techniqueVideoService = require("./technique-video-service");
const { baseUrlOf, send } = require("../media/media-controller");

module.exports = {
  // --- Lado profesional ---

  // GET /trainer/technique-videos
  async listMine(req, res) {
    return res.send(await techniqueVideoService.listMine(req.user, { baseUrl: baseUrlOf(req) }));
  },

  // POST /trainer/technique-videos { title, cues, source, assetId | externalUrl, exerciseIds }
  async create(req, res) {
    return send(res, await techniqueVideoService.create(req.user, req.body, { baseUrl: baseUrlOf(req) }), 201);
  },

  // PUT /trainer/technique-videos/:id { title?, cues?, exerciseIds? }
  async update(req, res) {
    return send(res, await techniqueVideoService.update(req.user, req.params.id, req.body, { baseUrl: baseUrlOf(req) }));
  },

  // DELETE /trainer/technique-videos/:id
  async remove(req, res) {
    return send(res, await techniqueVideoService.remove(req.user, req.params.id));
  },

  // GET /trainer/clients/:clientId/technique-videos — asignaciones a ese cliente.
  async clientOverrides(req, res) {
    return res.send(await techniqueVideoService.clientOverrides(req.auth.userId, req.params.clientId));
  },

  // PUT /trainer/clients/:clientId/technique-videos/:exerciseId { techniqueVideoId | null }
  async setClientOverride(req, res) {
    return send(
      res,
      await techniqueVideoService.setClientOverride(
        req.auth.userId,
        req.params.clientId,
        req.params.exerciseId,
        req.body?.techniqueVideoId || null
      )
    );
  },

  // --- Lado cliente ---

  // GET /technique-videos/mine — vídeos de sus entrenadores por ejercicio.
  async forMe(req, res) {
    return res.send(await techniqueVideoService.forClient(req.user._id, { baseUrl: baseUrlOf(req) }));
  },
};
