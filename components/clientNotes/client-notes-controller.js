const clientNotesService = require("./client-notes-service");

const DOMAINS = new Set(["training", "nutrition"]);
const MAX_KEYS = 200;
const MAX_QUERY = 100;
const KEY_PATTERN = /^(workout|exercise|pinned|pain|dietDay|meal):[a-f0-9]{24}$/;

function parseSeen(value) {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return null;
}

function parseFilters(source) {
  const domain = DOMAINS.has(source.domain) ? source.domain : null;
  const q = typeof source.q === "string" ? source.q.slice(0, MAX_QUERY) : "";
  return { domain, q };
}

module.exports = {
  // GET /trainer/clients/:clientId/client-notes?domain=&seen=&q=&page=&limit=
  async list(req, res) {
    const result = await clientNotesService.list(req.auth.userId, req.params.clientId, {
      ...parseFilters(req.query),
      seen: parseSeen(req.query.seen),
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.send(result);
  },

  // GET /trainer/clients/:clientId/client-notes/unread-count
  async unreadCount(req, res) {
    return res.send(await clientNotesService.unreadCount(req.auth.userId, req.params.clientId));
  },

  // PUT /trainer/clients/:clientId/client-notes/seen
  // body: { keys: string[], seen: boolean } o { all: true, seen: boolean, domain?, q? }
  async setSeen(req, res) {
    const body = req.body || {};
    const seen = parseSeen(body.seen);
    if (seen === null) {
      return res.status(400).send({ message: "Falta seen (true/false)", code: "NOTES_INVALID_SEEN" });
    }
    const all = body.all === true;
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!all && (!keys.length || keys.length > MAX_KEYS || !keys.every((key) => typeof key === "string" && KEY_PATTERN.test(key)))) {
      return res.status(400).send({ message: "Claves de nota no válidas", code: "NOTES_INVALID_KEYS" });
    }
    const result = await clientNotesService.setSeen(req.auth.userId, req.params.clientId, {
      ...parseFilters(body),
      keys,
      all,
      seen,
    });
    return res.send(result);
  },
};
