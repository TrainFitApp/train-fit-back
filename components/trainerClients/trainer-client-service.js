const trainerClientDao = require("./trainer-client-dao");
const clientIntakeDao = require("../clientIntake/client-intake-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const {
  RELATION_FIELD_KEYS,
  SHARED_FIELD_KEYS,
} = require("../clientIntake/intake-field-catalog");
const { normalizeEmail } = require("../util/normalize-email");
const mail = require("../util/mail");
const notificationService = require("../notifications/notification-service");
const userSchema = require("../users/schema");
const featureAccessService = require("../billing/feature-access-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const NON_TERMINAL_STATUSES = [
  "pending",
  "cuestionario_pendiente",
  "en_revision",
  "active",
];

// Fire-and-forget: un fallo de envío no debe impedir que la invitación se
// cree (mismo criterio que notifyUserRegistered en components/util/mail.js).
// El invitado es un CLIENTE: necesita la app de consumidor (com.trainfit.trainfit),
// no la de trainers — ahí es donde se acepta la invitación (ver
// apps/train-fit-front/src/app/features/coach-invites).
function notifyInvite(clientEmail, trainerName, scope) {
  const scopeLabel = scope === "training" ? "entrenamiento" : "nutrición";
  const header = `${trainerName || "Un entrenador"} te ha invitado a TrainFit`;
  const description = `${
    trainerName || "Un entrenador"
  } quiere gestionar tu ${scopeLabel} en TrainFit. Descarga la app TrainFit e inicia sesión (o crea una cuenta con este mismo email) para aceptar o rechazar la invitación desde "Mis entrenadores".`;

  mail
    .sendMailSES(
      clientEmail,
      "Invitación de entrenador - TrainFit",
      mail.generateNotificationMail(header, description, [
        {
          href: "https://apps.apple.com/es/app/trainfit-gym-dieta-y-entreno/id6471257280",
          label: "Descargar para iOS",
        },
        {
          href: "https://play.google.com/store/apps/details?id=com.trainfit.trainfit&pcampaignid=web_share",
          label: "Descargar para Android",
        },
      ])
    )
    .catch((error) => {
      console.error("[TRAINER_CLIENTS] invite_email_failed", {
        clientEmail,
        message: error?.message,
      });
    });
}

