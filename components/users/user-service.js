const crypto = require("node:crypto");
const userDao = require("./user-dao");
const userDto = require("./user-dto");
const mail = require("../util/mail");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const jwt = require("jsonwebtoken");
const { generateVerificationCode } = require("../util/verification-code");
const { assertBirth } = require("./age-policy");
const { pickProfile, pointerChanges, parseWeight } = require("./user-profile");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { todayForUser } = require("./user-time-zone");
const { todayIsoDate } = require("../util/date-util");
const { routineInUseOf, routineInUseOfId, routinesInUseOf } = require("../routineAssignments/routine-in-use");
const bcrypt = require("../util/bcrypt");
const { httpError, badRequest, conflict, notFound, onDuplicate } = require("../util/http-error");

const HASH_CODE_TTL_MS = 15 * 60 * 1000;
const RESTORE_CODE_TTL_MS = 15 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_RESTORE_CODES_PER_DAY = 3;

const tooManyRequests = (message, code) => httpError(429, message, code);
const cooldownActive = () => tooManyRequests("Espera unos segundos antes de solicitar un nuevo código", "COOLDOWN_ACTIVE");
const userNotFound = () => notFound("Usuario no encontrado", "USER_NOT_FOUND");
const alreadyVerified = () => badRequest("Esta cuenta ya ha sido verificada", "ALREADY_VERIFIED");
// Restablecer la contraseña: el mismo error para todo (código mal, caducado,
// demasiados intentos o cuenta que no existe), para no revelar nada.
const invalidRestoreCode = () => badRequest("Codigo invalido o expirado", "INVALID_RESTORE_CODE");

// Una carrera entre dos altas con el mismo correo la para el índice único.
const rethrowDuplicate = onDuplicate("Este usuario ya está registrado");

// Alta por email: el correo tiene que existir (DNS/MX) y no tener ya una
// cuenta con perfil (un registro social a medias sí se completa).
async function assertEmailAvailable(email) {
  if (!email) throw badRequest("Email requerido");
  if (!(await mail.validateEmailExists(email))) throw badRequest("El correo no existe");
  const existing = await userDao.findByEmail(email);
  if (existing?.name) throw conflict("Este usuario ya está registrado");
}

function sendVerificationMail(email, name, code, subject) {
  const html = mail.generateHashMail(
    `Hola ${name}, verifique su cuenta`,
    "Introduce el siguiente código en la aplicación para finalizar el registro.",
    code,
  );
  return mail.sendTransactionalMail(email, subject, html);
}

// El objetivo inicial que manda la app al registrarse.
const initialGoal = (body) => ({
  name: "Default",
  kcalTotal: body.kcalTotal || 0,
  proteinsGTotal: body.proteinsGTotal || 0,
  carbohydratesGTotal: body.carbohydratesGTotal || 0,
  fatGTotal: body.fatGTotal || 0,
});
const axios = require("axios");
const jwkToPem = require("jwk-to-pem");

