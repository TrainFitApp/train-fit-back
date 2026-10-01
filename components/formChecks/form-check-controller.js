const formCheckService = require("./form-check-service");
const { baseUrlOf, send } = require("../media/media-controller");

module.exports = {
  // --- Lado cliente ---

  // POST /form-checks/mine { assetId, exerciseId, exerciseName, tableId, date, setSnapshot, clientNote }
  async createMine(req, res) {
    return send(res, await formCheckService.create(req.user, req.body, { baseUrl: baseUrlOf(req) }), 201);
  },

  // GET /form-checks/mine?exerciseId=
  async listMine(req, res) {
    return res.send(await formCheckService.listMine(req.user, { exerciseId: req.query.exerciseId }, { baseUrl: baseUrlOf(req) }));
  },

  // POST /form-checks/mine/:id/seen — ya leyó la respuesta.
  async markSeenMine(req, res) {
    return send(res, await formCheckService.markSeenMine(req.user, req.params.id));
  },

  // DELETE /form-checks/mine/:id
  async deleteMine(req, res) {
    return send(res, await formCheckService.deleteMine(req.user, req.params.id));
  },

  // --- Lado profesional ---

  // GET /trainer/form-checks?status=pending|reviewed&clientId=
  async listForTrainer(req, res) {
    return res.send(
      await formCheckService.listForTrainer(
        req.auth.userId,
        { status: req.query.status, clientId: req.query.clientId },
        { baseUrl: baseUrlOf(req) }
      )
    );
  },

  // GET /trainer/form-checks/pending-count — contador del menú y el dashboard.
  async pendingCount(req, res) {
    return res.send(await formCheckService.pendingCount(req.auth.userId));
  },

  // GET /trainer/form-checks/:id
  async getForTrainer(req, res) {
    return send(res, await formCheckService.getForTrainer(req.auth.userId, req.params.id, { baseUrl: baseUrlOf(req) }));
  },

  // POST /trainer/form-checks/:id/comments { atSec?, text, techniqueVideoId? }
  async addComment(req, res) {
    return send(res, await formCheckService.addComment(req.auth.userId, req.params.id, req.body, { baseUrl: baseUrlOf(req) }));
  },

  // DELETE /trainer/form-checks/:id/comments/:commentId
  async removeComment(req, res) {
    return send(
      res,
      await formCheckService.removeComment(req.auth.userId, req.params.id, req.params.commentId, { baseUrl: baseUrlOf(req) })
    );
  },

  // POST /trainer/form-checks/:id/review — la da por revisada y avisa al cliente.
  async review(req, res) {
    return send(res, await formCheckService.review(req.auth.userId, req.params.id, { baseUrl: baseUrlOf(req) }));
  },

  // PUT /trainer/form-checks/:id/keep { keep }
  async setKeep(req, res) {
    return send(
      res,
      await formCheckService.setKeep(req.auth.userId, req.params.id, Boolean(req.body?.keep), { baseUrl: baseUrlOf(req) })
    );
  },
};
