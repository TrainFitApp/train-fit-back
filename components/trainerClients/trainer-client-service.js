const trainerClientDao = require("./trainer-client-dao");
const userSchema = require("../users/schema");
const mail = require("../util/mail");
const featureAccessService = require("../billing/feature-access-service");
const clientIntakeDao = require("../clientIntake/client-intake-dao");
const trainerIntakeConfigService = require("../trainerIntakeConfig/trainer-intake-config-service");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");

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

// MVP-trainers F21 — límite de clientes por plan del profesional.
class TrainerLimitReachedError extends Error {
  constructor() {
    super("Has alcanzado el límite de clientes de tu plan");
    this.code = "TRAINER_LIMIT_REACHED";
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
  TrainerLimitReachedError,

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

    // MVP-trainers F21 — "un único contador total de clientes, independientemente
    // del scope" (no por documento de relación): un cliente con training+nutrition
    // del mismo trainer cuenta como 1, no 2. Cuenta pending+active (no solo active)
    // para que no se pueda evadir el límite acumulando invitaciones sin responder.
    const relations = await trainerClientDao.findAllByTrainer(trainerId, {
      status: ["pending", "active"],
    });
    const distinctClients = new Set(
      relations.map((r) => String(r.clientId || r.clientEmail))
    );
    const { clients: clientLimit } = featureAccessService.getTrainerLimits(trainerUser);
    if (!distinctClients.has(clientEmail) && distinctClients.size >= clientLimit) {
      throw new TrainerLimitReachedError();
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

  // TASK-035 (MASTER_BACKLOG.md) — antes solo cancelaba invitaciones
  // "pending" (nunca aceptadas); para "cuestionario_pendiente"/"en_revision"
  // (el cliente YA aceptó y está en medio del alta) devolvía la invitación
  // sin tocarla pero con 200 OK, y el frontend mostraba "Invitación
  // cancelada" como si hubiera funcionado — éxito falso. Ahora esos 2
  // estados también se pueden cancelar de verdad: como el cliente ya
  // aceptó, es más "revocar" que "declinar" (mismo estado final que
  // revokeByTrainer para un cliente activo), así que usa "revoked", no
  // "declined" (reservado para invitaciones nunca aceptadas).
  async cancelInvite(trainerId, inviteId) {
    const invite = await trainerClientDao.findById(inviteId);
    if (!invite || String(invite.trainerId) !== String(trainerId)) return null;

    if (invite.status === "pending") {
      return trainerClientDao.updateStatus(inviteId, "declined", { revokedBy: "trainer", revokedAt: new Date() });
    }
    if (["cuestionario_pendiente", "en_revision"].includes(invite.status)) {
      return trainerClientDao.updateStatus(inviteId, "revoked", { revokedBy: "trainer", revokedAt: new Date() });
    }
    return invite; // ya en un estado terminal (active/revoked/declined) — idempotente, nada que cancelar
  },

  async listPendingForClientEmail(email) {
    return trainerClientDao.findPendingByEmail(normalizeEmail(email));
  },

  // MVP-trainers F04: invitaciones pendientes con los datos del profesional
  // adjuntos (nombre/apellidos/email) — sin esto, la UI del cliente solo
  // tendría un trainerId en bruto y no podría mostrar quién le invitó.
  // A diferencia de F05 (que agrupa varios scopes del mismo cliente en una
  // tarjeta), aquí cada invitación pendiente es su PROPIA tarjeta aunque
  // comparta profesional (ver F04 punto 17: "si invitó a ambos, son 2
  // invitaciones independientes").
  async listPendingForClientEmailEnriched(email) {
    const invites = await trainerClientDao.findPendingByEmail(normalizeEmail(email));
    return attachTrainerInfo(invites);
  },

  async listActiveProfessionalsForClient(clientId) {
    const relations = await trainerClientDao.findActiveByClient(clientId);
    return aggregateByOtherParty(relations, "trainerId");
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

    // TAREA 3 — si el cliente YA tiene una relación activa con ESTE MISMO
    // profesional (p.ej. aceptó "training" hace tiempo y ahora acepta
    // "nutrition" del mismo profesional), el cuestionario inicial ya se hizo
    // y ya fue confirmado — no tiene sentido repetir el ciclo completo.
    // Pasa directo a "active", igual que el comportamiento anterior.
    const alreadyActiveWithTrainer = await trainerClientDao.findActiveByTrainerAndClient(
      invitation.trainerId,
      clientUser._id
    );
    const nextStatus = alreadyActiveWithTrainer ? "active" : "cuestionario_pendiente";

    return trainerClientDao.updateStatus(invitation._id, nextStatus, {
      clientId: clientUser._id,
      respondedAt: new Date(),
    });
  },

  /**
   * TAREA 3 — el cliente envía el cuestionario inicial. Transiciona TODAS sus
   * relaciones "cuestionario_pendiente" con este profesional a "en_revision"
   * a la vez (el cuestionario es uno por par profesional-cliente, no por
   * scope). Reutiliza ClientNutritionPreferences (F29) para alergias/
   * preferencias — no se duplica ese dato en un schema aparte.
   */
  async submitIntake(trainerId, clientId, intakeData) {
    const pendingRelations = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "cuestionario_pendiente",
    ]);
    if (!pendingRelations.length) {
      const err = new Error("No tienes ningún cuestionario pendiente con este profesional");
      err.code = "NO_INTAKE_PENDING";
      throw err;
    }

    const intake = await clientIntakeDao.upsert(trainerId, clientId, intakeData);
    await nutritionPreferencesDao.upsertOwnResponse(clientId, {
      allergies: intakeData.allergies,
      favoriteFoods: intakeData.favoriteFoods,
      dislikedFoods: intakeData.dislikedFoods,
      cooksAtHome: intakeData.cooksAtHome,
    });
    await trainerClientDao.updateManyStatus(trainerId, clientId, "cuestionario_pendiente", "en_revision");
    await notificationDao.create(clientId, trainerId, "intake_submitted", {});

    return intake;
  },

