const trainerClientService = require("./trainer-client-service");
const trainerClientDto = require("./trainer-client-dto");
const trainerClientDao = require("./trainer-client-dao");
const clientIntakeDao = require("../clientIntake/client-intake-dao");

function handleKnownError(res, e) {
  if (e.code === "OVERLAP" || e.code === "DUPLICATE_INVITE" || e.code === "NOT_A_USER_ACCOUNT") {
    return res.status(400).send({ message: e.message, code: e.code });
  }
  if (e.code === "TRAINER_LIMIT_REACHED") {
    return res.status(403).send({ message: e.message, code: e.code });
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

  // GET /trainer/clients/paginated?page=&limit=&search=
  // TASK-022 (MASTER_BACKLOG.md) — variante paginada para la lista "Clientes"
  // del trainer. Ruta nueva y aditiva: no sustituye a listMyClients, que
  // otros 5 consumidores del frontend (dashboard, select-clients-modal,
  // client-detail fallback, checkin-templates) siguen usando tal cual
  // porque genuinamente necesitan la lista completa.
  async listMyClientsPaginated(req, res) {
    const page = parseInt((req.query.page || "0").toString(), 10);
    const limit = parseInt((req.query.limit || "20").toString(), 10);
    const search = req.query.search || "";

    const result = await trainerClientService.listActiveClientsForTrainerPaginated(req.auth.userId, {
      page,
      limit,
      search,
    });

    return res.send({
      clients: trainerClientDto.multipleAggregated(result.clients),
      total: result.total,
    });
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
    if (req.query.asClient) {
      const relations = await trainerClientService.listHistoryByClient(req.auth.userId);
      return res.send(trainerClientDto.multipleWithTrainer(relations));
    }
    const relations = await trainerClientService.listHistoryByTrainer(req.auth.userId);
    return res.send(trainerClientDto.multiple(relations));
  },

  // --- TAREA 3: cuestionario inicial + confirmación ---

  // GET /trainer/onboarding-status — cliente: ¿debe ver la pantalla de estado
  // (cuestionario/en revisión) en vez del resto de la app?
  async getOnboardingStatus(req, res) {
    const status = await trainerClientService.getOnboardingStatus(req.auth.userId);
    return res.send(status);
  },

  // POST /trainer/intake — cliente envía su cuestionario inicial para un
  // profesional concreto. body: { trainerId, goals, healthConditions,
  // experienceLevel, availability, equipment, allergies, favoriteFoods,
  // dislikedFoods, cooksAtHome }
  async submitIntake(req, res) {
    try {
      const { trainerId, ...intakeData } = req.body || {};
      if (!trainerId) return res.status(400).send({ message: "trainerId es obligatorio" });
      const intake = await trainerClientService.submitIntake(trainerId, req.auth.userId, intakeData);
      return res.status(201).send(intake);
    } catch (e) {
      if (e.code === "NO_INTAKE_PENDING") {
        return res.status(400).send({ message: e.message, code: e.code });
      }
      console.error("Error en submitIntake:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/clients/:clientId/intake — el profesional revisa el
  // cuestionario. NO usa requireActiveClient a propósito: la relación está
  // en "en_revision" (aún no "active") justo cuando hace falta revisarla.
  async getClientIntake(req, res) {
    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;
    const relations = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "en_revision",
      "active",
    ]);
    if (!relations.length) {
      return res.status(403).send({
        message: "No tienes una relación con este cliente que permita ver su cuestionario",
      });
    }
    const intake = await clientIntakeDao.getByTrainerAndClient(trainerId, clientId);
    return res.send(intake);
  },

  // POST /trainer/clients/:clientId/confirm — el profesional confirma
  // explícitamente al cliente tras revisar su cuestionario.
  async confirmClient(req, res) {
    try {
      const result = await trainerClientService.confirmClient(req.auth.userId, req.params.clientId);
      return res.send(trainerClientDto.multiple(result));
    } catch (e) {
      if (e.code === "NO_INTAKE_IN_REVIEW") {
        return res.status(400).send({ message: e.message, code: e.code });
      }
      console.error("Error en confirmClient:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },
};

module.exports = controller;
