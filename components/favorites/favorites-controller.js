const favoritesService = require("./favorites-service");

const isAdmin = (req) => Boolean(req.userData?.roles?.includes("admin"));

module.exports = {
  // PUT /favorites/:kind/:id — kind: products | recipes | exercises. Idempotente.
  async add(req, res) {
    await favoritesService.add(req.auth.userId, req.params.kind, req.params.id, { isAdmin: isAdmin(req) });
    return res.sendStatus(204);
  },

  // DELETE /favorites/:kind/:id
  async remove(req, res) {
    await favoritesService.remove(req.auth.userId, req.params.kind, req.params.id);
    return res.sendStatus(204);
  },
};
