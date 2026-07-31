const trainerClientDao = require("./trainer-client-dao");
const userSchema = require("../users/schema");
const mail = require("../util/mail");
const tableService = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDayService = require("../dietDays/diet-days-service");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");

const VALID_SCOPES = ["training", "nutrition"];

class OverlapError extends Error {
  constructor(scope) {
    super(`Este cliente ya tiene un profesional de tipo "${scope}"`);
    this.code = "OVERLAP";
    this.scope = scope;
  }
}

class NonUserAccountError extends Error {
  constructor() {
    super("Este email no corresponde a una cuenta de cliente de TrainFit");
    this.code = "NOT_A_USER_ACCOUNT";
  }
}

class DuplicateInviteError extends Error {
  constructor(scope) {
    super(`Ya existe una invitación pendiente para este email en el ámbito "${scope}"`);
    this.code = "DUPLICATE_INVITE";
    this.scope = scope;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function sendInviteMail(trainerUser, clientEmail, scopes) {
  const scopeLabels = scopes.map((s) => (s === "training" ? "Entrenamiento" : "Nutrición")).join(" y ");
  const trainerName = [trainerUser.name, trainerUser.lastname].filter(Boolean).join(" ") || "Un profesional";
  const html = mail.generateMail(
    "Tienes una invitación",
    `${trainerName} te ha invitado a TrainFit para llevar tu ${scopeLabels}. Abre la app para aceptarla o rechazarla.`,
    "https://trainfit.net",
    "Abrir TrainFit"
  );
  try {
    await mail.sendMailSES(clientEmail, `${trainerName} te ha invitado en TrainFit`, html);
  } catch (e) {
    // No bloquear la creación de la invitación por un fallo de envío de email —
    // la invitación ya existe en BBDD y es visible igualmente al abrir la app.
    console.error("Error enviando email de invitación:", e.message);
  }
}

module.exports = {
  VALID_SCOPES,
  OverlapError,
  NonUserAccountError,
  DuplicateInviteError,

  /**
   * Invita a un cliente para uno o varios scopes a la vez. Crea UN documento
   * TrainerClient por scope — nunca un único documento "both" (ver
   * modelos-de-datos/01-trainerclient.md). Devuelve un resultado por scope,
   * nunca todo-o-nada: un scope con conflicto no bloquea al otro.
   */
  async inviteClient(trainerId, trainerUser, clientEmailRaw, scopes) {
    const clientEmail = normalizeEmail(clientEmailRaw);

    if (normalizeEmail(trainerUser.email) === clientEmail) {
      throw new Error("No puedes invitarte a ti mismo");
    }

    const uniqueScopes = [...new Set(scopes)].filter((s) => VALID_SCOPES.includes(s));
    if (!uniqueScopes.length) {
      throw new Error("Debes indicar al menos un scope válido (training/nutrition)");
    }

    // D6: si el email ya pertenece a un User existente, debe tener roles: "user".
    // Si no existe ninguna cuenta todavía, se permite (queda vinculado solo por email).
    const existingUser = await userSchema.findOne({ email: clientEmail }).lean();
    if (existingUser && !(existingUser.roles || []).includes("user")) {
      throw new NonUserAccountError();
    }

    const results = [];
    for (const scope of uniqueScopes) {
      try {
        const overlapping = await trainerClientDao.findOverlapping({
          clientEmail,
          clientId: existingUser?._id,
          scope,
          excludingTrainerId: trainerId,
        });
        if (overlapping) throw new OverlapError(scope);

        const created = await trainerClientDao.create({ trainerId, clientEmail, scope });
        results.push({ scope, success: true, relation: created });
      } catch (e) {
        if (e.code === 11000) {
          results.push({ scope, success: false, error: new DuplicateInviteError(scope).message });
        } else if (e instanceof OverlapError) {
          results.push({ scope, success: false, error: e.message });
        } else {
          throw e;
        }
      }
    }

    const created = results.filter((r) => r.success);
    if (created.length) {
      await sendInviteMail(trainerUser, clientEmail, created.map((r) => r.scope));
    }

    return results;
  },

  async listInvitesByTrainer(trainerId) {
    return trainerClientDao.findAllByTrainer(trainerId);
  },

  async cancelInvite(trainerId, inviteId) {
    const invite = await trainerClientDao.findById(inviteId);
    if (!invite || String(invite.trainerId) !== String(trainerId)) return null;
    if (invite.status !== "pending") return invite; // idempotente, nada que cancelar
    return trainerClientDao.updateStatus(inviteId, "declined", { revokedBy: "trainer", revokedAt: new Date() });
  },

  async listPendingForClientEmail(email) {
    return trainerClientDao.findPendingByEmail(normalizeEmail(email));
  },

  /**
   * decision: "accept" | "decline". clientUser es el User autenticado que responde.
   */
  async respondToInvite(invitationId, clientUser, decision) {
    const invitation = await trainerClientDao.findById(invitationId);
    if (!invitation) return null;

    if (normalizeEmail(invitation.clientEmail) !== normalizeEmail(clientUser.email)) {
      const err = new Error("Esta invitación no está dirigida a tu cuenta");
      err.code = "FORBIDDEN";
      throw err;
    }

    if (invitation.status !== "pending") {
      return invitation; // idempotente — ya respondida o revocada
    }

    if (decision === "decline") {
      return trainerClientDao.updateStatus(invitation._id, "declined", { respondedAt: new Date() });
    }

    // decision === "accept": re-validar solapamiento, puede haber cambiado.
    const overlapping = await trainerClientDao.findOverlapping({
      clientEmail: invitation.clientEmail,
      clientId: clientUser._id,
      scope: invitation.scope,
      excludingTrainerId: invitation.trainerId,
    });
    if (overlapping) throw new OverlapError(invitation.scope);

    return trainerClientDao.updateStatus(invitation._id, "active", {
      clientId: clientUser._id,
      respondedAt: new Date(),
    });
  },

  async listActiveForClient(clientId) {
    return trainerClientDao.findActiveByClient(clientId);
  },

  async listActiveClientsForTrainer(trainerId) {
    const relations = await trainerClientDao.findAllByTrainer(trainerId, { status: "active" });
    return aggregateByOtherParty(relations, "clientId");
  },

  async getClientTables(clientId, page = 0, limit = 20) {
    const client = await userSchema.findById(clientId).select("tableInUse").lean();
    const [tables, activeTableDocument] = await Promise.all([
      tableService.getTables(page, limit, true, clientId),
      client?.tableInUse ? tableService.getTableById(client.tableInUse) : null,
    ]);
    const activeTable =
      activeTableDocument && String(activeTableDocument.userId) === String(clientId)
        ? activeTableDocument
        : null;

    return {
      tableInUse: client?.tableInUse || null,
      activeTable,
      tables,
    };
  },

  async getClientAnthropometries(clientId, limit = 12) {
    const anthropometries = await anthropometryService.getAllAnthropometriesByUserId(clientId);
    return anthropometries.slice(0, limit);
  },

  async getClientWorkoutHistory(clientId, limit = 20) {
    const tables = await tableService.getTables(0, 100, true, clientId);
    const completed = [];

    for (const tableDocument of tables) {
      const table = tableDocument.toObject ? tableDocument.toObject() : tableDocument;
      for (const split of table.splits || []) {
        for (const workout of split.workouts || []) {
          if (!workout.date) continue;
          completed.push({
            ...workout,
            table: { _id: table._id, name: table.name },
            split: { _id: split._id, name: split.name },
          });
        }
      }
    }

    return completed
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  },

  async getClientDiet(clientId, date) {
    const client = await userSchema.findById(clientId).select("dietInUse").lean();
    if (!client?.dietInUse) {
      return { dietInUse: null, dietDay: null };
    }

    const dietDay = await dietDayService.findByIdDietAndDate(client.dietInUse, date);
    return { dietInUse: client.dietInUse, dietDay: dietDay || null };
  },

  async getClientNutritionalGoals(clientId) {
    const [client, goals] = await Promise.all([
      userSchema.findById(clientId).select("goalInUse").lean(),
      nutritionalGoalService.getByUserId(clientId),
    ]);

    return {
      goalInUse: client?.goalInUse || null,
      goals,
    };
  },

  /**
   * revoke: quien revoca (`actorRole`) puede ser "trainer" o "client". Idempotente
   * si ya estaba revocada/declinada.
   */
  async revokeByTrainer(trainerId, clientId, scope) {
    const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId, scope);
    if (!relation) return null; // ya no activa, o nunca existió — idempotente
    return trainerClientDao.updateStatus(relation._id, "revoked", {
      revokedBy: "trainer",
      revokedAt: new Date(),
    });
  },

  async revokeByClient(clientId, scope) {
    const relation = await trainerClientDao.findActiveByClientAndScope(clientId, scope);
    if (!relation) return null;
    return trainerClientDao.updateStatus(relation._id, "revoked", {
      revokedBy: "client",
      revokedAt: new Date(),
    });
  },

  async listHistoryByTrainer(trainerId) {
    return trainerClientDao.findAllByTrainer(trainerId, { status: ["revoked", "declined"] });
  },

  async listHistoryByClient(clientId) {
    return trainerClientDao.findAllByClient(clientId, { status: ["revoked", "declined"] });
  },
};

// Agrupa relaciones activas por la "otra parte" (clientId visto desde el
// trainer, o trainerId visto desde el cliente), combinando varios scopes de la
// misma persona en una sola entrada — F05/F07 nunca deben ver duplicados.
async function aggregateByOtherParty(relations, otherPartyField) {
  const byOtherParty = new Map();
  for (const relation of relations) {
    const key = String(relation[otherPartyField]);
    if (!byOtherParty.has(key)) byOtherParty.set(key, []);
    byOtherParty.get(key).push(relation);
  }

  const otherPartyIds = [...byOtherParty.keys()];
  const users = await userSchema
    .find({ _id: { $in: otherPartyIds } })
    .select("name lastname email")
    .lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  return otherPartyIds.map((id) => ({
    user: usersById.get(id) || null,
    scopes: byOtherParty.get(id).map((r) => r.scope),
    relations: byOtherParty.get(id),
  }));
}
