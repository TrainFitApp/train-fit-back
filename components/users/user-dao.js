const mongoose = require("mongoose");
const userSchema = require("./user-schema");
const { activePremiumFilter } = require("../billing/feature-access");

// Recuento de documentos de `from` del usuario sin traérselos.
const countLookup = (from, as) => ({
  $lookup: {
    from,
    let: { userId: "$_id" },
    pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$userId"] } } }, { $count: "n" }],
    as,
  },
});
const firstCount = (field) => ({ $ifNull: [{ $arrayElemAt: [`$${field}.n`, 0] }, 0] });

// Lo que pinta la lista de usuarios del panel admin: datos de cuenta y
// recuentos. Nunca contraseña, códigos, sesión ni datos personales de salud.
function adminListStages() {
  return [
    countLookup("products", "_products"),
    countLookup("exercises", "_exercises"),
    countLookup("dietdays", "_dietDays"),
    {
      $project: {
        name: 1,
        lastname: 1,
        email: 1,
        roles: 1,
        provider: 1,
        lastLogin: 1,
        premium: 1,
        // Cuenta sin verificar: el panel ofrece borrar el código (no lo ve).
        pendingActivation: { $gt: [{ $strLenCP: { $ifNull: ["$hash", ""] } }, 0] },
        productsCount: firstCount("_products"),
        exercisesCount: firstCount("_exercises"),
        dietDaysCount: firstCount("_dietDays"),
      },
    },
    { $addFields: { hasDietDays: { $gt: ["$dietDaysCount", 0] } } },
  ];
}

