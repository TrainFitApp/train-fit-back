const trainerClientService = require("./trainer-client-service");
const trainerClientDto = require("./trainer-client-dto");

function handleKnownError(res, e) {
  if (e.code === "OVERLAP" || e.code === "DUPLICATE_INVITE" || e.code === "NOT_A_USER_ACCOUNT") {
    return res.status(400).send({ message: e.message, code: e.code });
  }
  if (e.code === "FORBIDDEN") {
    return res.status(403).send({ message: e.message });
  }
  return null;
}

const controller = {
  // POST /trainer/invites — { clientEmail, scopes: [...] }
  async inviteClient(req, res) {
    try {
      const { clientEmail, scopes } = req.body;
      const results = await trainerClientService.inviteClient(
        req.auth.userId,
        req.user,
        clientEmail,
        Array.isArray(scopes) ? scopes : [scopes]
      );
      const anySuccess = results.some((r) => r.success);
      return res.status(anySuccess ? 201 : 400).send({
        results: results.map((r) => ({
          scope: r.scope,
          success: r.success,
          error: r.error || null,
          relation: r.relation ? trainerClientDto.single(r.relation) : null,
        })),
      });
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en inviteClient:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/invites
  async listInvitesByTrainer(req, res) {
    const invites = await trainerClientService.listInvitesByTrainer(req.auth.userId);
    return res.send(trainerClientDto.multiple(invites));
  },

  // DELETE /trainer/invites/:id
  async cancelInvite(req, res) {
    const result = await trainerClientService.cancelInvite(req.auth.userId, req.params.id);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // GET /trainer/invites/mine
  async listInvitesMine(req, res) {
    const invites = await trainerClientService.listPendingForClientEmailEnriched(req.auth.email);
    return res.send(trainerClientDto.multipleWithTrainer(invites));
  },

  // POST /trainer/invites/:id/accept
  async acceptInvite(req, res) {
    try {
      const result = await trainerClientService.respondToInvite(req.params.id, req.user, "accept");
      if (!result) return res.sendStatus(404);
      return res.send(trainerClientDto.single(result));
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en acceptInvite:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // POST /trainer/invites/:id/decline
  async declineInvite(req, res) {
    try {
      const result = await trainerClientService.respondToInvite(req.params.id, req.user, "decline");
      if (!result) return res.sendStatus(404);
      return res.send(trainerClientDto.single(result));
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en declineInvite:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/info — profesionales activos del cliente autenticado,
  // agregados por profesional (mismo patrón que F05 del lado trainer).
  async listMyProfessionals(req, res) {
    const aggregatedProfessionals = await trainerClientService.listActiveProfessionalsForClient(
      req.auth.userId
    );
    return res.send(trainerClientDto.multipleAggregated(aggregatedProfessionals));
  },

  // GET /trainer/clients — clientes activos del profesional, agregados por cliente
  async listMyClients(req, res) {
    const aggregated = await trainerClientService.listActiveClientsForTrainer(req.auth.userId);
    return res.send(trainerClientDto.multipleAggregated(aggregated));
  },

  // DELETE /trainer/clients/:clientId?scope=training|nutrition
  async revokeByTrainer(req, res) {
    const { scope } = req.query;
    if (!scope) return res.status(400).send({ message: "scope es obligatorio" });
    const result = await trainerClientService.revokeByTrainer(req.auth.userId, req.params.clientId, scope);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // DELETE /trainer/link/:scope
  async revokeByClient(req, res) {
    const result = await trainerClientService.revokeByClient(req.auth.userId, req.params.scope);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // GET /trainer/history (profesional) o ?asClient=1 (cliente) — historial revoked/declined
  async listHistory(req, res) {
    const relations = req.query.asClient
      ? await trainerClientService.listHistoryByClient(req.auth.userId)
      : await trainerClientService.listHistoryByTrainer(req.auth.userId);
    return res.send(trainerClientDto.multiple(relations));
  },
};

module.exports = controller;
