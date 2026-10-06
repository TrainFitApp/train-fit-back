const coachAlertService = require("./coach-alert-service");

const LISTABLE_STATUSES = ["open", "resolved", "dismissed"];
const CLOSING_STATUSES = ["resolved", "dismissed"];
const MAX_COACH_NOTE_LENGTH = 1000;

// Aplana el `client` que viene del $lookup a la misma forma que ya usa el
// resto del módulo trainer (clientId + clientName), para que el frontend no
// tenga que distinguir entre esta respuesta y la de getAttentionItems.
function toDto(alert) {
  const { client, ...rest } = alert;
  return {
    ...rest,
    clientName: client ? `${client.name} ${client.lastname}`.trim() : "Cliente",
  };
}

module.exports = {
  // GET /trainer/alerts?status=open — alertas del profesional autenticado,
  // las más graves primero. La primera lectura del día evalúa antes; el
  // resto es una sola consulta indexada (ver ensureEvaluatedToday).
  async listMine(req, res) {
    const status = LISTABLE_STATUSES.includes(req.query.status) ? req.query.status : "open";
    await coachAlertService.ensureEvaluatedToday(req.auth.userId, { timeZone: req.auth.timeZone });
    const alerts = await coachAlertService.listForTrainer(req.auth.userId, { status });
    return res.send(alerts.map(toDto));
  },

  // PATCH /trainer/alerts/:id — { status: "resolved"|"dismissed"|"open", coachNote? }
  // "resolved" = me he ocupado. "dismissed" = no me interesa esta señal.
  // "open" = reabrir algo cerrado por error.
  async setStatus(req, res) {
    const { status, coachNote } = req.body || {};

    if (![...CLOSING_STATUSES, "open"].includes(status)) {
      return res.status(400).send({
        message: `status debe ser uno de: ${[...CLOSING_STATUSES, "open"].join(", ")}`,
      });
    }
    if (coachNote !== undefined && typeof coachNote !== "string") {
      return res.status(400).send({ message: "coachNote debe ser texto" });
    }
    if (coachNote && coachNote.length > MAX_COACH_NOTE_LENGTH) {
      return res
        .status(400)
        .send({ message: `coachNote no puede superar ${MAX_COACH_NOTE_LENGTH} caracteres` });
    }

    const alert = await coachAlertService.setStatus(req.auth.userId, req.params.id, {
      status,
      coachNote: coachNote?.trim(),
      resolvedBy: req.auth.userId,
    });

    // 404 y no 403 cuando la alerta es de otro profesional: el filtro por
    // trainerId no distingue "no existe" de "no es tuya", y
    // distinguirlo aquí confirmaría la existencia de un id ajeno.
    if (!alert) return res.status(404).send({ message: "Alerta no encontrada" });
    return res.send(alert);
  },

  // POST /trainer/alerts/evaluate — fuerza la evaluación del profesional
  // autenticado ahora mismo. Existe porque el ciclo natural de este sistema
  // es de un día: sin esto, un profesional que da de alta clientes a media
  // mañana no los vería en el panel hasta el día siguiente. Solo evalúa SUS
  // clientes.
  async evaluateMine(req, res) {
    const result = await coachAlertService.evaluateNow(req.auth.userId, { timeZone: req.auth.timeZone });
    return res.send(result);
  },
};