module.exports = {
  async getUserById(id) {
    return userSchema.findOne({ _id: id });
  },

  // Solo los campos pedidos de un usuario o de varios (nombres para pintar
  // listas de otro usuario). Nunca el documento entero.
  async findFields(id, fields) {
    return userSchema.findById(id).select(fields).lean();
  },

  async listFields(ids, fields) {
    if (!ids?.length) return [];
    return userSchema.find({ _id: { $in: ids } }).select(fields).lean();
  },

  async findFieldsByEmail(email, fields) {
    return userSchema.findOne({ email }).select(fields).lean();
  },

  // De `ids`, los que casan con `pattern` en nombre, apellidos o correo.
  async filterIdsByText(ids, pattern) {
    if (!ids?.length) return [];
    const rows = await userSchema
      .find({ _id: { $in: ids }, $or: [{ name: pattern }, { lastname: pattern }, { email: pattern }] })
      .select("_id")
      .lean();
    return rows.map((row) => String(row._id));
  },

  // Plazas activas elegidas por el profesional (trainer-seat-service.js).
  async setTrainerSeats(trainerId, trainerSeats) {
    await userSchema.updateOne({ _id: trainerId }, { $set: { trainerSeats } });
  },

  // Solo lectura: el último acceso lo fija la sesión al emitirse
  // (auth/session-service.js#issue), no buscar a alguien por su email.
  async findByEmail(email) {
    return userSchema.findOne({ email });
  },

  async findByAppleId(appleId) {
    return userSchema.findOne({ appleId });
  },

  // Alta directa (profesional, registro social): el pre("save") cifra la
  // contraseña si la hay.
  async create(data) {
    return userSchema.create(data);
  },

  async linkAppleId(userId, appleId) {
    return userSchema.findByIdAndUpdate(userId, { $set: { appleId } }, { new: true });
  },

  async setRoles(userId, roles) {
    return userSchema.findByIdAndUpdate(userId, { $set: { roles } }, { new: true });
  },

  // El usuario de cada petición autenticada, sin los campos que no viajan
  // (validateAuth.js).
  async findForRequest(userId, excludedFields) {
    return userSchema.findById(userId).select(excludedFields);
  },

  async setTimeZone(userId, timezone) {
    await userSchema.updateOne({ _id: userId }, { $set: { timezone } });
  },

  // --- Sesión (User.auth: una sola sesión viva por usuario) ---
  async startSession(userId, auth, at = new Date()) {
    return userSchema.findByIdAndUpdate(userId, { $set: { lastLogin: at, auth } }, { new: true });
  },

  async touchSession(userId) {
    return userSchema.findByIdAndUpdate(userId, { $set: { "auth.lastUsedAt": new Date() } }, { new: true });
  },

  // Cierra la sesión solo si sigue siendo `sessionId` (otra posterior no se toca).
  async clearSessionIfCurrent(userId, sessionId) {
    if (!userId || !sessionId) return null;
    return userSchema.findOneAndUpdate({ _id: userId, "auth.sessionId": sessionId }, { $unset: { auth: 1 } }, { new: true });
  },

  async clearSession(userId) {
    if (!userId) return null;
    return userSchema.findByIdAndUpdate(userId, { $unset: { auth: 1 } });
  },


  async searchUsers(page, limit, searchTerm, filters = {}) {
    try {
      const normalizedSearch = searchTerm?.trim() || "";
      const query = {};
      const conditions = [];

      if (filters?.premiumOnly) {
        // Solo premium VIGENTE: un entitled=true con la fecha pasada (webhook
        // de EXPIRATION perdido) ya no es premium.
        conditions.push(activePremiumFilter());
      }

      if (filters?.withHashOnly) {
        query.hash = { $exists: true, $nin: [null, ""] };
      }

      if (normalizedSearch) {
        conditions.push({
          $or: [
            { email: { $regex: normalizedSearch, $options: "i" } },
            { name: { $regex: normalizedSearch, $options: "i" } },
            { lastname: { $regex: normalizedSearch, $options: "i" } },
          ],
        });
      }
      if (conditions.length) query.$and = conditions;

      const total = await userSchema.countDocuments(query);

      if (!normalizedSearch) {
        const users = await userSchema.aggregate([
          { $match: query },
          { $sort: { lastLogin: -1 } },
          { $skip: page * limit },
          { $limit: limit },
          ...adminListStages(),
        ]);

        return { users, total };
      }

      const users = await userSchema.aggregate([
        { $match: query },
        {
          $addFields: {
            matchCount: {
              $sum: [
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$email",
                        regex: normalizedSearch,
                        options: "i",
                      },
                    },
                    1,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$name",
                        regex: normalizedSearch,
                        options: "i",
                      },
                    },
                    1,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$lastname",
                        regex: normalizedSearch,
                        options: "i",
                      },
                    },
                    1,
                    0,
                  ],
                },
              ],
            },
          },
        },
        { $sort: { matchCount: -1, lastLogin: -1 } },
        { $skip: page * limit },
        { $limit: limit },
        ...adminListStages(),
      ]);

      return { users, total };
    } catch (error) {
      console.error("Error al buscar usuarios:", error);
      throw new Error("No se pudo completar la búsqueda de usuarios.");
    }
  },

  // Alta por email. Una cuenta que existe sin nombre (empezada por otra vía
  // y nunca completada) se completa en vez de chocar con el email único.
  async createOrCompleteByEmail(user) {
    const existing = await userSchema.findOne({ email: user.email });
    if (existing && !existing.name) {
      Object.assign(existing, user);
      return existing.save();
    }
    return userSchema.create(user);
  },

  // Campos del perfil ya filtrados (users/user-profile.js#pickProfile y
  // #pointerChanges) y los que se quitan.
  async updateProfile(userId, set, unset = []) {
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (unset.length) update.$unset = Object.fromEntries(unset.map((field) => [field, ""]));
    if (!Object.keys(update).length) return userSchema.findById(userId);
    return userSchema.findByIdAndUpdate(userId, update, { new: true, runValidators: true });
  },

  async updateVerificationHash(userId, hash, expiresAt) {
    return userSchema.findByIdAndUpdate(
      userId,
      { $set: { hash, hashExpiresAt: expiresAt, hashFailedAttempts: 0, lastHashSentAt: new Date() } },
      { new: true },
    );
  },

  // --- Código de verificación del alta ---
  async findVerificationState(email) {
    return userSchema.findOne({ email }).select("_id email name hash hashExpiresAt hashFailedAttempts lastHashSentAt").lean();
  },

  // Guarda un código nuevo solo si el último se mandó antes de
  // `cooldownCutoff`: comprobación y escritura en una sola operación
  // atómica, así dos reenvíos concurrentes no pueden colarse los dos. null si
  // no pasó el filtro.
  async setVerificationCodeIfIdle(userId, hash, expiresAt, cooldownCutoff) {
    return userSchema.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { lastHashSentAt: { $exists: false } },
          { lastHashSentAt: null },
          { lastHashSentAt: { $lte: cooldownCutoff } },
        ],
      },
      { $set: { hash, hashExpiresAt: expiresAt, hashFailedAttempts: 0, lastHashSentAt: new Date() } },
      { new: true },
    );
  },

  async countVerificationFailure(userId) {
    await userSchema.updateOne({ _id: userId }, { $inc: { hashFailedAttempts: 1 } });
  },

  // Un código acertado deja de valer en el acto, aunque no haya caducado.
  async clearVerification(userId) {
    return userSchema.findByIdAndUpdate(
      userId,
      { $unset: { hash: 1, hashExpiresAt: 1, hashFailedAttempts: 1, lastHashSentAt: 1 } },
      { new: true },
    );
  },

  // Activación por enlace: solo si el código coincide, en una operación.
  async activateByHash(userId, hash) {
    if (!mongoose.isValidObjectId(userId) || typeof hash !== "string" || !hash) return null;
    return userSchema.findOneAndUpdate({ _id: userId, hash }, { $unset: { hash: "" } }, { new: true });
  },

  // --- Código para restablecer la contraseña ---
  async findRestoreState(email) {
    return userSchema
      .findOne({ email })
      .select("_id email lastRestoreCodeSentAt restoreCodeDate restoreCodeDailyCount")
      .lean();
  },

  // Mismo cerrojo atómico que setVerificationCodeIfIdle. null si no pasó.
  async setRestoreCodeIfIdle(userId, fields, cooldownCutoff) {
    return userSchema.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { lastRestoreCodeSentAt: { $exists: false } },
          { lastRestoreCodeSentAt: null },
          { lastRestoreCodeSentAt: { $lte: cooldownCutoff } },
        ],
      },
      { $set: fields },
      { new: true },
    );
  },

  async findForRestore(email) {
    return userSchema.findOne({ email });
  },

  async countRestoreFailure(userId) {
    await userSchema.updateOne({ _id: userId }, { $inc: { restoreFailedAttempts: 1 } });
  },

  // Nueva contraseña (la cifra el pre("save") del schema) y fuera el código.
  async resetPassword(userDoc, password) {
    userDoc.restoreCode = undefined;
    userDoc.restoreCodeExpiresAt = undefined;
    userDoc.restoreFailedAttempts = 0;
    userDoc.lastRestoreCodeSentAt = undefined;
    userDoc.password = password;
    return userDoc.save();
  },

  // La cascada la hace el hook de borrado del schema (util/account-cascade.js).
  async deleteUser(id) {
    return userSchema.deleteOne({ _id: id });
  },

  async clearUserHash(id) {
    return userSchema.findByIdAndUpdate(id, { $unset: { hash: 1 } }, { new: true });
  },
};
