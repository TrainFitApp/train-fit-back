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
const {
  buildIntakeMeasurements,
  anthropometryFieldsOf,
  intakePhotosError,
  buildIntakeVideos,
  intakeFormOf,
} = require("../trainerIntakeConfig/intake-requests");
const { checkinWritableFields } = require("../anthropometry/anthropometry-origin");
const { isReadOnly } = require("./trainer-seat-service");
const {
  SCOPES,
  activeScopes,
  hasActiveScope,
  hasOpenLink,
  pendingLinks,
  openLink,
  latestRevokedAt,
  activeSince,
  intakePendingOnAccept,
  intakeStatusOf,
  invitationView,
  invitationsOf,
} = require("./pair-state");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

// Datos de perfil que el cuestionario confirma y reescribe en `User` (los
// metió el cliente al registrarse). Rangos = los mismos que valida el
// schema / sign-up. El peso no: es una medida (ver submitIntake). `birth`
// es un día "YYYY-MM-DD" tal cual (users/age-policy.js); `today`, el del
// cliente.
function extractUserProfilePatch(data, today) {
  const patch = {};
  if (num(data.height) >= 70 && num(data.height) <= 300) patch.height = num(data.height);
  if (data.sex === 0 || data.sex === 1) patch.sex = data.sex;
  if (isOldEnough(data.birth, today)) patch.birth = data.birth;
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

const SCOPE_NAMES = { training: "entrenamiento", nutrition: "nutrición" };

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

// El formulario de alta del par: la copia que se hizo al invitar. Un par sin
// copia (creado a mano, sin pasar por una invitación) recibe el de un
// profesional sin configuración: todos los campos y nada más.
function intakeFormOfPair(pair) {
  return pair?.intakeForm || intakeFormOf(null);
}

// Respuestas del formulario + las propias validadas contra las preguntas de
// su formulario (ver forms/custom-question.js#buildCustomAnswers).
function intakeAnswers(form, data, options) {
  const { answers, error } = buildCustomAnswers(form.customQuestions, data.customAnswers, options);
  if (error) throw badRequest(error, "INVALID_CUSTOM_ANSWER");
  return { ...sanitizeIntakeAnswers(data), customAnswers: answers };
}

const progressMediaService = () => require("../progressMedia/progress-media-service");
const mediaService = () => require("../media/media-service");

/**
 * Lo que el profesional pidió además de preguntas (medidas, fotos y vídeos;
 * trainerIntakeConfig/intake-requests.js), validado contra el formulario del
 * par. Solo lo puede mandar el cliente. Sin almacenamiento de fotos o
 * vídeos configurado, esas peticiones dejan de ser obligatorias: el cliente
 * no podría cumplirlas. Devuelve lo que se guarda en el cuestionario y los
 * días de progreso que quedan enviados al profesional.
 */
async function intakeRequestAnswers(form, clientId, data) {
  const measured = buildIntakeMeasurements(form.measurements, data.measurements);
  if (measured.error) throw badRequest(measured.error, "INVALID_INTAKE_MEASUREMENT");

  const available = mediaService().uploadsAvailable();
  let photosDay = null;
  if (form.photos) {
    photosDay = data.photosDayId ? await progressMediaService().ownDayWithPhotos(clientId, data.photosDayId) : null;
    const error = intakePhotosError({ ...form.photos, required: form.photos.required && available.images }, photosDay);
    if (error) throw badRequest(error, "INTAKE_PHOTOS_MISSING");
  }

  const sentVideos = Array.isArray(data.videos) ? data.videos : [];
  const videoDays = await progressMediaService().ownVideoDays(clientId, sentVideos.map((video) => video?.assetId));
  const requests = form.videos.map((request) => ({ ...request, required: request.required && available.videos }));
  const built = buildIntakeVideos(requests, sentVideos, new Set(videoDays.keys()));
  if (built.error) throw badRequest(built.error, "INVALID_INTAKE_VIDEO");

  return {
    measurements: measured.measurements,
    photosDayId: photosDay?._id || null,
    videos: built.videos,
    sentDayIds: [photosDay?._id, ...built.videos.map((video) => videoDays.get(video.assetId))],
  };
}

// Las medidas del cuestionario van a su Anthropometry de `date`, marcadas
// como pedidas por el profesional (como las de un check-in, ver
// anthropometry-origin.js): nunca pisan lo que el cliente apuntó él mismo
// ese día.
async function saveIntakeMeasurements(clientId, date, measurements) {
  if (!measurements.length) return;
  const existing = await anthropometryDao.getAnthropometryByUserIdAndDate(clientId, date);
  const fields = checkinWritableFields(existing, anthropometryFieldsOf(measurements));
  if (Object.keys(fields).length) await anthropometryDao.mergeAnthropometryFields(clientId, date, fields, { fromCheckin: true });
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

    // Lo que tiene activo ahora mismo en su cuestionario de alta: se copia
    // al par con la invitación.
    const intakeForm = await trainerIntakeConfigService.intakeFormFor(trainerId);

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
      // El formulario que rellenará: el de esta invitación, salvo que ya
      // tenga uno en curso y enviado (un scope más con quien ya es cliente
      // no le abre otro cuestionario, ver pair-state.js#intakePendingOnAccept).
      if (outcome.some((result) => result.success) && (!hasActiveScope(pair) || pair.intakePending)) {
        await trainerClientDao.setIntakeForm(trainerId, clientEmail, intakeForm);
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

  // Invitaciones sin responder del cliente: UNA por profesional, con todos
  // los scopes a los que le invita (se aceptan o rechazan juntos), de la
  // más reciente a la más antigua.
  async listPendingForClient(clientEmail) {
    const pairs = await trainerClientDao.findPairsWithPendingInvitations(clientEmail);
    return pairs
      .map((pair) => {
        const links = pendingLinks(pair);
        return {
          trainerId: pair.trainerId?._id || pair.trainerId,
          trainer: personOf(pair.trainerId),
          scopes: links.map((link) => link.scope),
          invitedAt: new Date(Math.max(...links.map((link) => new Date(link.invitedAt).getTime()))),
        };
      })
      .sort((a, b) => b.invitedAt - a.invitedAt);
  },

  // Profesionales en curso del cliente, uno por par con sus scopes activos y
  // desde cuándo trabajan juntos.
  async listActiveProfessionalsForClient(clientId) {
    const pairs = await trainerClientDao.findActivePairsOfClient(clientId, { withTrainer: true });
    return pairs.map((pair) => ({ user: personOf(pair.trainerId), scopes: activeScopes(pair), since: activeSince(pair) }));
  },

  /**
   * El cliente acepta o rechaza la invitación de un profesional: todos los
   * scopes que tenga sin responder con él, de una vez (un solo «Aceptar»
   * y un solo cuestionario de alta aunque lleve entrenamiento y nutrición).
   * Responder dos veces es idempotente. Aceptar formaliza la relación al
   * momento (el cliente ya sale en la cartera); el cuestionario queda
   * pendiente aparte, sin bloquear nada. La plaza (una por persona) se
   * comprueba y se ocupa bajo el bloqueo de altas. Un scope en el que
   * entretanto aceptó a otro profesional sigue sin responder (`pending`).
   * null si ese profesional no le ha invitado nunca.
   */
  async respondToInvites(trainerId, clientUser, decision) {
    const pair = await trainerClientDao.findPairByEmail(trainerId, clientUser.email);
    if (!pair) return null;
    const pending = pendingLinks(pair);
    const response = (answered, waiting = []) => ({
      trainerId: pair.trainerId,
      scopes: answered.map((link) => link.scope),
      pending: waiting.map((link) => link.scope),
    });
    if (!pending.length) return response([]);

    if (decision === "decline") {
      const declined = await trainerClientDao.declineInvitations(pair._id, pending.map((link) => link._id));
      return response(declined ? pending : []);
    }

    // Puede haber aceptado a otro profesional del mismo scope entretanto.
    const acceptable = [];
    const overlapping = [];
    for (const link of pending) {
      const taken = await trainerClientDao.hasOtherActiveTrainer({
        clientEmail: pair.clientEmail,
        clientId: clientUser._id,
        scope: link.scope,
        excludingTrainerId: pair.trainerId,
      });
      (taken ? overlapping : acceptable).push(link);
    }
    if (!acceptable.length) {
      const names = overlapping.map((link) => SCOPE_NAMES[link.scope]).join(" y ");
      throw badRequest(`Ya tienes otro profesional que lleva tu ${names}`, "OVERLAP");
    }

    const accepted = await withAdmission(pair.trainerId, async (_admission, capacity) => {
      await require("./trainer-seat-service").assertSeatForAcceptance(pair.trainerId, clientUser._id, capacity);
      const current = await trainerClientDao.findPairByEmail(pair.trainerId, pair.clientEmail);
      return trainerClientDao.acceptInvitations(pair._id, acceptable.map((link) => link._id), clientUser._id, {
        intakePending: intakePendingOnAccept(current),
      });
    });
    if (!accepted) return response([], overlapping);

    const answered = response(acceptable, overlapping);
    await notificationDao.createForTrainer(pair.trainerId, clientUser._id, "invite_accepted", { scopes: answered.scopes });
    return answered;
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

    const form = intakeFormOfPair(pair);
    const answers = intakeAnswers(form, intakeData, { requireAll: true });
    const { sentDayIds, ...requested } = await intakeRequestAnswers(form, clientId, intakeData);
    const today = await todayForUser(clientId);
    const saved = await trainerClientDao.submitIntake(pair._id, {
      ...answers,
      ...requested,
      measuredOn: requested.measurements.length ? today : null,
    });
    await saveIntakeMeasurements(clientId, today, requested.measurements);
    await progressMediaService().linkIntake(sentDayIds, trainerId);
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
    const userPatch = extractUserProfilePatch(intakeData, today);
    const weight = num(intakeData.weight) >= 30 && num(intakeData.weight) <= 300 ? num(intakeData.weight) : null;
    if (Object.keys(userPatch).length) await userDao.updateProfile(clientId, userPatch);
    if (weight !== null) await anthropometryDao.upsertOwnFields(clientId, today, { weight });
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

  // El cuestionario como lo ve el profesional. El formulario escribe en
  // varios sitios (ver submitIntake): sus respuestas, el perfil en User, la
  // nutrición en User.nutritionPreferences y las fotos y vídeos en su
  // progreso; se devuelven todos, con los valores actuales.
  async getIntakeWithAnswers(trainerId, clientId, { baseUrl } = {}) {
    const pair = await requireActivePair(trainerId, clientId, "No tienes una relación con este cliente que permita ver su cuestionario");
    return intakeForTrainer(trainerId, clientId, pair, { baseUrl });
  },

  // El profesional corrige el cuestionario: solo las respuestas, sin cambiar
  // el estado del envío ni repetir los efectos del envío del cliente. Las
  // medidas, fotos y vídeos son del cliente: no se tocan.
  async updateIntake(trainerId, clientId, data, { baseUrl } = {}) {
    const pair = await requireActivePair(trainerId, clientId, "No tienes una relación con este cliente que permita editar su cuestionario");
    const form = intakeFormOfPair(pair);
    const answers = intakeAnswers(form, data, { previous: pair.intake?.customAnswers || [] });
    const saved = await trainerClientDao.updateIntakeAnswers(pair._id, answers);
    return intakeForTrainer(trainerId, clientId, saved, { baseUrl });
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
   * que le pide su formulario (campos, preguntas propias, medidas, fotos y
   * vídeos; la copia que se hizo al invitarle). `uploads`: si ahora mismo se
   * pueden subir fotos y vídeos (sin almacenamiento, esos pasos no se
   * enseñan y no son obligatorios). Nunca bloquea la app.
   */
  async getOnboardingStatus(clientId) {
    const pairs = (await trainerClientDao.findActivePairsOfClient(clientId, { withTrainer: true }))
      .filter((pair) => intakeStatusOf(pair));
    if (!pairs.length) return { professionals: [] };

    return {
      uploads: mediaService().uploadsAvailable(),
      professionals: pairs.map((pair) => {
        const scopes = activeScopes(pair);
        const form = intakeFormOfPair(pair);
        return {
          trainerId: String(pair.trainerId._id),
          trainer: personOf(pair.trainerId),
          scopes,
          intakeStatus: intakeStatusOf(pair),
          intakeEnabledFields: intakeFieldsFor(form.enabledFields, scopes),
          intakeCustomQuestions: form.customQuestions.map(({ _id, label, type, unit, options, required }) => ({
            _id,
            label,
            type,
            unit,
            options,
            required,
          })),
          intakeMeasurements: form.measurements.map(({ key, required }) => ({ key, required })),
          intakePhotos: form.photos ? { poses: form.photos.poses, required: form.photos.required } : null,
          intakeVideos: form.videos.map(({ _id, label, required }) => ({ _id, label, required })),
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

// El cuestionario del par para el profesional: con el perfil y la nutrición
// actuales, las vistas de sus fotos y vídeos (URL firmadas) y lo que se le
// pidió (`requested`), para ver también lo opcional que no mandó.
async function intakeForTrainer(trainerId, clientId, pair, { baseUrl } = {}) {
  if (!pair?.intake) return null;
  const [withProfile, media] = await Promise.all([
    withProfileAndNutrition(pair.intake, clientId),
    progressMediaService().intakeMediaForTrainer(trainerId, clientId, pair.intake, { baseUrl }),
  ]);
  const { photosDayId: _photosDayId, ...rest } = withProfile;
  const form = intakeFormOfPair(pair);
  return {
    ...rest,
    photos: media.photos,
    videos: media.videos,
    requested: {
      measurements: form.measurements.map(({ key, required }) => ({ key, required })),
      photos: form.photos ? { poses: form.photos.poses, required: form.photos.required } : null,
      videos: form.videos.map(({ _id, label, required }) => ({ _id: String(_id), label, required })),
    },
  };
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
