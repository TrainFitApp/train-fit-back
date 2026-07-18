const userSchema = require("./schema");
const dietDayUtil = require("../dietDays/diet-days-util");
const dietDayModel = require("../dietDays/diet-days-service");
const dietUtil = require("../diets/diet-util");
const dietModel = require("../diets/diet-model");
const aggregateService = require("../util/aggregate-service");
const mail = require("../util/mail");
const recipeSchema = require("../recipes/recipe-schema");
const recipeModel = require("../recipes/recipe-model");

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
          { $lookup: { from: "diets", localField: "dietInUse", foreignField: "_id", as: "dietInUseDoc" } },
          {
            $addFields: {
              productsCount: { $size: { $ifNull: ["$createdProducts", []] } },
              exercisesCount: { $size: { $ifNull: ["$createdExercises", []] } },
              hasWorkoutInUse: { $gt: ["$workoutInUse", null] },
              hasTableInUse: { $gt: ["$tableInUse", null] },
              hasDietInUse: { $gt: ["$dietInUse", null] },
              tableSplitsCount: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$tableInUseDoc", []] } }, 0] },
                  { $size: { $ifNull: [{ $arrayElemAt: ["$tableInUseDoc.splits", 0] }, []] } },
                  0
                ]
              },
              dietDaysCount: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$dietInUseDoc", []] } }, 0] },
                  { $size: { $ifNull: [{ $arrayElemAt: ["$dietInUseDoc.dietsDay", 0] }, []] } },
                  0
                ]
              }
            }
          },
          {
            $project: { createdProducts: 0, createdExercises: 0, tableInUseDoc: 0, workoutInUseDoc: 0, dietInUseDoc: 0 }
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
        { $lookup: { from: "diets", localField: "dietInUse", foreignField: "_id", as: "dietInUseDoc" } },
        {
          $addFields: {
            productsCount: { $size: { $ifNull: ["$createdProducts", []] } },
            exercisesCount: { $size: { $ifNull: ["$createdExercises", []] } },
            hasWorkoutInUse: { $gt: ["$workoutInUse", null] },
            hasTableInUse: { $gt: ["$tableInUse", null] },
            hasDietInUse: { $gt: ["$dietInUse", null] },
            tableSplitsCount: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$tableInUseDoc", []] } }, 0] },
                { $size: { $ifNull: [{ $arrayElemAt: ["$tableInUseDoc.splits", 0] }, []] } },
                0
              ]
            },
            dietDaysCount: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$dietInUseDoc", []] } }, 0] },
                { $size: { $ifNull: [{ $arrayElemAt: ["$dietInUseDoc.dietsDay", 0] }, []] } },
                0
              ]
            }
          }
        },
        {
          $project: { createdProducts: 0, createdExercises: 0, tableInUseDoc: 0, workoutInUseDoc: 0, dietInUseDoc: 0 }
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
      const standardDietDay = dietDayUtil.getStandardDietDay(date);
      const dietDay = await dietDayModel.createDietDay(standardDietDay);

      const diet = dietUtil.getStandarDiet();
      diet.dietsDay.push(dietDay._id);
      const createdDiet = await dietModel.createDiet(diet);

      // const standardWorkout = workoutUtil.getStandarWorkout(date);
      // const workout = await workoutService.createWorkout(standardWorkout);

      // const standardSplit = splitUtil.getStandarSplit();
      // standardSplit.workouts.push(workout._id);
      // const createdSplit = await splitModel.createSplit(standardSplit);

      // const standardtable = tableUtil.getStandardTable();
      // standardtable.splits.push(createdSplit._id);
      // const createdTable = await tableModel.createTable(standardtable);

      // user.tableInUse = createdTable._id;
      user.dietInUse = createdDiet._id;

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

      return userDoc;
    } catch (err) {
      throw err;
    }
  },

  async createUserWithGoogle(user, date) {
    try {
      const standardDietDay = dietDayUtil.getStandardDietDay(date);
      const dietDay = await dietDayModel.createDietDay(standardDietDay);

      const diet = dietUtil.getStandarDiet();
      diet.dietsDay.push(dietDay._id);
      const createdDiet = await dietModel.createDiet(diet);

      user.dietInUse = createdDiet._id;

      const userDoc = await userSchema.create(user);

      return userDoc;
    } catch (err) {
      throw err;
    }
  },

  async createUserWithApple(user, date) {
    try {
      const standardDietDay = dietDayUtil.getStandardDietDay(date);
      const dietDay = await dietDayModel.createDietDay(standardDietDay);

      const diet = dietUtil.getStandarDiet();
      diet.dietsDay.push(dietDay._id);
      const createdDiet = await dietModel.createDiet(diet);

      user.dietInUse = createdDiet._id;

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

  async addUserDiet(idUser, idDiet) {
    const addDiet = {
      $set: { dietInUse: idDiet },
    };

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
      ["tableInUse", "workoutInUse", "dietInUse", "goalInUse"].forEach((field) => {
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

  async updateVerificationHash(userId, hash) {
    try {
      return await userSchema.findByIdAndUpdate(
        userId,
        { $set: { hash } },
        { new: true },
      );
    } catch (err) {
      throw err;
    }
  },

  async playStopDiet(id, dietInUse) {
    const update = { $set: { dietInUse } };

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

  async restorePassword(email, password) {
    return await userSchema.findOneAndUpdate(
      { email: email },
      { $set: { password: password } },
    );
  },

  async updatePassword(email, password) {
    const user = await userSchema.findOne({ email: email });
    if (!user) throw new Error("User not found.");

    user.password = password; // Update the password directly on the document
    await user.save(); // Save the updated document with the hashed password
    return user;
  },

  async sendMailCode(email, hash, expiresAt) {
    try {
      // Validar que el email existe (formato + dominio con MX)
      const emailExists = await mail.validateEmailExists(email);
      if (!emailExists) {
        throw new Error("Invalid or non-existent email address");
      }

      // Buscar usuario en BD
      const user = await userSchema.findOne({ email }).select("email lastRestoreCodeSentAt");
      if (!user) {
        throw new Error("User not found");
      }

      // Rate limit: 60s entre envíos
      if (user.lastRestoreCodeSentAt && (Date.now() - user.lastRestoreCodeSentAt.getTime()) < 60000) {
        throw new Error("Espera 60 segundos antes de solicitar un nuevo código");
      }

      const updatedUser = await userSchema.findByIdAndUpdate(user._id, {
        $set: {
          hash,
          restoreCodeExpiresAt: expiresAt,
          restoreFailedAttempts: 0,
          lastRestoreCodeSentAt: new Date(),
        },
      }, { new: true });
      if (!updatedUser) {
        throw new Error("User not found");
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

      if (user.hash !== hash) {
        await userSchema.findByIdAndUpdate(user._id, {
          $inc: { restoreFailedAttempts: 1 },
        });
        throw new Error("Código incorrecto");
      }

      user.hash = undefined;
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
