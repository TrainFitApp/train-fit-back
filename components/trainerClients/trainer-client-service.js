const trainerClientDao = require("./trainer-client-dao");
const userSchema = require("../users/schema");
const mail = require("../util/mail");
const featureAccessService = require("../billing/feature-access-service");
const clientIntakeDao = require("../clientIntake/client-intake-dao");
const trainerIntakeConfigService = require("../trainerIntakeConfig/trainer-intake-config-service");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { todayIsoDate } = require("../util/date-util");
const { intakePendingOnAccept, intakeStatusFor } = require("./intake-pending");

// Datos de perfil que el intake confirma y reescribe en `User` (los metió el
// cliente al registrarse). Rangos = los mismos que valida el schema / sign-up.
function extractUserProfilePatch(data) {
  const patch = {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  if (num(data.weight) >= 30 && num(data.weight) <= 300) patch.weight = num(data.weight);
  if (num(data.height) >= 70 && num(data.height) <= 300) patch.height = num(data.height);
  if (data.sex === 0 || data.sex === 1) patch.sex = data.sex;
  if (data.birth && !Number.isNaN(new Date(data.birth).getTime())) patch.birth = new Date(data.birth);
  // steps/activity/training llegan ya resueltos al `.value` numérico del
  // enum (mismo criterio que sign-up: el front tiene las constantes).
  // Rangos de los .value de los enums: STEPS 1-1.86, ACTIVITY 1.15-1.75,
  // TRAINING ~1-1.8 (ver shared-ui/constants).
  if (num(data.steps) >= 1 && num(data.steps) <= 2) patch.steps = num(data.steps);
  if (num(data.activity) >= 1 && num(data.activity) <= 2) patch.activity = num(data.activity);
  if (num(data.training) >= 1 && num(data.training) <= 2) patch.training = num(data.training);
  // objetive = delta de kcal con signo (−déficit / 0 / +superávit).
  if (Number.isFinite(num(data.objetive)) && Math.abs(num(data.objetive)) <= 1500) {
    patch.objetive = num(data.objetive);
  }
  return patch;
}

// Estado del cuestionario de un par (profesional, cliente) según
// intakeStatusFor; null si no hay relación activa o es antigua sin
// cuestionario. Lo comparten el envío del cliente y el guard de la ficha.
async function intakeStatusOfPair(trainerId, clientId) {
  const [activeRelations, intake] = await Promise.all([
    trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, ["active"]),
    clientIntakeDao.getByTrainerAndClient(trainerId, clientId),
  ]);
  if (!activeRelations.length) return null;
  return intakeStatusFor({
    intakePending: activeRelations.some((relation) => relation.intakePending),
    intake,
  });
}

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

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
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
    "https://trainfit.net/#/Mas",
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

  // Estado por scope de un email para ESTE trainer, para avisar en el
  // formulario de invitar antes de enviar (no solo dejar que el submit
  // falle contra el índice único). `blocked` = ya hay algo en curso o
  // activo en ese scope; declined/revoked no cuentan, se puede reinvitar.
  async checkClientEmailStatus(trainerId, clientEmailRaw) {
    const clientEmail = String(clientEmailRaw || "").trim().toLowerCase();
    const result = { training: { blocked: false, status: null }, nutrition: { blocked: false, status: null } };
    if (!clientEmail) return result;

    const relations = await trainerClientDao.findBlockingByTrainerAndEmail(trainerId, clientEmail);
    for (const relation of relations) {
      if (result[relation.scope]) {
        result[relation.scope] = { blocked: true, status: relation.status };
      }
    }
    return result;
  },

  /**
   * Invita a un cliente para uno o varios scopes a la vez. Crea UN documento
   * TrainerClient por scope — nunca un único documento "both" (ver
   * modelos-de-datos/01-trainerclient.md). Devuelve un resultado por scope,
   * nunca todo-o-nada: un scope con conflicto no bloquea al otro.
   */
  async inviteClient(trainerId, trainerUser, clientEmailRaw, scopes) {
    const clientEmail = normalizeEmail(clientEmailRaw);

    // Errores de la petición, con code: el controller los devuelve como 400
    // (antes eran Error genéricos y acababan en 500).
    if (normalizeEmail(trainerUser.email) === clientEmail) {
      throw codedError("No puedes invitarte a ti mismo", "SELF_INVITE");
    }
    const uniqueScopes = [...new Set(scopes)].filter((s) => VALID_SCOPES.includes(s));
    if (!uniqueScopes.length) {
      throw codedError("Debes indicar al menos un scope válido (training/nutrition)", "INVALID_SCOPE");
    }

    const createInvites = async (clientLimit) => {
      // Contar e insertar dentro del mismo lease que protege los cambios Stripe.
      // El cupo incluye onboarding y deduplica los dos scopes de un cliente.
      const existingUser = await userSchema.findOne({ email: clientEmail }).lean();
      const distinctClients = await trainerClientDao.getBillableClientKeys(trainerId);
      const alreadyCounted = distinctClients.has(`email:${clientEmail}`) ||
        (existingUser && distinctClients.has(`id:${existingUser._id}`));
      if (!alreadyCounted && distinctClients.size >= clientLimit) {
        throw new TrainerLimitReachedError();
      }

      // Los clientes nuevos pueden aceptar la invitación al registrarse.
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
      return results;
    };

    const usesStripe = process.env.TRAINER_BILLING_ENABLED === "1" &&
      trainerUser.professionalPremium?.source === "stripe";
    const results = usesStripe
      ? await require("../trainerBilling/adapter").withClientAdmission(String(trainerId), createInvites)
      : await createInvites(featureAccessService.getTrainerLimits(trainerUser).clients);

    // El correo se envía después de soltar el lease; no retrasa otras operaciones.
    const created = results.filter((r) => r.success);
    if (created.length) {
      await sendInviteMail(trainerUser, clientEmail, created.map((r) => r.scope));
    }

    return results;
  },

  async listInvitesByTrainer(trainerId) {
    return trainerClientDao.findAllByTrainerWithClient(trainerId);
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

    // 2026-09 — aceptar formaliza la relación al momento: "active" y el
    // cliente ya sale en Clientes. El cuestionario inicial queda pendiente
    // aparte (intakePending), sin bloquear la app del cliente ni esperar a
    // que el profesional confirme nada.
    const activeWithTrainer = await trainerClientDao.findByTrainerAndClientInStatuses(
      invitation.trainerId,
      clientUser._id,
      ["active"]
    );

    const updated = await trainerClientDao.updateStatus(invitation._id, "active", {
      clientId: clientUser._id,
      respondedAt: new Date(),
      intakePending: intakePendingOnAccept(activeWithTrainer),
    });
    await notificationDao.createForTrainer(invitation.trainerId, clientUser._id, "invite_accepted", {
      scope: invitation.scope,
    });
    return updated;
  },

  /**
   * TAREA 3 — el cliente envía el cuestionario inicial. Lo da por enviado en
   * TODAS sus relaciones activas con este profesional a la vez (el
   * cuestionario es uno por par profesional-cliente, no por scope). La
   * relación ya era "active" desde que aceptó: aquí no cambia de estado.
   * Mientras el profesional no lo marque revisado, el cliente puede volver a
   * enviarlo: sobrescribe el anterior con los mismos efectos, pero sin
   * notificaciones (solo avisan del primer envío).
   * Reutiliza ClientNutritionPreferences (F29) para alergias/preferencias —
   * no se duplica ese dato en un schema aparte.
   */
  async submitIntake(trainerId, clientId, intakeData) {
    const status = await intakeStatusOfPair(trainerId, clientId);
    if (status === "reviewed") {
      const err = new Error("Tu profesional ya ha revisado tu cuestionario: ya no se puede cambiar");
      err.code = "INTAKE_ALREADY_REVIEWED";
      throw err;
    }
    if (!status) {
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
      dietaryFlags: intakeData.dietaryFlags,
    });

    // Reciclar lo del registro — el intake confirma peso/altura/sexo/pasos/
    // actividad/frecuencia y los reescribe en `User`, para que el cálculo de
    // objetivo del entrenador (y el cajón de sugerencias) parta de datos
    // frescos. Si algo cambió, se recalcula el objetivo "Default" del cliente
    // (solo si no es uno asignado por un profesional — ese no se pisa).
    const userPatch = extractUserProfilePatch(intakeData);
    if (Object.keys(userPatch).length) {
      await userSchema.findByIdAndUpdate(clientId, { $set: userPatch });
      await nutritionalGoalService.recomputeDefaultForClient(clientId).catch(() => {});
    }

    // Sembrar la primera antropometría con el peso del intake, si el cliente
    // aún no tiene ninguna — así "último peso" en la ficha y el cajón de
    // sugerencias funcionan desde el día 1, sin un AnthropometryRequest aparte.
    if (Number.isFinite(userPatch.weight)) {
      const existing = await anthropometryDao.getAllAnthropometriesByUserId(clientId);
      if (!existing.length) {
        await anthropometryDao
          .mergeAnthropometryFields(clientId, todayIsoDate(), { weight: userPatch.weight })
          .catch(() => {});
      }
    }

    if (status === "pending") {
      await trainerClientDao.clearIntakePending(trainerId, clientId);
      await notificationDao.create(clientId, trainerId, "intake_submitted", {});
      await notificationDao.createForTrainer(trainerId, clientId, "intake_submitted_trainer", {});
    }

    return intake;
  },

  // El intake tal como lo rellenó el cliente. El formulario escribe en tres
  // sitios (ver submitIntake): lo propio del cuestionario en ClientIntake, el
  // perfil en User y lo de nutrición en ClientNutritionPreferences. Devolver
  // solo ClientIntake dejaba al entrenador sin ver medio formulario. Son los
  // valores actuales: cada reenvío del cliente los reescribe, así que en la
  // revisión coinciden con lo último que envió.
  async getIntakeWithAnswers(trainerId, clientId) {
    const intake = await clientIntakeDao.getByTrainerAndClient(trainerId, clientId);
    if (!intake) return null;
    const [user, preferences] = await Promise.all([
      userSchema.findById(clientId).select("weight height sex birth steps activity training objetive").lean(),
      nutritionPreferencesDao.getByClientId(clientId),
    ]);
    return {
      ...intake,
      profile: user
        ? {
            weight: user.weight ?? null,
            height: user.height ?? null,
            sex: user.sex ?? null,
            birth: user.birth ?? null,
            steps: user.steps ?? null,
            activity: user.activity ?? null,
            training: user.training ?? null,
            objetive: user.objetive ?? null,
          }
        : null,
      nutrition: preferences
        ? {
            dietaryFlags: preferences.dietaryFlags || [],
            allergies: preferences.allergies || "",
            favoriteFoods: preferences.favoriteFoods || "",
            dislikedFoods: preferences.dislikedFoods || "",
            cooksAtHome: preferences.cooksAtHome ?? null,
          }
        : null,
    };
  },

  // Guard de la ficha (front): sin enviar o por revisar no se entra.
  async getIntakeStatus(trainerId, clientId) {
    return intakeStatusOfPair(trainerId, clientId);
  },

  // El profesional da por revisado el cuestionario: desde ese momento el
  // cliente solo puede verlo. null si aún no lo ha enviado.
  async markIntakeReviewed(trainerId, clientId) {
    const relations = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "en_revision",
      "active",
    ]);
    if (!relations.length) {
      const err = new Error("No tienes una relación con este cliente que permita revisar su cuestionario");
      err.code = "FORBIDDEN";
      throw err;
    }
    // Un cuestionario creado por el profesional antes de que el cliente
    // envíe el suyo no cuenta como enviado.
    if (relations.some((relation) => relation.intakePending)) return null;
    return clientIntakeDao.markReviewed(trainerId, clientId);
  },

  /**
   * El cuestionario inicial de cada profesional activo del cliente, con su
   * estado (intakeStatusFor: pendiente / enviado y editable / revisado) y lo
   * que necesita el formulario. Nunca bloquea la app: `blocked` queda
   * siempre en false (lo siguen leyendo builds antiguas del cliente, que con
   * true le redirigían a la pantalla del cuestionario).
   */
  async getOnboardingStatus(clientId) {
    const [active, intakes] = await Promise.all([
      trainerClientDao.findActiveByClient(clientId),
      clientIntakeDao.listStateByClient(clientId),
    ]);
    const intakeByTrainer = new Map(intakes.map((intake) => [String(intake.trainerId), intake]));
    const statusByRelation = new Map();
    for (const relation of active) {
      const intakeStatus = intakeStatusFor({
        intakePending: relation.intakePending,
        intake: intakeByTrainer.get(String(relation.trainerId)),
      });
      if (intakeStatus) statusByRelation.set(String(relation._id), intakeStatus);
    }
    const withIntake = active.filter((relation) => statusByRelation.has(String(relation._id)));

    if (!withIntake.length) {
      return { blocked: false, relations: [] };
    }

    const enriched = await attachTrainerInfo(withIntake);
    // TASK-049 — el formulario de cuestionario inicial necesita saber qué
    // campos activó cada profesional. Un solo $in por los trainerId únicos
    // (no por relación, ya que enabledFields es por trainer, no por scope),
    // mismo criterio que attachTrainerInfo un poco más abajo en este mismo
    // archivo — evita N consultas individuales cuando el cliente tiene
    // relaciones pendientes con varios trainers a la vez.
    const trainerIds = [...new Set(enriched.map((r) => String(r.trainerId)))];
    const [enabledFieldsByTrainer, customQuestionsByTrainer] = await Promise.all([
      trainerIntakeConfigService.getEnabledFieldsByTrainers(trainerIds),
      trainerIntakeConfigService.getCustomQuestionsByTrainers(trainerIds),
    ]);
    return {
      blocked: false,
      relations: enriched.map((r) => ({
        trainerId: r.trainerId,
        scope: r.scope,
        status: r.status,
        intakeStatus: statusByRelation.get(String(r._id)),
        trainer: r.trainer,
        // Campos FORZADOS (no toggleables, no en el panel de invites):
        //   · profileBiometrics + activityProfile — el intake confirma datos
        //     que el cliente ya metió al registrarse y los reescribe en User;
        //     el entrenador siempre los necesita, sea cual sea el scope.
        //   · dietaryFlags — solo scope nutrición (filtro del cajón).
        // Aunque la config guardada del trainer no los tenga (claves nuevas).
        intakeEnabledFields: (() => {
          const base = new Set(enabledFieldsByTrainer.get(String(r.trainerId)) || []);
          base.add("profileBiometrics");
          base.add("activityProfile");
          base.add("objective");
          if (r.scope === "nutrition") base.add("dietaryFlags");
          else base.delete("dietaryFlags");
          return [...base];
        })(),
        // Mismo criterio que intakeEnabledFields — por trainer, no por scope
        // de la relación (ver comentario del schema en
        // trainerIntakeConfig/trainer-intake-config-schema.js). Solo las que
        // el trainer dejó marcadas para enviar — enabled: false se guarda
        // (no se pierde el texto) pero no llega al cuestionario del cliente,
        // mismo criterio que enabledFields con los 9 campos predefinidos.
        intakeCustomQuestions: (customQuestionsByTrainer.get(String(r.trainerId)) || [])
          .filter((q) => q.enabled !== false)
          .map((q) => ({ id: String(q._id), label: q.label })),
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
    const revoked = await trainerClientDao.updateStatus(relation._id, "revoked", {
      revokedBy: "trainer",
      revokedAt: new Date(),
    });
    await closePaymentsIfLastScope(trainerId, clientId);
    return revoked;
  },

  async revokeByClient(clientId, scope) {
    const relation = await trainerClientDao.findActiveByClientAndScope(clientId, scope);
    if (!relation) return null;
    const revoked = await trainerClientDao.updateStatus(relation._id, "revoked", {
      revokedBy: "client",
      revokedAt: new Date(),
    });
    await closePaymentsIfLastScope(relation.trainerId, clientId);
    return revoked;
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
// Cobros 2026-09 — al terminar el ÚLTIMO scope activo con este entrenador se
// finaliza la cuota y se apagan los avisos del cliente (la deuda se queda).
// Si solo termina entrenamiento y sigue nutrición, no se toca nada. Si esto
// falla, el job de cobros lo corrige en su siguiente pasada.
async function closePaymentsIfLastScope(trainerId, clientId) {
  try {
    await require("../trainerPayments/trainer-payment-service").onRelationChanged(trainerId, clientId);
  } catch (error) {
    console.error("[TrainerPayments] No se pudo cerrar la cuota tras la baja:", error.message);
  }
}

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
    // Solo tiene sentido visto desde el profesional: el cliente aún no ha
    // enviado su cuestionario inicial (ver trainer-client-schema.js).
    intakePending: byOtherParty.get(id).some((r) => r.intakePending),
  }));
}