  /**
   * TAREA 3 — el profesional confirma explícitamente al cliente tras revisar
   * su cuestionario. Transiciona TODAS las relaciones "en_revision" de este
   * par a "active" a la vez.
   */
  async confirmClient(trainerId, clientId) {
    const inReview = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "en_revision",
    ]);
    if (!inReview.length) {
      const err = new Error("Este cliente no tiene ningún cuestionario en revisión");
      err.code = "NO_INTAKE_IN_REVIEW";
      throw err;
    }

    await trainerClientDao.updateManyStatus(trainerId, clientId, "en_revision", "active");
    await notificationDao.create(clientId, trainerId, "client_confirmed", {});
    return trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, ["active"]);
  },

  /**
   * TAREA 3 — ¿debe el cliente ver la pantalla de estado (cuestionario/en
   * revisión) en vez del resto de la app? Solo si NO tiene ninguna relación
   * activa con NADIE todavía Y tiene al menos una relación en curso de alta
   * (cuestionario_pendiente/en_revision) — un cliente con al menos un
   * profesional ya activo nunca vuelve a quedar bloqueado por una alta nueva
   * con otro profesional distinto.
   */
  async getOnboardingStatus(clientId) {
    const [active, onboarding] = await Promise.all([
      trainerClientDao.findActiveByClient(clientId),
      trainerClientDao.findAllByClient(clientId, { status: ["cuestionario_pendiente", "en_revision"] }),
    ]);

    if (active.length || !onboarding.length) {
      return { blocked: false, relations: [] };
    }

    const enriched = await attachTrainerInfo(onboarding);
    // TASK-049 — el formulario de cuestionario inicial necesita saber qué
    // campos activó cada profesional. Un solo $in por los trainerId únicos
    // (no por relación, ya que enabledFields es por trainer, no por scope),
    // mismo criterio que attachTrainerInfo un poco más abajo en este mismo
    // archivo — evita N consultas individuales cuando el cliente tiene
    // relaciones pendientes con varios trainers a la vez.
    const trainerIds = [...new Set(enriched.map((r) => String(r.trainerId)))];
    const enabledFieldsByTrainer = await trainerIntakeConfigService.getEnabledFieldsByTrainers(trainerIds);
    return {
      blocked: true,
      relations: enriched.map((r) => ({
        trainerId: r.trainerId,
        scope: r.scope,
        status: r.status,
        trainer: r.trainer,
        intakeEnabledFields: enabledFieldsByTrainer.get(String(r.trainerId)),
      })),
    };
  },

  async listActiveForClient(clientId) {
    return trainerClientDao.findActiveByClient(clientId);
  },

  // TASK-062 (MASTER_BACKLOG.md)
  async getPreviousRelationCutoff(trainerId, clientId) {
    const latestRevoked = await trainerClientDao.findLatestRevokedForClient(trainerId, clientId);
    return latestRevoked?.revokedAt || null;
  },

  async listActiveClientsForTrainer(trainerId) {
    const relations = await trainerClientDao.findAllByTrainer(trainerId, { status: "active" });
    return aggregateByOtherParty(relations, "clientId");
  },

  // TASK-022 (MASTER_BACKLOG.md)
  async listActiveClientsForTrainerPaginated(trainerId, { page, limit, search }) {
    return trainerClientDao.findActiveClientsPaginated(trainerId, { page, limit, search });
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

  // F22 — historial del lado cliente, con el nombre del profesional adjunto
  // (mismo criterio que F04: sin esto la UI solo tendría un trainerId en bruto).
  async listHistoryByClient(clientId) {
    const relations = await trainerClientDao.findAllByClient(clientId, {
      status: ["revoked", "declined"],
    });
    return attachTrainerInfo(relations);
  },
};

// F04: adjunta {trainer: {name, lastname, email}} a cada invitación SIN
// agrupar — cada documento sigue siendo su propia tarjeta.
async function attachTrainerInfo(invites) {
  const trainerIds = [
    ...new Set(invites.filter((i) => i.trainerId).map((i) => String(i.trainerId))),
  ];
  const trainers = await userSchema
    .find({ _id: { $in: trainerIds } })
    .select("name lastname email")
    .lean();
  const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

  return invites.map((invite) => ({
    ...(invite.toObject ? invite.toObject() : invite),
    trainer: trainersById.get(String(invite.trainerId)) || null,
  }));
}

// Agrupa relaciones activas por la "otra parte" (clientId visto desde el
// trainer, o trainerId visto desde el cliente), combinando varios scopes de la
// misma persona en una sola entrada — F05/F07 nunca deben ver duplicados.
async function aggregateByOtherParty(relations, otherPartyField) {
  const byOtherParty = new Map();
  for (const relation of relations) {
    // Defensivo: una relación "active" SIEMPRE debería tener este campo
    // relleno (respondToInvite lo fija al aceptar), pero si algún dato
    // quedó en un estado inconsistente (p. ej. manipulado a mano, o de una
    // versión anterior del código), saltarla en vez de reventar toda la
    // petición con un CastError de Mongo al convertir "undefined" en ObjectId.
    if (!relation[otherPartyField]) continue;
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
