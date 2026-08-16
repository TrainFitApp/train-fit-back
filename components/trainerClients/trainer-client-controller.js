const trainerClientService = require("./trainer-client-service");
const trainerClientDao = require("./trainer-client-dao");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({
      message: error.message,
      code: error.code,
    });
  }
  console.error("[TRAINER_CLIENTS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async invite(req, res) {
    try {
      const invite = await trainerClientService.invite(req.user.id, {
        email: req.body?.email,
        scope: req.body?.scope,
        trainerName: `${req.user.name || ""} ${req.user.lastname || ""}`.trim(),
      });
      return res.status(201).send(invite);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async listMyInvites(req, res) {
    const invites = await trainerClientService.listMyInvites(req.user.id);
    return res.send(invites);
  },

  async cancelInvite(req, res) {
    try {
      const invite = await trainerClientService.cancelInvite(
        req.user.id,
        req.params.id
      );
      return res.send(invite);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async listMyClients(req, res) {
    const result = await trainerClientService.listMyClients(req.user.id, {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      scope: req.query.scope,
    });
    return res.send(result);
  },

  async getClientSummary(req, res) {
    const relations = await trainerClientDao.findActiveByTrainerAndClientAnyScope(
      req.user.id,
      req.params.clientId
    );
    if (relations.length === 0) {
      return res.status(404).send({ message: "Cliente no encontrado" });
    }

    const client = relations[0].clientId;
    return res.send({
      client,
      scopes: relations.map((relation) => relation.scope),
      // Funcionalidades 11/12/13 — necesitan el id de la relación concreta
      // (notas/cobros/tareas viven ahí, no en el cliente).
      relations: relations.map((relation) => ({
        _id: relation._id,
        scope: relation.scope,
        notes: relation.notes || [],
        payments: relation.payments || [],
      })),
    });
  },

  // Un mismo endpoint para trainer y cliente: los roles son mutuamente
  // excluyentes (ver docs/trainfit-trainers/05-especificaciones-acordadas.md,
  // funcionalidad 1), así que req.user.roles determina sin ambigüedad desde
  // qué lado se está revocando.
  async revoke(req, res) {
    try {
      const actorRole = (req.user.roles || []).includes("trainer")
        ? "trainer"
        : "client";
      const relation = await trainerClientService.revoke(
        req.user,
        actorRole,
        req.params.id
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async reactivateClient(req, res) {
    try {
      const relation = await trainerClientService.reactivateRelation(
        req.user.id,
        req.params.id
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getClientIntake(req, res) {
    const intake = await trainerClientService.getIntakeForReview(
      req.user.id,
      req.params.clientId
    );
    return res.send(intake);
  },

  async confirmClient(req, res) {
    try {
      const result = await trainerClientService.confirmClient(
        req.user.id,
        req.params.clientId
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Lado cliente ---

  async listInvitesForMe(req, res) {
    const invites = await trainerClientService.listInvitesForClient(req.user);
    return res.send(invites);
  },

  async acceptInvite(req, res) {
    try {
      const invite = await trainerClientService.acceptInvite(
        req.user,
        req.params.id
      );
      return res.send(invite);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async declineInvite(req, res) {
    try {
      const invite = await trainerClientService.declineInvite(
        req.user,
        req.params.id
      );
      return res.send(invite);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async submitIntake(req, res) {
    try {
      const result = await trainerClientService.submitIntake(
        req.user,
        req.params.trainerId,
        req.body || {}
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Notas (funcionalidad 11) ---

  async addNote(req, res) {
    try {
      const relation = await trainerClientService.addNote(
        req.user.id,
        req.params.id,
        req.body || {}
      );
      return res.status(201).send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateNote(req, res) {
    try {
      const relation = await trainerClientService.updateNote(
        req.user.id,
        req.params.id,
        req.params.noteId,
        req.body || {}
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async removeNote(req, res) {
    try {
      const relation = await trainerClientService.removeNote(
        req.user.id,
        req.params.id,
        req.params.noteId
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Cobros (funcionalidad 12) ---

  async addPayment(req, res) {
    try {
      const relation = await trainerClientService.addPayment(
        req.user.id,
        req.params.id,
        req.body || {}
      );
      return res.status(201).send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async markPaymentPaid(req, res) {
    try {
      const relation = await trainerClientService.markPaymentPaid(
        req.user.id,
        req.params.id,
        req.params.paymentId
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async removePayment(req, res) {
    try {
      const relation = await trainerClientService.removePayment(
        req.user.id,
        req.params.id,
        req.params.paymentId
      );
      return res.send(relation);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