const GOOGLE_ALLOWED_CLIENT_IDS = (
  process.env.GOOGLE_ALLOWED_CLIENT_IDS ||
  [
    "775987417074-s1e767h7tps05ectmrb85uqh7hhp9p8n.apps.googleusercontent.com",
    "775987417074-ibu27rm1ku8uuunaacebmp14ahvuuk4u.apps.googleusercontent.com",
  ].join(",")
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

module.exports = {
  async getUserById(id) {
    return userDao.getUserById(id);
  },

  async countUsers() {
    return userDao.countUsers();
  },

  async getUserByEmail(email) {
    return await userDao.findByEmail(email);
  },

  async getUserByAppleId(appleId) {
    return await userDao.findByAppleId(appleId);
  },

  // Panel admin: la rutina y la sesión que cada usuario tiene en uso se
  // calculan como en sus apps (routine-in-use.js), con dos consultas para toda
  // la página y otra para los microciclos de esas rutinas.
  async searchUsers(page, limit, search, filters) {
    const result = await userDao.searchUsers(page, limit, search, filters);
    // El listado sale de un aggregate (sin DTO): el premium caducado tiene
    // que salir como no premium igual que en el resto de respuestas.
    const routines = await routinesInUseOf(result.users.map((user) => user._id));
    const tableIds = [...new Set([...routines.values()].map((routine) => routine.tableInUse).filter(Boolean).map(String))];
    const splitsCount = await require("../tables/table-dao").countSplitsByTable(tableIds);
    return {
      ...result,
      users: result.users.map((user) => {
        const routine = routines.get(String(user._id));
        return {
          ...user,
          premium: userDto.resolvePremium(user),
          hasTableInUse: Boolean(routine?.tableInUse),
          hasWorkoutInUse: Boolean(routine?.workoutInUse),
          tableSplitsCount: routine?.tableInUse ? splitsCount.get(String(routine.tableInUse)) || 0 : 0,
        };
      }),
    };
  },

  // El usuario tal como lo ven sus apps: el DTO más su último peso (vive en
  // sus medidas) y la rutina que tiene en uso (se calcula con sus fases).
  async view(user, authUser) {
    if (!user) return null;
    const [latest, routine] = await Promise.all([
      anthropometryDao.findLatestWeight(user._id),
      routineInUseOf(user),
    ]);
    return userDto.single(user, authUser, { weight: latest?.weight ?? null, routine });
  },

  // El peso que se escribe desde el perfil (registro, editor, cuestionario)
  // es una medida de hoy, en la zona del usuario.
  async recordWeight(userId, weight) {
    if (weight === null) return;
    await anthropometryDao.upsertOwnFields(userId, await todayForUser(userId), { weight });
  },

  /**
   * Alta de cliente por email: su perfil (lista blanca), contraseña, el peso
   * de hoy en sus medidas, el objetivo inicial que calculó la app y el correo
   * con su código de verificación (15 minutos). `timeZone` es la del
   * dispositivo (cabecera X-Timezone, null si no vino): sin ella, la edad
   * mínima y el día del primer peso saldrían de la zona por defecto.
   */
  async registerClient(email, body, timeZone = null) {
    await assertEmailAvailable(email);
    assertBirth(body?.birth, todayIsoDate(timeZone));
    const weight = parseWeight(body?.weight);
    const code = generateVerificationCode();
    const created = await userDao
      .createOrCompleteByEmail({
        ...pickProfile(body),
        ...(timeZone ? { timezone: timeZone } : {}),
        password: body?.password,
        email,
        roles: ["user"],
        hash: code,
        hashExpiresAt: new Date(Date.now() + HASH_CODE_TTL_MS),
        lastHashSentAt: new Date(),
      })
      .catch(rethrowDuplicate);
    await this.recordWeight(created._id, weight);
    if (body?.kcalTotal || body?.proteinsGTotal || body?.carbohydratesGTotal || body?.fatGTotal) {
      const goal = await nutritionalGoalService.createForUser(created._id, initialGoal(body));
      created.goalInUse = goal._id;
    }
    await sendVerificationMail(created.email, created.name, code, "Verificación de cuenta - TrainFit");
    return created;
  },

  async addUserTable(idUser, idTable) {
    return userDao.addUserTable(idUser, idTable);
  },

  // Editor de perfil: solo los campos del perfil (lista blanca) y el peso de
  // hoy. `timeZone`: la del usuario (req.auth.timeZone).
  async updateUser(body, timeZone) {
    const { tableInUse, workoutInUse, ...fields } = pickProfile(body, { pointers: true });
    assertBirth(fields.birth, todayIsoDate(timeZone));
    const weight = parseWeight(body?.weight);
    const requested = pickProfile({ tableInUse, workoutInUse }, { pointers: true });
    const pointers = Object.keys(requested).length
      ? pointerChanges(requested, await routineInUseOfId(body._id))
      : { set: {}, unset: [] };
    const updated = await userDao.updateProfile(body._id, { ...fields, ...pointers.set }, pointers.unset);
    if (updated) await this.recordWeight(updated._id, weight);
    return updated;
  },

  async updateVerificationHash(userId, hash, expiresAt) {
    return await userDao.updateVerificationHash(userId, hash, expiresAt);
  },

  // Reenvío del código de verificación del alta (botón "Reenviar código").
  // Como mucho uno por minuto (cerrojo atómico en el DAO).
  async resendVerificationCode(email) {
    if (!(await mail.validateEmailExists(email))) throw badRequest("Email inválido", "INVALID_EMAIL");
    const state = await userDao.findVerificationState(email);
    if (!state) throw userNotFound();
    if (!state.hash) throw alreadyVerified();

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + HASH_CODE_TTL_MS);
    const updated = await userDao.setVerificationCodeIfIdle(state._id, code, expiresAt, new Date(Date.now() - CODE_COOLDOWN_MS));
    if (!updated) throw cooldownActive();

    const html = mail.generateHashMail(
      `Hola ${updated.name}, verifique su cuenta`,
      "Introduce el siguiente código en la aplicación para finalizar el registro.",
      code,
    );
    await mail.sendTransactionalMail(updated.email, "Verificación de cuenta - TrainFit", html);
    return updated;
  },

  // Verificación del código del alta: intentos y caducidad primero; un fallo
  // suma un intento; un acierto invalida el código en el acto.
  // Cuenta sin verificar que intenta entrar: código nuevo (15 minutos) y
  // correo con él.
  async sendFreshVerificationCode(user, subject = "Verificación de cuenta - TrainFit") {
    const code = generateVerificationCode();
    await userDao.updateVerificationHash(user._id, code, new Date(Date.now() + HASH_CODE_TTL_MS));
    await sendVerificationMail(user.email, user.name, code, subject);
  },

  // Alta de un profesional (TrainFit: Entrenadores): sin objetivo ni nada de
  // cliente consumidor; con su código de verificación por correo.
  async createProfessional({ name, lastname, email, password }) {
    if (!name || !lastname || !email || !password) {
      throw badRequest("Nombre, apellidos, email y contraseña son obligatorios");
    }
    await assertEmailAvailable(email);
    const code = generateVerificationCode();
    const user = await userDao
      .create({
        name,
        lastname,
        email,
        password,
        roles: ["trainer"],
        hash: code,
        hashExpiresAt: new Date(Date.now() + HASH_CODE_TTL_MS),
        lastHashSentAt: new Date(),
      })
      .catch(rethrowDuplicate);
    await sendVerificationMail(user.email, name, code, "Verificación de cuenta - TrainFit Entrenadores");
    return user;
  },

  // Registro social: la cuenta nace sin perfil (lo completa después
  // completeSocialProfile).
  async createSocialUser({ email, appleId, provider }) {
    return userDao.create({ email, appleId: appleId || undefined, roles: ["user"], provider });
  },

  linkAppleId: (userId, appleId) => userDao.linkAppleId(userId, appleId),
  setRoles: (userId, roles) => userDao.setRoles(userId, roles),
  startSession: (userId, auth, at) => userDao.startSession(userId, auth, at),
  touchSession: (userId) => userDao.touchSession(userId),
  clearSessionIfCurrent: (userId, sessionId) => userDao.clearSessionIfCurrent(userId, sessionId),
  clearSession: (userId) => userDao.clearSession(userId),

  async verifyActivationCode(email, code) {
    const state = await userDao.findVerificationState(email);
    if (!state) throw userNotFound();
    if (!state.hash) throw alreadyVerified();
    if ((state.hashFailedAttempts || 0) >= MAX_CODE_ATTEMPTS) {
      throw tooManyRequests("Demasiados intentos fallidos. Solicita un nuevo código.", "TOO_MANY_ATTEMPTS");
    }
    if (state.hashExpiresAt && Date.now() > new Date(state.hashExpiresAt).getTime()) {
      throw badRequest("Código expirado. Solicita uno nuevo.", "CODE_EXPIRED");
    }
    if (state.hash !== code) {
      await userDao.countVerificationFailure(state._id);
      throw badRequest("Código incorrecto", "INVALID_CODE");
    }
    return userDao.clearVerification(state._id);
  },

  // Fin del registro social (Google/Apple): mismo perfil que el registro
  // por email y el objetivo inicial que calculó la app.
  async completeSocialProfile(userId, body, timeZone) {
    const fields = pickProfile(body);
    assertBirth(fields.birth, todayIsoDate(timeZone));
    const weight = parseWeight(body?.weight);
    const updated = await userDao.updateProfile(userId, fields);
    if (!updated) throw userNotFound();
    await this.recordWeight(updated._id, weight);
    if (body.kcalTotal || body.proteinsGTotal || body.carbohydratesGTotal || body.fatGTotal) {
      const goal = await nutritionalGoalService.createForUser(updated._id, initialGoal(body));
      updated.goalInUse = goal._id;
    }
    return updated;
  },

  // Código para restablecer la contraseña: como mucho uno por minuto y tres
  // al día por email (cerrojo atómico en el DAO). Un correo sin cuenta no da
  // error (no se revela si existe); el reenvío demasiado pronto y el límite
  // diario sí, porque quien lo pide necesita saber que no se ha enviado.
  async sendMailCode(email) {
    if (!email || !(await mail.validateEmailExists(email))) return null;
    const state = await userDao.findRestoreState(email);
    if (!state) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isNewDay = (state.restoreCodeDate || new Date(0)).getTime() < today.getTime();
    const sentToday = isNewDay ? 0 : state.restoreCodeDailyCount || 0;
    if (sentToday >= MAX_RESTORE_CODES_PER_DAY) {
      throw tooManyRequests("Has alcanzado el límite diario de códigos. Intenta de nuevo mañana.", "DAILY_LIMIT_REACHED");
    }

    // 8 caracteres [0-9a-z], con crypto: este código restablece la contraseña.
    const code = Array.from({ length: 8 }, () => crypto.randomInt(36).toString(36)).join("");
    const updated = await userDao.setRestoreCodeIfIdle(
      state._id,
      {
        restoreCode: code,
        restoreCodeExpiresAt: new Date(Date.now() + RESTORE_CODE_TTL_MS),
        restoreFailedAttempts: 0,
        lastRestoreCodeSentAt: new Date(),
        restoreCodeDate: today,
        restoreCodeDailyCount: sentToday + 1,
      },
      new Date(Date.now() - CODE_COOLDOWN_MS),
    );
    if (!updated) throw cooldownActive();

    const html = mail.generateHashMail(`Hola ${state.email}`, "Este es tu código de verificación. Copia y pégalo en la app.", code);
    await mail.sendTransactionalMail(state.email, "Código de verificación", html);
    return updated;
  },

  // Nueva contraseña con el código recibido: intentos y caducidad primero; un
  // fallo suma un intento. Con la contraseña nueva se cierra la sesión que
  // hubiera abierta.
  async checkRestoreCode(email, password, hash) {
    const user = await userDao.findForRestore(email);
    const reject = (reason) => {
      console.warn("[AUTH] password_reset_code_rejected", { reason });
      return invalidRestoreCode();
    };
    if (!user) throw reject("user_not_found");
    if ((user.restoreFailedAttempts || 0) >= MAX_CODE_ATTEMPTS) throw reject("too_many_attempts");
    if (user.restoreCodeExpiresAt && Date.now() > user.restoreCodeExpiresAt.getTime()) throw reject("code_expired");
    if (user.restoreCode !== hash) {
      await userDao.countRestoreFailure(user._id);
      throw reject("invalid_code");
    }
    const updated = await userDao.resetPassword(user, password);
    if (updated?._id) await userDao.clearSession(updated._id);
    return updated;
  },

  // Antes de borrar la cuenta o cambiar algo delicado: la contraseña del
  // usuario de la sesión (nunca de un id que llegue en la petición).
  async verifyOwnPassword(userId, password) {
    if (!password) throw badRequest("Contraseña requerida");
    const user = await userDao.getUserById(userId);
    if (!user) throw userNotFound();
    // Cuenta social (Google/Apple) sin contraseña propia: nada que verificar.
    if (!user.password) throw badRequest("Esta cuenta no tiene contraseña configurada", "NO_PASSWORD_SET");
    if (!bcrypt.comparePasswords(password, user.password)) throw httpError(401, "Contraseña incorrecta", "WRONG_PASSWORD");
  },

  async sendSuggestions(email, suggestions) {
    return mail.sendSuggestionMail(email, suggestions);
  },

  // Antes de borrar, el flujo de cancelación de la facturación de
  // entrenadores; la cascada la hace el hook del schema.
  async deleteUser(id) {
    await require("../trainerBilling/adapter").prepareDeletion(id);
    return userDao.deleteUser(id);
  },

  // Activación por enlace del correo. null si el código no vale o ya se usó.
  async checkHash(id, hash) {
    return userDao.activateByHash(id, hash);
  },

  async clearUserHash(id) {
    return userDao.clearUserHash(id);
  },

  async validateGoogleToken(token) {
    try {
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader) throw new Error("Token inválido");

      const kid = decodedHeader.header.kid;

      // Obtener claves públicas de Google
      const url = "https://www.googleapis.com/oauth2/v3/certs";
      const response = await axios.get(url);
      const claves = response.data.keys;

      // Buscar la clave pública correcta
      const key = claves.find((k) => k.kid === kid);
      if (!key) throw new Error("No se encontró la clave pública adecuada");

      // Convertir la clave pública de JWK a PEM
      const publicKey = jwkToPem(key);

      const payload = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        audience: GOOGLE_ALLOWED_CLIENT_IDS,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });

      if (!payload?.email) {
        throw new Error("El token de Google no contiene email");
      }

      if (!payload?.email_verified) {
        throw new Error("El email de Google no está verificado");
      }

      return payload;
    } catch (error) {
      throw new Error(`Error en la validación: ${error.message}`);
    }
  },

  async validateAppleToken(token) {
    try {
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader) throw new Error("Token de Apple inválido");

      const kid = decodedHeader.header.kid;

      const url = "https://appleid.apple.com/auth/keys";
      const response = await axios.get(url);
      const claves = response.data.keys;

      const key = claves.find((k) => k.kid === kid);
      if (!key)
        throw new Error("No se encontró la clave pública de Apple adecuada");

      const publicKey = jwkToPem(key);

      const audiences = (
        process.env.APPLE_ALLOWED_AUDIENCES ||
        [process.env.APPLE_BUNDLE_ID, process.env.APPLE_SERVICE_ID]
          .filter(Boolean)
          .join(",")
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      const verifyOptions = {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
      };

      if (audiences.length === 1) {
        verifyOptions.audience = audiences[0];
      } else if (audiences.length > 1) {
        verifyOptions.audience = audiences;
      }

      const payload = jwt.verify(token, publicKey, verifyOptions);

      return payload;
    } catch (error) {
      throw new Error(`Error en la validación de Apple: ${error.message}`);
    }
  },
};
