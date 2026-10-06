const trainerClientDao = require("./trainer-client-dao");
const userDao = require("../users/user-dao");
const mail = require("../util/mail");
const trainerIntakeConfigService = require("../trainerIntakeConfig/trainer-intake-config-service");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { todayForUser } = require("../users/user-time-zone");
const { isOldEnough } = require("../users/age-policy");
const { httpError, badRequest, forbidden, notFound } = require("../util/http-error");
const { sanitizeIntakeAnswers } = require("./client-intake-schema");
const { buildCustomAnswers } = require("../forms/custom-question");
const { isReadOnly } = require("./trainer-seat-service");
const {
  SCOPES,
  activeScopes,
  hasOpenLink,
  openLink,
  latestRevokedAt,
  intakePendingOnAccept,
  intakeStatusOf,
  invitationView,
  invitationsOf,
} = require("./pair-state");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

// Datos de perfil que el cuestionario confirma y reescribe en `User` (los
// metió el cliente al registrarse). Rangos = los mismos que valida el
// schema / sign-up. El peso no: es una medida (ver submitIntake).
function extractUserProfilePatch(data) {
  const patch = {};
  if (num(data.height) >= 70 && num(data.height) <= 300) patch.height = num(data.height);
  if (data.sex === 0 || data.sex === 1) patch.sex = data.sex;
  if (data.birth && isOldEnough(data.birth)) patch.birth = new Date(data.birth);
  // steps/activity/training llegan ya resueltos al `.value` numérico del
  // enum (mismo criterio que sign-up: el front tiene las constantes).
  // Rangos: STEPS 1-1.86, ACTIVITY 1.15-1.75, TRAINING ~1-1.8.
  if (num(data.steps) >= 1 && num(data.steps) <= 2) patch.steps = num(data.steps);
  if (num(data.activity) >= 1 && num(data.activity) <= 2) patch.activity = num(data.activity);
  if (num(data.training) >= 1 && num(data.training) <= 2) patch.training = num(data.training);
  // objetive = delta de kcal con signo (−déficit / 0 / +superávit).
  if (Number.isFinite(num(data.objetive)) && Math.abs(num(data.objetive)) <= 1500) {
    patch.objetive = num(data.objetive);
  }
  return patch;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

const fullTrainerName = (trainer) => [trainer?.name, trainer?.lastname].filter(Boolean).join(" ");
const personOf = (user) =>
  user && typeof user === "object" && user._id
    ? { _id: user._id, name: user.name, lastname: user.lastname, email: user.email }
    : null;

// Invitar y aceptar van bajo el bloqueo de altas del profesional (los
// cambios de suscripción usan el mismo). Si está ocupado, la app reintenta.
async function withAdmission(trainerId, operation) {
  try {
    return await require("../trainerBilling/adapter").withClientAdmission(String(trainerId), operation);
  } catch (error) {
    if (error?.name === "BillingError" && error.status < 500) throw httpError(error.status, error.message, error.code);
    throw error;
  }
}

async function sendInviteMail(trainerUser, clientEmail, scopes) {
  const scopeLabels = scopes.map((s) => (s === "training" ? "Entrenamiento" : "Nutrición")).join(" y ");
  const trainerName = fullTrainerName(trainerUser) || "Un profesional";
  const html = mail.generateMail(
    "Tienes una invitación",
    `${trainerName} te ha invitado a TrainFit para llevar tu ${scopeLabels}. Abre la app para aceptarla o rechazarla.`,
    "https://trainfit.net/#/Mas",
    "Abrir TrainFit"
  );
  try {
    await mail.sendTransactionalMail(clientEmail, `${trainerName} te ha invitado en TrainFit`, html);
  } catch (e) {
    // La invitación ya existe y se ve al abrir la app: un fallo de correo no la deshace.
    console.error("Error enviando email de invitación:", e.message);
  }
}

// Al terminar el ÚLTIMO scope activo con este profesional se finaliza la
// cuota y se apagan los avisos de cobro (la deuda se queda). Si falla, el
// job de cobros lo corrige en su siguiente pasada.
async function closePaymentsIfLastScope(trainerId, clientId) {
  try {
    await require("../trainerPayments/trainer-payment-service").onRelationChanged(trainerId, clientId);
  } catch (error) {
    console.error("[TrainerPayments] No se pudo cerrar la cuota tras la baja:", error.message);
  }
}

// Campos del cuestionario que ve el cliente de cada profesional. Además de
// los que activó el profesional, siempre: el perfil y la actividad (se
// reescriben en User) y el objetivo; las restricciones dietéticas solo si
// lleva la nutrición.
function intakeFieldsFor(enabledFields, scopes) {
  const fields = new Set(enabledFields || []);
  fields.add("profileBiometrics");
  fields.add("activityProfile");
  fields.add("objective");
  if (scopes.includes("nutrition")) fields.add("dietaryFlags");
  else fields.delete("dietaryFlags");
  return [...fields];
}

// Respuestas del formulario + las propias validadas contra las preguntas
// actuales del profesional (ver forms/custom-question.js#buildCustomAnswers).
async function intakeAnswers(trainerId, data, options) {
  const questions = (await trainerIntakeConfigService.getCustomQuestionsByTrainers([String(trainerId)])).get(String(trainerId));
  const { answers, error } = buildCustomAnswers(questions, data.customAnswers, options);
  if (error) throw badRequest(error, "INVALID_CUSTOM_ANSWER");
  return { ...sanitizeIntakeAnswers(data), customAnswers: answers };
}

async function requireActivePair(trainerId, clientId, message) {
  const pair = await trainerClientDao.findActivePair(trainerId, clientId);
  if (!pair) throw forbidden(message, "NO_RELATION");
  return pair;
}

module.exports = {
  SCOPES,

  // Estado por scope de un email con ESTE profesional, para avisar en el
  // formulario de invitar antes de enviar. `blocked` = ya hay una invitación
  // sin responder o una relación en curso en ese scope.
  async checkClientEmailStatus(trainerId, clientEmailRaw) {
    const result = { training: { blocked: false, status: null }, nutrition: { blocked: false, status: null } };
    const clientEmail = normalizeEmail(clientEmailRaw);
    if (!clientEmail) return result;
    const pair = await trainerClientDao.findPairByEmail(trainerId, clientEmail);
    for (const scope of SCOPES) {
      const link = openLink(pair, scope);
      if (link) result[scope] = { blocked: true, status: link.status };
    }
    return result;
  },

  /**
   * Invita a un email a uno o varios scopes. Un resultado por scope, nunca
   * todo o nada: un scope con conflicto no bloquea al otro. Invitar nunca
   * compra plazas: sin plaza libre se rechaza y la app lleva a Suscripción.
   */
  async inviteClient(trainerId, trainerUser, clientEmailRaw, scopes) {
    const clientEmail = normalizeEmail(clientEmailRaw);
    if (normalizeEmail(trainerUser.email) === clientEmail) {
      throw badRequest("No puedes invitarte a ti mismo", "SELF_INVITE");
    }
    const requested = [...new Set(Array.isArray(scopes) ? scopes : [scopes])].filter((s) => SCOPES.includes(s));
    if (!requested.length) {
      throw badRequest("Debes indicar al menos un scope válido (training/nutrition)", "INVALID_SCOPE");
    }

    const results = await withAdmission(trainerId, async (clientLimit) => {
      const [existingUser, pair, seats] = await Promise.all([
        userDao.findFieldsByEmail(clientEmail, "roles"),
        trainerClientDao.findPairByEmail(trainerId, clientEmail),
        trainerClientDao.countSeats(trainerId),
      ]);
      // Quien ya reserva u ocupa plaza (otro scope) no cuenta dos veces.
      if (!hasOpenLink(pair) && seats.occupied + seats.reserved >= clientLimit) {
        throw forbidden("Has alcanzado el límite de clientes de tu plan", "TRAINER_LIMIT_REACHED");
      }
      // Quien aún no tiene cuenta puede aceptar al registrarse con ese email.
      if (existingUser && !(existingUser.roles || []).includes("user")) {
        throw badRequest("Este email no corresponde a una cuenta de cliente de TrainFit", "NOT_A_USER_ACCOUNT");
      }

      const outcome = [];
      for (const scope of requested) {
        const overlapping = await trainerClientDao.hasOtherActiveTrainer({
          clientEmail,
          clientId: existingUser?._id,
          scope,
          excludingTrainerId: trainerId,
        });
        if (overlapping) {
          outcome.push({ scope, success: false, error: `Este cliente ya tiene un profesional de tipo "${scope}"` });
          continue;
        }
        try {
          const { invitation } = await trainerClientDao.createInvitation(trainerId, clientEmail, scope);
          outcome.push({ scope, success: true, invitation });
        } catch (error) {
          if (error.code !== 11000) throw error;
          outcome.push({ scope, success: false, error: `Ya existe una invitación pendiente para este email en el ámbito "${scope}"` });
        }
      }
      return outcome;
    });

    // El correo sale después de soltar el bloqueo de altas.
    const created = results.filter((r) => r.success);
    if (created.length) await sendInviteMail(trainerUser, clientEmail, created.map((r) => r.scope));
    return results;
  },

  // Todas las invitaciones del profesional (pendientes, en curso e
  // historial), con el nombre del cliente si ya tiene cuenta.
  async listInvitesByTrainer(trainerId) {
    const pairs = await trainerClientDao.findPairsOfTrainer(trainerId);
    return invitationsOf(pairs).map(({ pair, link }) => {
      const client = personOf(pair.clientId);
      return {
        ...invitationView({ ...pair, clientId: client?._id || pair.clientId }, link),
        client: client ? { name: client.name, lastname: client.lastname } : null,
      };
    });
  },

  // Retirar una invitación sin responder. Sobre una ya respondida no hace
  // nada (idempotente). null si no existe o no es suya.
  async cancelInvite(trainerId, invitationId) {
    const found = await trainerClientDao.findInvitation(invitationId);
    if (!found || String(found.pair.trainerId) !== String(trainerId)) return null;
    if (found.invitation.status !== "pending") return found.invitation;
    const cancelled = await trainerClientDao.cancelInvitation(trainerId, invitationId);
    return (cancelled || (await trainerClientDao.findInvitation(invitationId))).invitation;
  },

  // Invitaciones sin responder del cliente: una tarjeta por scope, con quién
  // le invita.
  async listPendingForClient(clientEmail) {
    const pairs = await trainerClientDao.findPairsWithPendingInvitations(clientEmail);
    return invitationsOf(pairs, (link) => link.status === "pending").map(({ pair, link }) => ({
      ...invitationView({ ...pair, trainerId: pair.trainerId?._id || pair.trainerId }, link),
      trainer: personOf(pair.trainerId),
    }));
  },

  // Profesionales en curso del cliente, uno por par con sus scopes activos.
  async listActiveProfessionalsForClient(clientId) {
    const pairs = await trainerClientDao.findActivePairsOfClient(clientId, { withTrainer: true });
    return pairs.map((pair) => ({ user: personOf(pair.trainerId), scopes: activeScopes(pair) }));
  },

  /**
   * El cliente acepta o rechaza una invitación. Responder dos veces es
   * idempotente. Aceptar formaliza la relación al momento (el cliente ya
   * sale en la cartera); el cuestionario queda pendiente aparte, sin
   * bloquear nada. La plaza se comprueba y se ocupa bajo el bloqueo de altas.
   */
  async respondToInvite(invitationId, clientUser, decision) {
    const found = await trainerClientDao.findInvitation(invitationId);
    if (!found) return null;
    const { pair, invitation } = found;
    if (normalizeEmail(pair.clientEmail) !== normalizeEmail(clientUser.email)) {
      throw forbidden("Esta invitación no está dirigida a tu cuenta", "FORBIDDEN");
    }
    if (invitation.status !== "pending") return invitation;

    if (decision === "decline") {
      const declined = await trainerClientDao.declineInvitation(invitationId);
      return (declined || (await trainerClientDao.findInvitation(invitationId))).invitation;
    }

    // Puede haber aceptado a otro profesional del mismo scope entretanto.
    const overlapping = await trainerClientDao.hasOtherActiveTrainer({
      clientEmail: pair.clientEmail,
      clientId: clientUser._id,
      scope: invitation.scope,
      excludingTrainerId: pair.trainerId,
    });
    if (overlapping) {
      throw badRequest(`Este cliente ya tiene un profesional de tipo "${invitation.scope}"`, "OVERLAP");
    }

    const accepted = await withAdmission(pair.trainerId, async (_admission, capacity) => {
      await require("./trainer-seat-service").assertSeatForAcceptance(pair.trainerId, clientUser._id, capacity);
      const current = await trainerClientDao.findPairByEmail(pair.trainerId, pair.clientEmail);
      return trainerClientDao.acceptInvitation(invitationId, clientUser._id, {
        intakePending: intakePendingOnAccept(current),
      });
    });
    if (!accepted) return (await trainerClientDao.findInvitation(invitationId)).invitation;

    await notificationDao.createForTrainer(pair.trainerId, clientUser._id, "invite_accepted", { scope: invitation.scope });
    return accepted.invitation;
  },

  /**
   * El cliente envía su cuestionario de alta a un profesional. Mientras el
   * profesional no lo marque revisado puede reenviarlo: se reescribe con los
   * mismos efectos, pero solo el primer envío avisa. Alergias y preferencias
   * van a User.nutritionPreferences y el perfil a User: el profesional parte
   * de datos frescos para calcular el objetivo.
   */
  async submitIntake(trainerId, clientId, intakeData) {
    const pair = await trainerClientDao.findActivePair(trainerId, clientId);
    const status = intakeStatusOf(pair);
    if (status === "reviewed") {
      throw badRequest("Tu profesional ya ha revisado tu cuestionario: ya no se puede cambiar", "INTAKE_ALREADY_REVIEWED");
    }
    if (!status) {
      throw badRequest("No tienes ningún cuestionario pendiente con este profesional", "NO_INTAKE_PENDING");
    }

    const answers = await intakeAnswers(trainerId, intakeData, { requireAll: true });
    const saved = await trainerClientDao.submitIntake(pair._id, answers);
    await nutritionPreferencesDao.upsertOwnResponse(clientId, {
      allergies: intakeData.allergies,
      favoriteFoods: intakeData.favoriteFoods,
      dislikedFoods: intakeData.dislikedFoods,
      cooksAtHome: intakeData.cooksAtHome,
      dietaryFlags: intakeData.dietaryFlags,
    });

    // El peso que confirma es su medida de hoy (el peso vive en sus medidas,
    // no en el usuario). Si cambió algo, se recalcula el objetivo "Default"
    // del cliente (uno puesto por un profesional no se pisa).
    const userPatch = extractUserProfilePatch(intakeData);
    const weight = num(intakeData.weight) >= 30 && num(intakeData.weight) <= 300 ? num(intakeData.weight) : null;
    if (Object.keys(userPatch).length) await userDao.updateProfile(clientId, userPatch);
    if (weight !== null) await anthropometryDao.upsertOwnFields(clientId, await todayForUser(clientId), { weight });
    if (Object.keys(userPatch).length || weight !== null) {
      await nutritionalGoalService.recomputeDefaultForClient(clientId).catch(() => {});
    }

    if (status === "pending") {
      await notificationDao.create(clientId, trainerId, "intake_submitted", {});
      await notificationDao.createForTrainer(trainerId, clientId, "intake_submitted_trainer", {});
    }
    return saved.intake;
  },

  // Lo que el cliente ya respondió a este profesional, para precargar el
  // formulario (null si nunca lo rellenó).
  async getOwnIntake(clientId, trainerId) {
    const pair = await trainerClientDao.findPair(trainerId, clientId);
    return pair?.intake || null;
  },

  // El cuestionario como lo ve el profesional. El formulario escribe en tres
  // sitios (ver submitIntake): sus respuestas, el perfil en User y la
  // nutrición en User.nutritionPreferences; se devuelven los tres, con los
  // valores actuales.
  async getIntakeWithAnswers(trainerId, clientId) {
    const pair = await requireActivePair(trainerId, clientId, "No tienes una relación con este cliente que permita ver su cuestionario");
    return withProfileAndNutrition(pair.intake, clientId);
  },

  // El profesional corrige el cuestionario: solo las respuestas, sin cambiar
  // el estado del envío ni repetir los efectos del envío del cliente.
  async updateIntake(trainerId, clientId, data) {
    const pair = await requireActivePair(trainerId, clientId, "No tienes una relación con este cliente que permita editar su cuestionario");
    const answers = await intakeAnswers(trainerId, data, { previous: pair.intake?.customAnswers || [] });
    const saved = await trainerClientDao.updateIntakeAnswers(pair._id, answers);
    return withProfileAndNutrition(saved.intake, clientId);
  },

  // Guard de la ficha (front): sin enviar o por revisar no se entra.
  async getIntakeStatus(trainerId, clientId) {
    return intakeStatusOf(await trainerClientDao.findActivePair(trainerId, clientId));
  },

  // "Marcar revisado": desde ese momento el cliente solo puede verlo.
  async markIntakeReviewed(trainerId, clientId) {
    const pair = await requireActivePair(trainerId, clientId, "No tienes una relación con este cliente que permita revisar su cuestionario");
    const status = intakeStatusOf(pair);
    if (!status || status === "pending") throw notFound("El cliente aún no ha enviado su cuestionario", "INTAKE_NOT_SUBMITTED");
    return (await trainerClientDao.markIntakeReviewed(pair._id)).intake;
  },

  /**
   * El cuestionario de cada profesional en curso del cliente: su estado y lo
   * que necesita el formulario (campos y preguntas propias de ese
   * profesional). Nunca bloquea la app.
   */
  async getOnboardingStatus(clientId) {
    const pairs = (await trainerClientDao.findActivePairsOfClient(clientId, { withTrainer: true }))
      .filter((pair) => intakeStatusOf(pair));
    if (!pairs.length) return { professionals: [] };

    const trainerIds = pairs.map((pair) => String(pair.trainerId._id));
    const [enabledFieldsByTrainer, customQuestionsByTrainer] = await Promise.all([
      trainerIntakeConfigService.getEnabledFieldsByTrainers(trainerIds),
      trainerIntakeConfigService.getCustomQuestionsByTrainers(trainerIds),
    ]);
    return {
      professionals: pairs.map((pair) => {
        const trainerId = String(pair.trainerId._id);
        const scopes = activeScopes(pair);
        return {
          trainerId,
          trainer: personOf(pair.trainerId),
          scopes,
          intakeStatus: intakeStatusOf(pair),
          intakeEnabledFields: intakeFieldsFor(enabledFieldsByTrainer.get(trainerId), scopes),
          // Solo las que el profesional deja activas: desactivar no borra la
          // pregunta, pero deja de mandarla.
          intakeCustomQuestions: (customQuestionsByTrainer.get(trainerId) || [])
            .filter((question) => question.enabled !== false)
            .map(({ _id, label, type, unit, options, required }) => ({ _id, label, type, unit, options, required })),
        };
      }),
    };
  },

  // ¿Tiene el cliente algún profesional activo (en `scope`, si se pasa)?
  async hasActiveTrainer(clientId, scope = null) {
    return trainerClientDao.hasActiveTrainer(clientId, scope);
  },

  // ¿Lleva este profesional al cliente (en `scope`, si se pasa)?
  async hasActiveClient(trainerId, clientId, scope = null) {
    return trainerClientDao.isActivePair(trainerId, clientId, scope);
  },

  // ¿Puede este profesional escribir sobre el cliente? null si sí;
  // "no_relation" sin relación activa; "read_only" si el cliente quedó fuera
  // del cupo de su plan (trainer-seat-service.js). Para los endpoints que
  // reciben el cliente en el cuerpo y no pasan por requireActiveClient.
  async clientWriteBlock(trainerId, clientId) {
    if (!(await trainerClientDao.isActivePair(trainerId, clientId))) return "no_relation";
    if (await isReadOnly(trainerId, clientId)) return "read_only";
    return null;
  },

  async setTrainingGoal(pairId, trainingGoalType) {
    return trainerClientDao.setTrainingGoal(pairId, trainingGoalType);
  },

  // Fin de la última relación anterior con este cliente: lo creado antes es
  // "de una relación anterior".
  async getPreviousRelationCutoff(trainerId, clientId) {
    return latestRevokedAt(await trainerClientDao.findPair(trainerId, clientId));
  },

  // Clientes en curso del profesional, uno por par, con sus scopes y el
  // estado del cuestionario.
  async listActiveClientsForTrainer(trainerId) {
    const pairs = await trainerClientDao.findActivePairsOfTrainer(trainerId, { withClient: true });
    return pairs
      .filter((pair) => pair.clientId)
      .map((pair) => ({
        user: { ...personOf(pair.clientId), timezone: pair.clientId.timezone },
        scopes: activeScopes(pair),
        intakePending: Boolean(pair.intakePending),
        intakeStatus: intakeStatusOf(pair),
      }));
  },

  async countLifetimeClients(trainerId) {
    return trainerClientDao.countLifetimeClients(trainerId);
  },

  // El profesional termina un scope con el cliente. null si no estaba activo.
  async revokeByTrainer(trainerId, clientId, scope) {
    if (!SCOPES.includes(scope)) throw badRequest("scope es obligatorio", "INVALID_SCOPE");
    const revoked = await trainerClientDao.revokeScope({ trainerId, clientId, scope, by: "trainer" });
    if (!revoked) return null;
    await closePaymentsIfLastScope(trainerId, clientId);
    return revoked.invitation;
  },

  // El cliente se da de baja de un scope. null si no tenía a nadie en él.
  async revokeByClient(clientId, scope) {
    const revoked = await trainerClientDao.revokeScope({ clientId, scope, by: "client" });
    if (!revoked) return null;
    await closePaymentsIfLastScope(revoked.pair.trainerId, clientId);
    return revoked.invitation;
  },

  // Relaciones terminadas o invitaciones rechazadas, vistas por el profesional.
  async listHistoryByTrainer(trainerId) {
    const pairs = await trainerClientDao.findPairsOfTrainer(trainerId);
    return invitationsOf(pairs, isClosed).map(({ pair, link }) =>
      invitationView({ ...pair, clientId: personOf(pair.clientId)?._id || pair.clientId }, link)
    );
  },

  // Lo mismo visto por el cliente, con el nombre del profesional.
  async listHistoryByClient(clientId, clientEmail) {
    const pairs = await trainerClientDao.findPairsWithClosedLinksOfClient(clientId, clientEmail);
    return invitationsOf(pairs, isClosed).map(({ pair, link }) => ({
      ...invitationView({ ...pair, trainerId: pair.trainerId?._id || pair.trainerId }, link),
      trainer: personOf(pair.trainerId),
    }));
  },
};

function isClosed(link) {
  return link.status === "declined" || link.status === "revoked";
}

async function withProfileAndNutrition(intake, clientId) {
  if (!intake) return null;
  const [user, latestWeight, preferences] = await Promise.all([
    userDao.findFields(clientId, "height sex birth steps activity training objetive"),
    anthropometryDao.findLatestWeight(clientId),
    nutritionPreferencesDao.getByClientId(clientId),
  ]);
  return {
    ...intake,
    profile: user
      ? {
          weight: latestWeight?.weight ?? null,
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
}
