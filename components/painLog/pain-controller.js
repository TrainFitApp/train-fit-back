const painService = require("./pain-service");
const {
  PAIN_ZONES,
  PAIN_BANDS,
  PAIN_MIN,
  PAIN_MAX,
  PAIN_LIMITING_LEVEL,
  sanitizePainEntry,
  sanitizeThreshold,
} = require("./pain-catalog");
const { todayIsoDate } = require("../util/date-util");

// Ventana por defecto del histórico que ve el entrenador. 28 días, el mismo
// periodo que analizan las alertas y el resumen de la ficha: tres ventanas
// distintas para el mismo cliente según qué pantalla mires es exactamente lo
// que hace desconfiar de los números.
const PAIN_WINDOW_DAYS = 28;


module.exports = {
  // GET /pain/catalog — el vocabulario lo decide el backend, igual que el de
  // las reglas: así es imposible que la interfaz ofrezca una zona que el
  // validador no conoce.
  async getCatalog(_req, res) {
    return res.send({
      zones: PAIN_ZONES,
      bands: PAIN_BANDS,
      min: PAIN_MIN,
      max: PAIN_MAX,
      limitingLevel: PAIN_LIMITING_LEVEL,
    });
  },

  // --- Lado cliente ---

  // GET /pain/mine?date=YYYY-MM-DD — lo que el cliente apuntó ese día.
  async listMine(req, res) {
    const date = req.query.date || todayIsoDate(req.auth.timeZone);
    const entries = await painService.listForDate(req.user.id, date);
    return res.send({ date, entries });
  },

  // GET /pain/mine/history — su propio histórico, para ver si va a mejor.
  async listMyHistory(req, res) {
    const days = Number(req.query.days) || PAIN_WINDOW_DAYS;
    // Tope duro: `days` viene del query string, y sin límite una petición
    // podría pedir diez años de registros.
    const safeDays = Math.min(Math.max(days, 1), 365);
    const entries = await painService.listLastDays(req.user.id, todayIsoDate(req.auth.timeZone), safeDays);
    return res.send({ days: safeDays, entries });
  },

  // PUT /pain/mine — apunta (o corrige) el dolor de una zona hoy.
  async upsertMine(req, res) {
    const date = req.body?.date || todayIsoDate(req.auth.timeZone);
    const entry = sanitizePainEntry(req.body);
    if (!entry) {
      return res.status(400).send({
        message: "Zona o nivel no válidos",
        code: "PAIN_INVALID_ENTRY",
      });
    }
    const saved = await painService.upsertEntry(req.user.id, date, entry);
    return res.send(saved);
  },

  // DELETE /pain/mine — quita el registro de una zona ese día. Distinto de
  // apuntar un 0: el 0 dice "hoy no me duele" (dato), esto dice "me
  // equivoqué al apuntarlo" (no hay dato).
  async removeMine(req, res) {
    const date = req.query.date || todayIsoDate(req.auth.timeZone);
    const zone = req.query.zone;
    if (!zone) return res.status(400).send({ message: "Falta la zona" });
    await painService.removeEntry(req.user.id, date, zone);
    return res.sendStatus(204);
  },

  // --- Lado profesional ---

  // GET /trainer/clients/:clientId/pain — histórico + umbrales en una sola
  // petición: la pantalla los enseña juntos y separarlos obligaría a la
  // ficha a hacer dos llamadas para pintar una tarjeta.
  async getClientPain(req, res) {
    const days = Math.min(Math.max(Number(req.query.days) || PAIN_WINDOW_DAYS, 1), 365);
    const { entries, thresholds } = await painService.clientPain(req.auth.userId, req.params.clientId, days);
    return res.send({ days, entries, thresholds });
  },

  // PUT /trainer/clients/:clientId/pain/thresholds — hasta dónde se trabaja
  // y desde dónde se para, en una zona.
  async upsertThreshold(req, res) {
    const threshold = sanitizeThreshold(req.body);
    if (!threshold) {
      return res.status(400).send({
        message: "Zona o niveles no válidos",
        code: "PAIN_INVALID_THRESHOLD",
      });
    }
    const saved = await painService.upsertThreshold(req.auth.userId, req.params.clientId, threshold);
    if (!saved) return res.status(404).send({ message: "No tienes una relación con este cliente" });
    return res.send(saved);
  },

  async removeThreshold(req, res) {
    await painService.removeThreshold(req.auth.userId, req.params.clientId, req.params.zone);
    return res.sendStatus(204);
  },
};
