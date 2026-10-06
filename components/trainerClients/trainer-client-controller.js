const trainerClientService = require("./trainer-client-service");
const trainerClientDto = require("./trainer-client-dto");
const trainerSeatService = require("./trainer-seat-service");

// Marca los clientes fuera de las plazas activas (cartera por encima del cupo).
async function withSeatFlags(trainerId, clients) {
  const state = await trainerSeatService.seatState(trainerId);
  if (!state.overLimit) return clients;
  return clients.map((client) => ({ ...client,
    readOnly: Boolean(client.user?._id) && !state.active.has(String(client.user._id)) }));
}

// Listas que cambian por acción del propio usuario: nunca desde caché
// condicional (un 304 sin cuerpo se veía como una lista vacía).
function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}

module.exports = {
  // --- Lado profesional ---

  // POST /trainer/invites — { clientEmail, scopes: [...] }
  async inviteClient(req, res) {
    const { clientEmail, scopes } = req.body || {};
    const results = await trainerClientService.inviteClient(req.auth.userId, req.user, clientEmail, scopes);
    return res.status(results.some((r) => r.success) ? 201 : 400).send({
      results: results.map((r) => ({
        scope: r.scope,
        success: r.success,
        error: r.error || null,
        invitation: r.invitation || null,
      })),
    });
  },

  // GET /trainer/clients/check-email?email=...
  async checkClientEmailStatus(req, res) {
    return res.send(await trainerClientService.checkClientEmailStatus(req.auth.userId, req.query.email));
  },

  // GET /trainer/invites
  async listInvitesByTrainer(req, res) {
    return noStore(res).send(await trainerClientService.listInvitesByTrainer(req.auth.userId));
  },

  // DELETE /trainer/invites/:id
  async cancelInvite(req, res) {
    const invitation = await trainerClientService.cancelInvite(req.auth.userId, req.params.id);
    if (!invitation) return res.sendStatus(404);
    return res.send(invitation);
  },

  // GET /trainer/clients — clientes en curso, uno por persona con sus scopes.
  async listMyClients(req, res) {
    const clients = await trainerClientService.listActiveClientsForTrainer(req.auth.userId);
    return res.send(await withSeatFlags(req.auth.userId, trainerClientDto.summaries(clients)));
  },

  // GET /trainer/clients/lifetime-count — clientes distintos que alguna vez
  // estuvieron activos ("Mi cuenta" > Número de cambios).
  async getLifetimeClientsCount(req, res) {
    return res.send({ total: await trainerClientService.countLifetimeClients(req.auth.userId) });
  },

  // DELETE /trainer/clients/:clientId?scope=training|nutrition
  async revokeByTrainer(req, res) {
    const invitation = await trainerClientService.revokeByTrainer(req.auth.userId, req.params.clientId, req.query.scope);
    if (!invitation) return res.sendStatus(404);
    return res.send(invitation);
  },

  // GET /trainer/clients/:clientId/intake — null si aún no hay cuestionario.
  async getClientIntake(req, res) {
    return res.send(await trainerClientService.getIntakeWithAnswers(req.auth.userId, req.params.clientId));
  },

  // PUT /trainer/clients/:clientId/intake — el profesional corrige las respuestas.
  async updateClientIntake(req, res) {
    return res.send(await trainerClientService.updateIntake(req.auth.userId, req.params.clientId, req.body || {}));
  },

  // GET /trainer/clients/:clientId/intake/status — { status }: "pending" |
  // "submitted" | "reviewed" | null. Con los dos primeros la app no abre la
  // ficha hasta revisarlo.
  async getClientIntakeStatus(req, res) {
    const status = await trainerClientService.getIntakeStatus(req.auth.userId, req.params.clientId);
    return noStore(res).send({ status });
  },

  // POST /trainer/clients/:clientId/intake/reviewed
  async markIntakeReviewed(req, res) {
    return res.send(await trainerClientService.markIntakeReviewed(req.auth.userId, req.params.clientId));
  },

  // GET /trainer/seats — plazas activas cuando la cartera supera el cupo del plan.
  async getSeats(req, res) {
    return noStore(res).send(await trainerSeatService.listSeats(req.auth.userId));
  },

  // PUT /trainer/seats { clientIds } — el profesional elige qué clientes siguen activos.
  async updateSeats(req, res) {
    return res.send(await trainerSeatService.setSeats(req.auth.userId, req.body?.clientIds));
  },

  // --- Lado cliente ---

  // GET /trainer/invites/mine
  async listInvitesMine(req, res) {
    return noStore(res).send(await trainerClientService.listPendingForClient(req.auth.email));
  },

  // POST /trainer/invites/:id/accept
  async acceptInvite(req, res) {
    const invitation = await trainerClientService.respondToInvite(req.params.id, req.user, "accept");
    if (!invitation) return res.sendStatus(404);
    return res.send(invitation);
  },

  // POST /trainer/invites/:id/decline
  async declineInvite(req, res) {
    const invitation = await trainerClientService.respondToInvite(req.params.id, req.user, "decline");
    if (!invitation) return res.sendStatus(404);
    return res.send(invitation);
  },

  // GET /trainer/info — profesionales en curso del cliente, uno por persona.
  async listMyProfessionals(req, res) {
    const professionals = await trainerClientService.listActiveProfessionalsForClient(req.auth.userId);
    return res.send(trainerClientDto.summaries(professionals));
  },

  // DELETE /trainer/link/:scope
  async revokeByClient(req, res) {
    const invitation = await trainerClientService.revokeByClient(req.auth.userId, req.params.scope);
    if (!invitation) return res.sendStatus(404);
    return res.send(invitation);
  },

  // GET /trainer/history (profesional) o ?asClient=1 (cliente): relaciones
  // terminadas e invitaciones rechazadas.
  async listHistory(req, res) {
    if (req.query.asClient) {
      return res.send(await trainerClientService.listHistoryByClient(req.auth.userId, req.auth.email));
    }
    return res.send(await trainerClientService.listHistoryByTrainer(req.auth.userId));
  },

  // GET /trainer/onboarding-status — el cuestionario de alta de cada
  // profesional en curso del cliente.
  async getOnboardingStatus(req, res) {
    return noStore(res).send(await trainerClientService.getOnboardingStatus(req.auth.userId));
  },

  // GET /trainer/intake/:trainerId — lo que el cliente ya respondió a ese
  // profesional, para precargar el formulario (null si nunca lo rellenó).
  async getMyIntake(req, res) {
    return res.send(await trainerClientService.getOwnIntake(req.auth.userId, req.params.trainerId));
  },

  // POST /trainer/intake — { trainerId, ...respuestas } el cliente envía su cuestionario.
  async submitIntake(req, res) {
    const { trainerId, ...intakeData } = req.body || {};
    if (!trainerId) return res.status(400).send({ message: "trainerId es obligatorio" });
    return res.status(201).send(await trainerClientService.submitIntake(trainerId, req.auth.userId, intakeData));
  },
};
