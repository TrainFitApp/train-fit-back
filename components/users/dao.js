const userSchema = require("./schema");
const dietDayUtil = require("../dietDays/diet-days-util");
const dietDayModel = require("../dietDays/diet-days-service");
const dietModel = require("../diets/diet-model");
const aggregateService = require("../util/aggregate-service");
const mail = require("../util/mail");
const recipeSchema = require("../recipes/recipe-schema");
const recipeModel = require("../recipes/recipe-model");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");

module.exports = {
  async getUserById(id) {
    return new Promise((resolve, reject) =>
      userSchema.findOne({ _id: id }).exec((err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async findByEmail(email) {
    try {
      return await userSchema.findOneAndUpdate(
        { email: email },
        { lastLogin: new Date() },
      );
    } catch (err) {
      throw err;
    }
  },

  async findByAppleId(appleId) {
    try {
      return await userSchema.findOne({ appleId: appleId });
    } catch (err) {
      throw err;
    }
  },

  async existsByEmail(email) {
    try {
      const exists = await userSchema.exists({ email });
      return !!exists;
    } catch (err) {
      throw err;
    }
  },

  async countUsers() {
    try {
      const userCounts = {
        online: await userSchema.countDocuments({
          lastLogin: {
            $gte: new Date(new Date().getTime() - 10 * 60 * 1000), // Al menos hace 10 minutos
            $lte: new Date(),
          },
        }),
        total: await userSchema.countDocuments(),
      };

      return userCounts;
    } catch (e) {
      throw e;
    }
  },

  async searchUsers(page, limit, searchTerm, filters = {}) {
    try {
      const normalizedSearch = searchTerm?.trim() || "";
      const query = {};

      if (filters?.premiumOnly) {
        query["premium.entitled"] = true;
      }

      if (filters?.withHashOnly) {
        query.hash = { $exists: true, $nin: [null, ""] };
      }

      if (normalizedSearch) {
        query.$or = [
          { email: { $regex: normalizedSearch, $options: "i" } },
          { name: { $regex: normalizedSearch, $options: "i" } },
          { lastname: { $regex: normalizedSearch, $options: "i" } },
        ];
      }

      const total = await userSchema.countDocuments(query);

      if (!normalizedSearch) {
        const users = await userSchema.aggregate([
          { $match: query },
          { $sort: { lastLogin: -1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $lookup: { from: "products", localField: "_id", foreignField: "userId", as: "createdProducts" } },
          { $lookup: { from: "exercises", localField: "_id", foreignField: "userId", as: "createdExercises" } },
          { $lookup: { from: "tables", localField: "tableInUse", foreignField: "_id", as: "tableInUseDoc" } },
          { $lookup: { from: "workouts", localField: "workoutInUse", foreignField: "_id", as: "workoutInUseDoc" } },
          // Refactor nutrición (2026-09) — los días cuelgan del usuario, no de un
          // wrapper Diet: se cuentan directos por userId.
          { $lookup: { from: "dietdays", localField: "_id", foreignField: "userId", as: "dietDayDocs" } },
          {
            $addFields: {
              productsCount: { $size: { $ifNull: ["$createdProducts", []] } },
              exercisesCount: { $size: { $ifNull: ["$createdExercises", []] } },
              hasWorkoutInUse: { $gt: ["$workoutInUse", null] },
              hasTableInUse: { $gt: ["$tableInUse", null] },
              hasDietInUse: { $gt: [{ $size: { $ifNull: ["$dietDayDocs", []] } }, 0] },
              tableSplitsCount: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$tableInUseDoc", []] } }, 0] },
                  { $size: { $ifNull: [{ $arrayElemAt: ["$tableInUseDoc.splits", 0] }, []] } },
                  0
                ]
              },
              dietDaysCount: { $size: { $ifNull: ["$dietDayDocs", []] } }
            }
          },
          {
            $project: { createdProducts: 0, createdExercises: 0, tableInUseDoc: 0, workoutInUseDoc: 0, dietDayDocs: 0 }
          }
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
        { $lookup: { from: "products", localField: "_id", foreignField: "userId", as: "createdProducts" } },
        { $lookup: { from: "exercises", localField: "_id", foreignField: "userId", as: "createdExercises" } },
        { $lookup: { from: "tables", localField: "tableInUse", foreignField: "_id", as: "tableInUseDoc" } },
        { $lookup: { from: "workouts", localField: "workoutInUse", foreignField: "_id", as: "workoutInUseDoc" } },
        // Refactor nutrición (2026-09) — los días cuelgan del usuario, no de un
          // wrapper Diet: se cuentan directos por userId.
          { $lookup: { from: "dietdays", localField: "_id", foreignField: "userId", as: "dietDayDocs" } },
        {
          $addFields: {
            productsCount: { $size: { $ifNull: ["$createdProducts", []] } },
            exercisesCount: { $size: { $ifNull: ["$createdExercises", []] } },
            hasWorkoutInUse: { $gt: ["$workoutInUse", null] },
            hasTableInUse: { $gt: ["$tableInUse", null] },
            hasDietInUse: { $gt: [{ $size: { $ifNull: ["$dietDayDocs", []] } }, 0] },
            tableSplitsCount: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$tableInUseDoc", []] } }, 0] },
                { $size: { $ifNull: [{ $arrayElemAt: ["$tableInUseDoc.splits", 0] }, []] } },
                0
              ]
            },
            dietDaysCount: { $size: { $ifNull: ["$dietDayDocs", []] } }
          }
        },
        {
          $project: { createdProducts: 0, createdExercises: 0, tableInUseDoc: 0, workoutInUseDoc: 0, dietDayDocs: 0 }
        }
      ]);

      return { users, total };
    } catch (error) {
      console.error("Error al buscar usuarios:", error);
      throw new Error("No se pudo completar la búsqueda de usuarios.");
    }
  },

  async login(user) {
    return new Promise((resolve, reject) =>
      userSchema.login(user, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async createUser(user, date) {
    try {
      // Refactor nutrición (2026-09) — ya no se crea una Diet + DietDay al
      // dar de alta al usuario. El día lo crea resolveOwnedDietDay en el
      // primer acceso, y además le aplica el plan activo si lo hay (cosa que
      // esta creación temprana no hacía). Aquí, encima, el día se creaba
      // ANTES de que el usuario existiera, así que ni siquiera podía llevar
      // dueño.

      // const standardWorkout = workoutUtil.getStandarWorkout(date);
      // const workout = await workoutService.createWorkout(standardWorkout);

      // const standardSplit = splitUtil.getStandarSplit();
      // standardSplit.workouts.push(workout._id);
      // const createdSplit = await splitModel.createSplit(standardSplit);

      // const standardtable = tableUtil.getStandardTable();
      // standardtable.splits.push(createdSplit._id);
      // const createdTable = await tableModel.createTable(standardtable);

      // user.tableInUse = createdTable._id;

      let userDoc;
      if (user) {
        let existingUser = await userSchema.findOne({ email: user.email });
        if (existingUser && !existingUser.name) {
          Object.assign(existingUser, user);
          userDoc = await existingUser.save();
        } else {
          userDoc = await userSchema.create(user);
        }
      }

      if (userDoc && (user.kcalTotal || user.proteinsGTotal || user.carbohydratesGTotal || user.fatGTotal)) {
        const goal = await nutritionalGoalService.create({
          userId: userDoc._id,
          name: 'Default',
          kcalTotal: user.kcalTotal || 0,
          proteinsGTotal: user.proteinsGTotal || 0,
          carbohydratesGTotal: user.carbohydratesGTotal || 0,
          fatGTotal: user.fatGTotal || 0,
        });
        userDoc.goalInUse = goal._id;
        await userDoc.save();
      }

      return userDoc;
    } catch (err) {
      throw err;
    }
  },

  async createUserWithGoogle(user, date) {
    try {
      // Refactor nutrición (2026-09) — ya no se crea una Diet + DietDay al
      // dar de alta al usuario. El día lo crea resolveOwnedDietDay en el
      // primer acceso, y además le aplica el plan activo si lo hay (cosa que
      // esta creación temprana no hacía). Aquí, encima, el día se creaba
      // ANTES de que el usuario existiera, así que ni siquiera podía llevar
      // dueño.

      const userDoc = await userSchema.create(user);

      return userDoc;
    } catch (err) {
      throw err;
    }
  },

  async createUserWithApple(user, date) {
    try {
      // Refactor nutrición (2026-09) — ya no se crea una Diet + DietDay al
      // dar de alta al usuario. El día lo crea resolveOwnedDietDay en el
      // primer acceso, y además le aplica el plan activo si lo hay (cosa que
      // esta creación temprana no hacía). Aquí, encima, el día se creaba
      // ANTES de que el usuario existiera, así que ni siquiera podía llevar
      // dueño.

      const userDoc = await userSchema.create(user);

      return userDoc;
    } catch (err) {
      throw err;
    }
  },

  async updateGoogleUser(userUpdate) {
    try {
      const findUser = await userSchema.findOne({ email: userUpdate.email });
      if (!findUser) throw new Error("User not found");
      const idUser = findUser._id;
      const safeUpdate = { ...userUpdate };
      [
        "_id",
        "isPremium",
        "premium",
        "roles",
        "provider",
        "auth",
        "refreshToken",
        "previousRefreshToken",
        "tokenRotationTimestamp",
        "hash",
      ].forEach((field) => delete safeUpdate[field]);

      const user = await userSchema.findByIdAndUpdate(idUser, safeUpdate, {
        new: true,
      });

      return user;
    } catch (err) {
      throw err;
    }
  },

  async updateAppleUser(userUpdate) {
    try {
      const findUser = await userSchema.findOne({ email: userUpdate.email });
      if (!findUser) throw new Error("User not found");
      const idUser = findUser._id;
      const safeUpdate = { ...userUpdate };
      [
        "_id",
        "isPremium",
        "premium",
        "roles",
        "provider",
        "auth",
        "refreshToken",
        "previousRefreshToken",
        "tokenRotationTimestamp",
        "hash",
      ].forEach((field) => delete safeUpdate[field]);

      const user = await userSchema.findByIdAndUpdate(idUser, safeUpdate, {
        new: true,
      });

      return user;
    } catch (err) {
      throw err;
    }
  },

  async searchArchivedsByFilter(node, archivedNode, search) {
    const agg = [
      {
        $match: {
          [`${archivedNode}`]: { $exists: true, $ne: [] },
        },
      },
      {
        $lookup: {
          from: node,
          localField: `${archivedNode}`,
          foreignField: "_id",
          as: `${archivedNode}`,
        },
      },
      {
        $unwind: `$${archivedNode}`,
      },
      {
        $match: {
          [`${archivedNode}.name`]: { $regex: search, $options: "i" },
        },
      },
      {
        $group: {
          _id: "$_id",
          [`${archivedNode}`]: { $push: `$${archivedNode}` },
        },
      },
    ];

    try {
      return await aggregateService.aggregateFilter(
        await userSchema.aggregate(agg),
        archivedNode,
      );
    } catch (err) {
      throw err;
    }
  },

  // Refactor nutrición (2026-09) — sin wrapper Diet no hay nada que
  // "asignar": los días ya cuelgan del usuario. Se mantiene el método (y su
  // ruta) para no romper las apps instaladas, pero solo devuelve el usuario.
  async addUserDiet(idUser, _idDiet) {
    const addDiet = { $set: {} };

    return new Promise((resolve, reject) =>
      userSchema.findByIdAndUpdate(
        idUser,
        addDiet,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async addUserTable(idUser, idTable) {
    const addTable = {
      $set: { tableInUse: idTable },
    };

    return new Promise((resolve, reject) =>
      userSchema.findByIdAndUpdate(
        idUser,
        addTable,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async updateUser(user) {
    try {
      const blockedFields = new Set([
        "_id",
        "isPremium",
        "premium",
        "roles",
        "provider",
        "auth",
        "refreshToken",
        "previousRefreshToken",
        "tokenRotationTimestamp",
        "hash",
        "appleId",
        "goalInUse",
      ]);

      const safeInput = {};
      Object.keys(user || {}).forEach((key) => {
        if (
          !blockedFields.has(key) &&
          !key.startsWith("$") &&
          !key.includes(".")
        ) {
          safeInput[key] = user[key];
        }
      });

      const update = { $set: safeInput, $unset: {} };
      ["tableInUse", "workoutInUse"].forEach((field) => {
        if (safeInput[field] === null || safeInput[field] === undefined) {
          update.$unset[field] = 1;
          delete update.$set[field];
        }
      });

      if (Object.keys(update.$set).length === 0) delete update.$set;
      if (Object.keys(update.$unset).length === 0) delete update.$unset;

      if (!update.$set && !update.$unset) {
        return await userSchema.findById(user._id);
      }

      return await userSchema.findByIdAndUpdate(user._id, update, {
        new: true,
      });
    } catch (err) {
      throw err;
    }
  },

  async updateVerificationHash(userId, hash, expiresAt) {
    try {
      return await userSchema.findByIdAndUpdate(
        userId,
        {
          $set: {
            hash,
            hashExpiresAt: expiresAt,
            hashFailedAttempts: 0,
            lastHashSentAt: new Date(),
          },
        },
        { new: true },
      );
    } catch (err) {
      throw err;
    }
  },

  // Reenvío explícito del código de verificación de signup (botón "Reenviar
  // código"). El filtro de cooldown va dentro del propio findOneAndUpdate
  // para que la comprobación + sobreescritura sea una única operación
  // atómica a nivel de BD: dos reenvíos concurrentes no pueden colarse los
  // dos, MongoDB serializa las escrituras sobre el mismo documento y solo
  // una gana el filtro de cooldown (evita la condición de carrera).
  async resendVerificationHash(email, hash, expiresAt) {
    try {
      const emailExists = await mail.validateEmailExists(email);
      if (!emailExists) {
        throw new Error("INVALID_EMAIL");
      }

      const user = await userSchema
        .findOne({ email })
        .select("_id email name hash lastHashSentAt");
      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }
      if (!user.hash) {
        throw new Error("ALREADY_VERIFIED");
      }

      const cooldownCutoff = new Date(Date.now() - 60 * 1000);
      const updatedUser = await userSchema.findOneAndUpdate(
        {
          _id: user._id,
          $or: [
            { lastHashSentAt: { $exists: false } },
            { lastHashSentAt: null },
            { lastHashSentAt: { $lte: cooldownCutoff } },
          ],
        },
        {
          $set: {
            hash,
            hashExpiresAt: expiresAt,
            hashFailedAttempts: 0,
            lastHashSentAt: new Date(),
          },
        },
        { new: true },
      );

      if (!updatedUser) {
        throw new Error("COOLDOWN_ACTIVE");
      }

      const header1 = `Hola ${updatedUser.name}, verifique su cuenta`;
      const description =
        "Introduce el siguiente código en la aplicación para finalizar el registro.";
      const htmlMail = mail.generateHashMail(header1, description, hash);
      await mail.sendMailSES(
        updatedUser.email,
        "Verificación de cuenta - TrainFit",
        htmlMail,
      );

      return updatedUser;
    } catch (e) {
      throw e;
    }
  },

  // Verificación del código de signup. Igual que checkRestoreCode: primero
  // se comprueban intentos fallidos/expiración, y en caso de código
  // incorrecto se incrementa el contador; en caso de acierto se invalida el
  // hash (y el resto de metadatos asociados) atómicamente para que quede
  // inutilizable de inmediato, aunque no haya expirado.
  async verifyActivationHash(email, code) {
    try {
      const user = await userSchema.findOne({ email });
      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }
      if (!user.hash) {
        throw new Error("ALREADY_VERIFIED");
      }
      if ((user.hashFailedAttempts || 0) >= 5) {
        throw new Error("TOO_MANY_ATTEMPTS");
      }
      if (user.hashExpiresAt && Date.now() > user.hashExpiresAt.getTime()) {
        throw new Error("CODE_EXPIRED");
      }
      if (user.hash !== code) {
        await userSchema.findByIdAndUpdate(user._id, {
          $inc: { hashFailedAttempts: 1 },
        });
        throw new Error("INVALID_CODE");
      }

      return await userSchema.findByIdAndUpdate(
        user._id,
        {
          $unset: {
            hash: 1,
            hashExpiresAt: 1,
            hashFailedAttempts: 1,
            lastHashSentAt: 1,
          },
        },
        { new: true },
      );
    } catch (e) {
      throw e;
    }
  },

  // El segundo parámetro era el id del wrapper (presente = activar, null =
  // parar). Ahora es directamente el booleano del interruptor.
  async playStopDiet(id, enabled) {
    const update = { $set: { dietEnabled: !!enabled } };

    return new Promise((resolve, reject) =>
      userSchema.findByIdAndUpdate(id, update, { new: true }, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async addFavoriteProduct(idUser, idProduct, productExist) {
    const query = productExist
      ? { $pull: { archivedProducts: idProduct } }
      : { $push: { archivedProducts: idProduct } };
    const doc = await userSchema.findByIdAndUpdate(idUser, query, {
      new: true,
    });
    return doc;
  },

  async addFavoriteRecipe(idUser, idRecipe, isOwn, recipeExist) {
    let node = "archivedRecipes";
    let query = recipeExist
      ? { $pull: { [node]: idRecipe } }
      : { $push: { [node]: idRecipe } };
    const doc = await userSchema.findByIdAndUpdate(idUser, query, {
      new: true,
    });
    return doc;
  },

  async updatePassword(email, password) {
    const user = await userSchema.findOne({ email: email });
    if (!user) throw new Error("User not found.");

    user.password = password; // Update the password directly on the document
    await user.save(); // Save the updated document with the hashed password
    return user;
  },

  // Igual que resendVerificationHash (signup): la comprobación de cooldown y
  // la sobreescritura de restoreCode van dentro del mismo findOneAndUpdate,
  // como una única operación atómica de BD. Antes eran 3 pasos separados
  // (leer -> comprobar en JS -> escribir con findByIdAndUpdate), lo que
  // dejaba una ventana de condición de carrera: dos reenvíos casi
  // simultáneos podían superar los dos la comprobación de cooldown antes de
  // que ninguno hubiese escrito todavía, generando dos códigos/emails
  // distintos donde solo el ganador de la escritura en Mongo quedaba activo
  // (no necesariamente el último correo recibido por el usuario).
  async sendMailCode(email, hash, expiresAt) {
    try {
      // Validar que el email existe (formato + dominio con MX)
      const emailExists = await mail.validateEmailExists(email);
      if (!emailExists) {
        throw new Error("INVALID_EMAIL");
      }

      // Buscar usuario en BD. OJO: select() debe incluir explícitamente
      // restoreCodeDate/restoreCodeDailyCount — antes no se seleccionaban y
      // por tanto currentCount siempre daba 0 y el límite diario nunca se
      // llegaba a aplicar.
      const user = await userSchema
        .findOne({ email })
        .select("_id email lastRestoreCodeSentAt restoreCodeDate restoreCodeDailyCount");
      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      // Daily limit: max 3 códigos por día por email
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastReset = user.restoreCodeDate || new Date(0);
      const isNewDay = lastReset.getTime() < today.getTime();
      const currentCount = isNewDay ? 0 : (user.restoreCodeDailyCount || 0);

      if (currentCount >= 3) {
        throw new Error("DAILY_LIMIT_REACHED");
      }

      const cooldownCutoff = new Date(Date.now() - 60 * 1000);
      const updatedUser = await userSchema.findOneAndUpdate(
        {
          _id: user._id,
          $or: [
            { lastRestoreCodeSentAt: { $exists: false } },
            { lastRestoreCodeSentAt: null },
            { lastRestoreCodeSentAt: { $lte: cooldownCutoff } },
          ],
        },
        {
          $set: {
            restoreCode: hash,
            restoreCodeExpiresAt: expiresAt,
            restoreFailedAttempts: 0,
            lastRestoreCodeSentAt: new Date(),
            restoreCodeDate: today,
            restoreCodeDailyCount: currentCount + 1,
          },
        },
        { new: true },
      );

      if (!updatedUser) {
        throw new Error("COOLDOWN_ACTIVE");
      }

      const html = mail.generateHashMail(
        `Hola ${user.email}`,
        "Este es tu código de verificación. Copia y pégalo en la app.",
        hash,
      );
      await mail.sendMailSES(user.email, "Código de verificación", html);
      return updatedUser;
    } catch (e) {
      throw e;
    }
  },

  async checkRestoreCode(email, password, hash) {
    try {
      const user = await userSchema.findOne({ email });
      if (!user) throw new Error("Usuario no encontrado");

      if ((user.restoreFailedAttempts || 0) >= 5) {
        throw new Error("Demasiados intentos fallidos. Solicita un nuevo código.");
      }

      if (user.restoreCodeExpiresAt && Date.now() > user.restoreCodeExpiresAt.getTime()) {
        throw new Error("Código expirado. Solicita uno nuevo.");
      }

      if (user.restoreCode !== hash) {
        await userSchema.findByIdAndUpdate(user._id, {
          $inc: { restoreFailedAttempts: 1 },
        });
        throw new Error("Código incorrecto");
      }

      user.restoreCode = undefined;
      user.restoreCodeExpiresAt = undefined;
      user.restoreFailedAttempts = 0;
      user.lastRestoreCodeSentAt = undefined;
      user.password = password;

      return await user.save();
    } catch (e) {
      throw e;
    }
  },

  async addFavoriteRecipe(idUser, idRecipe, isOwn, recipeExist) {
    let node = "archivedRecipes";
    let query = recipeExist
      ? { $pull: { [node]: idRecipe } }
      : { $push: { [node]: idRecipe } };
    const doc = await userSchema.findByIdAndUpdate(idUser, query, {
      new: true,
    });
    return doc;
  },

  async deleteUser(id) {
    try {
      const ownRecipes = await recipeSchema.find({ userId: id }).select("_id").lean();

      for (const recipe of ownRecipes) {
        await recipeModel.deleteRecipe(recipe._id);
      }

      return await userSchema.deleteOne({ _id: id });
    } catch (e) {
      throw e;
    }
  },

  async checkHash(id, hash) {
    try {
      // Buscar usuario con el hash específico
      const user = await userSchema.findOne({ _id: id, hash: hash });

      if (!user) {
        console.log(
          `checkHash: No se encontró usuario con id=${id} y hash=${hash}`,
        );
        return null; // Hash inválido o ya usado
      }

      console.log(
        `checkHash: Usuario encontrado, activando cuenta para ${user.email}`,
      );

      // Eliminar el hash para activar la cuenta
      const updatedUser = await userSchema.findByIdAndUpdate(
        id,
        { $unset: { hash: "" } },
        { new: true },
      );

      console.log(
        `checkHash: Cuenta activada exitosamente para ${updatedUser.email}`,
      );
      return updatedUser;
    } catch (err) {
      console.error("Error en checkHash:", err);
      return null;
    }
  },

  async clearUserHash(id) {
    try {
      return await userSchema.findByIdAndUpdate(
        id,
        { $unset: { hash: 1 } },
        { new: true },
      );
    } catch (err) {
      throw err;
    }
  },

};