module.exports = {
  async invite(trainerId, { email, scope, trainerName }) {
    const clientEmail = normalizeEmail(email);
    if (!clientEmail) {
      throw makeError(400, "EMAIL_REQUIRED", "Email requerido");
    }
    if (!["training", "nutrition"].includes(scope)) {
      throw makeError(400, "INVALID_SCOPE", "Ámbito inválido");
    }

    const existing = await trainerClientDao.findOneNonTerminal(
      trainerId,
      clientEmail,
      scope
    );
    if (existing) {
      throw makeError(
        409,
        "INVITE_ALREADY_EXISTS",
        "Ya existe una invitación activa para este email y ámbito"
      );
    }

    // Funcionalidad 16 — el límite es de CLIENTES gestionados, no de
    // invitaciones/ámbitos: añadir un segundo scope a un cliente que ya
    // tienes no consume capacidad nueva.
    const existingAnyScope =
      (await trainerClientDao.findOneNonTerminal(trainerId, clientEmail, "training")) ||
      (await trainerClientDao.findOneNonTerminal(trainerId, clientEmail, "nutrition"));
    if (!existingAnyScope) {
      const trainer = await userSchema.findById(trainerId).select("professionalPremium");
      const activeCount = await trainerClientDao.countActiveUniqueClients(trainerId);
      if (!featureAccessService.canInviteClient(trainer, activeCount)) {
        throw makeError(
          403,
          "TRAINER_CLIENT_LIMIT_REACHED",
          "Has alcanzado el límite de clientes de tu plan actual"
        );
      }
    }

    const invite = await trainerClientDao.create({
      trainerId,
      clientEmail,
      scope,
      status: "pending",
    });

    notifyInvite(clientEmail, trainerName, scope);

    return invite;
  },

  async listMyInvites(trainerId) {
    return trainerClientDao.findMyInvites(trainerId);
  },

  async cancelInvite(trainerId, inviteId) {
    const invite = await trainerClientDao.findById(inviteId);
    if (!invite || String(invite.trainerId) !== String(trainerId)) {
      throw makeError(404, "INVITE_NOT_FOUND", "Invitación no encontrada");
    }
    if (!invite.status || invite.status === "revoked" || invite.status === "declined") {
      throw makeError(409, "INVITE_NOT_CANCELABLE", "Esta invitación ya no está activa");
    }

    return trainerClientDao.updateStatus(inviteId, "revoked", {
      revokedAt: new Date(),
      revokedBy: "trainer",
    });
  },

  async listMyClients(trainerId, { page = 1, limit = 20, search, scope } = {}) {
    const { items, total } = await trainerClientDao.findByTrainerPaginated(
      trainerId,
      { page: Number(page), limit: Number(limit), search, scope }
    );

    const filtered = search
      ? items.filter((item) => {
          const needle = String(search).toLowerCase();
          const client = item.clientId || {};
          return (
            String(client.name || "").toLowerCase().includes(needle) ||
            String(client.lastname || "").toLowerCase().includes(needle) ||
            String(client.email || "").toLowerCase().includes(needle)
          );
        })
      : items;

    return { items: filtered, total, page: Number(page), limit: Number(limit) };
  },

  async listInvitesForClient(clientUser) {
    return trainerClientDao.findRelevantForClient(
      normalizeEmail(clientUser.email),
      clientUser.id
    );
  },

  async acceptInvite(clientUser, inviteId) {
    const invite = await trainerClientDao.findById(inviteId);
    if (!invite || invite.status !== "pending") {
      throw makeError(404, "INVITE_NOT_FOUND", "Invitación no encontrada");
    }
    if (invite.clientEmail !== normalizeEmail(clientUser.email)) {
      throw makeError(403, "INVITE_NOT_YOURS", "Esta invitación no es para tu cuenta");
    }

    return trainerClientDao.updateStatus(inviteId, "cuestionario_pendiente", {
      clientId: clientUser.id,
      respondedAt: new Date(),
    });
  },

  async declineInvite(clientUser, inviteId) {
    const invite = await trainerClientDao.findById(inviteId);
    if (!invite || invite.status !== "pending") {
      throw makeError(404, "INVITE_NOT_FOUND", "Invitación no encontrada");
    }
    if (invite.clientEmail !== normalizeEmail(clientUser.email)) {
      throw makeError(403, "INVITE_NOT_YOURS", "Esta invitación no es para tu cuenta");
    }

    return trainerClientDao.updateStatus(inviteId, "declined", {
      respondedAt: new Date(),
    });
  },

  async revoke(actorUser, actorRole, trainerClientId) {
    const relation = await trainerClientDao.findById(trainerClientId);
    if (!relation) {
      throw makeError(404, "RELATION_NOT_FOUND", "Relación no encontrada");
    }

    const isTrainerSide =
      actorRole === "trainer" && String(relation.trainerId) === String(actorUser.id);
    const isClientSide =
      actorRole === "client" && String(relation.clientId) === String(actorUser.id);
    if (!isTrainerSide && !isClientSide) {
      throw makeError(403, "NOT_YOUR_RELATION", "No puedes modificar esta relación");
    }
    if (!NON_TERMINAL_STATUSES.includes(relation.status)) {
      throw makeError(409, "RELATION_NOT_ACTIVE", "Esta relación no está activa");
    }

    return trainerClientDao.updateStatus(trainerClientId, "revoked", {
      revokedAt: new Date(),
      revokedBy: actorRole,
    });
  },

  // Vuelve directo a active (se conservan las respuestas de intake ya
  // guardadas, no hay que repetir el cuestionario). Si mientras tanto el
  // trainer reinvitó al mismo email+scope, el índice único parcial choca en
  // el update: se traduce a un 409 legible en vez de un 500 de Mongo.
  async reactivateRelation(trainerId, trainerClientId) {
    const relation = await trainerClientDao.findById(trainerClientId);
    if (!relation || String(relation.trainerId) !== String(trainerId)) {
      throw makeError(404, "RELATION_NOT_FOUND", "Relación no encontrada");
    }
    if (relation.status !== "revoked") {
      throw makeError(409, "RELATION_NOT_REVOKED", "Esta relación no está revocada");
    }

    try {
      return await trainerClientDao.updateStatus(trainerClientId, "active", {
        revokedAt: null,
        revokedBy: null,
      });
    } catch (error) {
      if (error?.code === 11000) {
        throw makeError(
          409,
          "RELATION_CONFLICT",
          "Ya existe una relación activa o pendiente con este cliente en este ámbito"
        );
      }
      throw error;
    }
  },

  // Cuestionario: el cliente lo responde una vez por trainer (no por ámbito).
  // Los campos "relation" se guardan en ClientIntake; los "shared" (alergias,
  // etc.) se escriben en el perfil global de preferencias nutricionales.
  async submitIntake(clientUser, trainerId, payload) {
    const pending = await trainerClientDao.findPendingIntakeByTrainerAndClient(
      trainerId,
      clientUser.id
    );
    if (pending.length === 0) {
      throw makeError(
        409,
        "NO_PENDING_INTAKE",
        "No hay ningún cuestionario pendiente con este trainer"
      );
    }

    const relationFields = {};
    RELATION_FIELD_KEYS.forEach((key) => {
      if (payload[key] !== undefined) relationFields[key] = payload[key];
    });
    const sharedFields = {};
    SHARED_FIELD_KEYS.forEach((key) => {
      if (payload[key] !== undefined) sharedFields[key] = payload[key];
    });

    await clientIntakeDao.upsert(trainerId, clientUser.id, relationFields);
    if (Object.keys(sharedFields).length > 0) {
      await nutritionPreferencesDao.upsertSharedFields(clientUser.id, sharedFields);
    }

    await trainerClientDao.updateManyStatus(
      { trainerId, clientId: clientUser.id, status: "cuestionario_pendiente" },
      "en_revision",
      { respondedAt: new Date() }
    );

    notificationService.notifyTrainer(trainerId, clientUser.id, "intake_submitted", "TrainerClient", null);

    return { submitted: true };
  },

  // Vista combinada para que el trainer revise: campos de relación +
  // preferencias compartidas del cliente.
  async getIntakeForReview(trainerId, clientId) {
    const [relationAnswers, sharedAnswers] = await Promise.all([
      clientIntakeDao.findByTrainerAndClient(trainerId, clientId),
      nutritionPreferencesDao.findByClientId(clientId),
    ]);

    return {
      goals: relationAnswers?.goals || null,
      healthConditions: relationAnswers?.healthConditions || null,
      experienceLevel: relationAnswers?.experienceLevel || null,
      availability: relationAnswers?.availability || null,
      equipment: relationAnswers?.equipment || null,
      allergies: sharedAnswers?.allergies || null,
      favoriteFoods: sharedAnswers?.favoriteFoods || null,
      dislikedFoods: sharedAnswers?.dislikedFoods || null,
      cooksAtHome: sharedAnswers?.cooksAtHome || null,
    };
  },

  async confirmClient(trainerId, clientId) {
    const awaitingReview = await trainerClientDao.findAwaitingReviewByTrainerAndClient(
      trainerId,
      clientId
    );
    if (awaitingReview.length === 0) {
      throw makeError(
        409,
        "NOTHING_TO_CONFIRM",
        "No hay ningún cuestionario pendiente de revisión para este cliente"
      );
    }

    await trainerClientDao.updateManyStatus(
      { trainerId, clientId, status: "en_revision" },
      "active"
    );

    notificationService.notifyClient(clientId, trainerId, "intake_confirmed", "TrainerClient", null);

    return { confirmed: true };
  },

  // --- Notas (funcionalidad 11) ---

  async requireOwnedRelation(trainerId, relationId) {
    const relation = await trainerClientDao.findById(relationId);
    if (!relation || String(relation.trainerId) !== String(trainerId)) {
      throw makeError(404, "RELATION_NOT_FOUND", "Relación no encontrada");
    }
    return relation;
  },

  async addNote(trainerId, relationId, { text, pinned }) {
    await this.requireOwnedRelation(trainerId, relationId);
    if (!text || !text.trim()) {
      throw makeError(400, "TEXT_REQUIRED", "El texto es obligatorio");
    }
    return trainerClientDao.addNote(relationId, { text: text.trim(), pinned: !!pinned });
  },

  async updateNote(trainerId, relationId, noteId, updates) {
    await this.requireOwnedRelation(trainerId, relationId);
    return trainerClientDao.updateNote(relationId, noteId, updates);
  },

  async removeNote(trainerId, relationId, noteId) {
    await this.requireOwnedRelation(trainerId, relationId);
    return trainerClientDao.removeNote(relationId, noteId);
  },

  // --- Cobros (funcionalidad 12) ---

  async addPayment(trainerId, relationId, { amount, currency, dueDate, note }) {
    const relation = await this.requireOwnedRelation(trainerId, relationId);
    if (!amount || amount <= 0) {
      throw makeError(400, "AMOUNT_REQUIRED", "El importe debe ser mayor que 0");
    }
    if (relation.clientId) {
      notificationService.notifyClient(relation.clientId, trainerId, "payment_created", "TrainerClient", relationId);
    }
    return trainerClientDao.addPayment(relationId, {
      amount,
      currency: currency || "EUR",
      dueDate: dueDate || null,
      note,
    });
  },

  async markPaymentPaid(trainerId, relationId, paymentId) {
    await this.requireOwnedRelation(trainerId, relationId);
    return trainerClientDao.updatePayment(relationId, paymentId, { paidAt: new Date() });
  },

  async removePayment(trainerId, relationId, paymentId) {
    await this.requireOwnedRelation(trainerId, relationId);
    return trainerClientDao.removePayment(relationId, paymentId);
  },
};
