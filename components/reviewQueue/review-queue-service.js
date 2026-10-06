const trainerClientDao = require("../trainerClients/trainer-client-dao");
const checkinDao = require("../trainerCheckins/checkin-dao");
const { activeScopes } = require("../trainerClients/pair-state");
const formCheckService = require("../formChecks/form-check-service");

/**
 * Bandeja «Por revisar» del profesional: todo lo que sus clientes le han
 * mandado y espera su respuesta, en una sola cola ordenada por antigüedad.
 *
 *   - checkin:    respuesta de check-in sin revisar;
 *   - form_check: revisión de técnica pendiente (solo clientes de
 *                 entrenamiento: el nutricionista no las ve);
 *   - intake:     cuestionario de alta enviado y sin marcar como revisado.
 *
 * Solo clientes con relación activa. Las alertas no entran: las genera el
 * sistema, no el cliente, y ya tienen su sitio en «Hoy».
 */

function clientNameOf(client) {
  if (!client || typeof client !== "object") return "";
  return [client.name, client.lastname].filter(Boolean).join(" ") || client.email || "";
}

function idOf(value) {
  return String(value?._id || value);
}

// Una entrada por cliente en curso con sus scopes activos.
async function activeClientsOf(trainerId) {
  const pairs = await trainerClientDao.findActivePairsOfTrainer(trainerId);
  return pairs.map((pair) => ({ clientId: pair.clientId, scopes: activeScopes(pair) }));
}

function formCheckItem(check) {
  return {
    type: "form_check",
    id: check.id,
    clientId: check.clientId,
    clientName: check.clientName,
    title: check.exerciseName,
    date: check.date,
    since: check.createdAt,
    thumbUrl: check.video?.thumbUrl || null,
    durationSec: check.video?.durationSec || null,
    keep: check.keep,
    daysLeft: check.daysLeft,
    expiringSoon: check.expiringSoon,
  };
}

module.exports = {
  async list(trainerId, { baseUrl } = {}) {
    const clients = await activeClientsOf(trainerId);
    const clientIds = clients.map((client) => client.clientId);
    const [responses, formChecks, intakes] = await Promise.all([
      clientIds.length ? checkinDao.listPendingReviewForTrainer(trainerId, clientIds) : [],
      formCheckService.listForTrainer(trainerId, {}, { baseUrl }),
      trainerClientDao.findUnreviewedIntakes(trainerId),
    ]);

    const checkinItems = responses.map((response) => ({
      type: "checkin",
      id: String(response._id),
      clientId: idOf(response.clientId),
      clientName: clientNameOf(response.clientId),
      title: response.name || "",
      date: response.occurrenceDate,
      week: response.week?.number ? response.week : null,
      since: response.respondedAt,
    }));
    const formCheckItems = formChecks.formChecks.filter((check) => check.status === "pending").map(formCheckItem);
    const intakeItems = intakes.map((pair) => ({
      type: "intake",
      id: String(pair._id),
      clientId: idOf(pair.clientId),
      clientName: clientNameOf(pair.clientId),
      title: "",
      since: pair.intake.submittedAt,
    }));

    const items = [...checkinItems, ...formCheckItems, ...intakeItems].sort(
      (a, b) => new Date(a.since).getTime() - new Date(b.since).getTime()
    );
    return {
      items,
      counts: {
        total: items.length,
        checkin: checkinItems.length,
        form_check: formCheckItems.length,
        intake: intakeItems.length,
      },
      // Revisiones ya respondidas que se borran esta semana (90 días salvo
      // «Conservar»): no esperan nada, pero nadie debería enterarse de que
      // un vídeo ha desaparecido cuando ya no está.
      expiringFormChecks: formChecks.formChecks
        .filter((check) => check.status === "reviewed" && check.expiringSoon)
        .map(formCheckItem),
      // Sin clientes de entrenamiento no tiene sentido ofrecer el filtro de
      // técnica (nutricionista).
      technique: clients.some((client) => client.scopes.includes("training")),
    };
  },

  /** Contador del menú: lo mismo que list, sin montar las vistas. */
  async count(trainerId) {
    const clients = await activeClientsOf(trainerId);
    const clientIds = clients.map((client) => client.clientId);
    const [checkin, formCheck, intakes] = await Promise.all([
      clientIds.length ? checkinDao.countPendingReviewForTrainer(trainerId, clientIds) : 0,
      formCheckService.pendingCount(trainerId).then((result) => result.pendingCount),
      trainerClientDao.findUnreviewedIntakes(trainerId),
    ]);
    return {
      total: checkin + formCheck + intakes.length,
      checkin,
      form_check: formCheck,
      intake: intakes.length,
    };
  },
};
