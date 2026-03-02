const exerciseSchema = require("./exercise-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const userSchema = require("../users/schema");
const { Types } = require("mongoose");

module.exports = {
  async getExercises(page, limit) {
    return new Promise((resolve, reject) =>
      exerciseSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async getExerciseByCode(barcode) {
    return new Promise((resolve, reject) =>
      exerciseSchema.findOne({ code: barcode }, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async getExercisesByUser(page, limit) {
    return new Promise((resolve, reject) =>
      exerciseSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async getSearchExercise(page, limit, searchExercisesFilterGroup) {
    try {
      const agg = [];

      console.log("[EXERCISE-DAO] Filters:", {
        ownFilter: searchExercisesFilterGroup.ownFilter,
        favFilter: searchExercisesFilterGroup.favFilter,
        userId: searchExercisesFilterGroup.userId,
      });

      // 1) Favoritos: requiere userId + favFilter
      if (
        searchExercisesFilterGroup.favFilter &&
        searchExercisesFilterGroup.userId
      ) {
        const user = await userSchema
          .findById(searchExercisesFilterGroup.userId, { archivedExercises: 1 })
          .lean();
        const favIds = user?.archivedExercises || [];
        console.log("[EXERCISE-DAO] Favorites count:", favIds.length);
        if (favIds.length > 0) {
          agg.push({ $match: { _id: { $in: favIds } } });
        } else {
          // Si no hay favoritos, retornar array vacío
          return [];
        }
      }
      // 2) Propios: si viene userId (ownFilter es redundante)
      else if (searchExercisesFilterGroup.userId) {
        const matchStage = {
          $match: {
            userId: new Types.ObjectId(searchExercisesFilterGroup.userId),
          },
        };
        console.log(
          "[EXERCISE-DAO] Adding own by userId match:",
          JSON.stringify(matchStage),
        );
        agg.push(matchStage);
      }
      // 3) Todo: globales (sin userId)
      else {
        console.log('[EXERCISE-DAO] Adding "Todo" filter (no userId)');
        agg.push({
          $match: {
            $or: [{ userId: { $exists: false } }, { userId: null }],
          },
        });
      }

      // Añade una etapa $match para 'category' si existe en 'searchExercisesFilterGroup'.
      if (
        searchExercisesFilterGroup.category &&
        searchExercisesFilterGroup.category.length > 0
      ) {
        agg.push({
          $match: {
            category: {
              $in: searchExercisesFilterGroup.category,
            },
          },
        });
      }

      // Añade una etapa $match para 'muscleGroups1' si existe en 'searchExercisesFilterGroup'.
      if (
        searchExercisesFilterGroup.muscleGroups1 &&
        searchExercisesFilterGroup.muscleGroups1.length > 0
      ) {
        agg.push({
          $match: {
            muscleGroups1: {
              $in: searchExercisesFilterGroup.muscleGroups1,
            },
          },
        });
      }

      // Añade una etapa $match para 'muscleGroups2' si existe en 'searchExercisesFilterGroup'.
      if (
        searchExercisesFilterGroup.muscleGroups2 &&
        searchExercisesFilterGroup.muscleGroups2.length > 0
      ) {
        agg.push({
          $match: {
            muscleGroups2: {
              $in: searchExercisesFilterGroup.muscleGroups2,
            },
          },
        });
      }

      // Añade una etapa $match para 'equipment' si existe en 'searchExercisesFilterGroup'.
      if (
        searchExercisesFilterGroup.equipment &&
        searchExercisesFilterGroup.equipment.length > 0
      ) {
        agg.push({
          $match: {
            equipment: {
              $in: searchExercisesFilterGroup.equipment,
            },
          },
        });
      }

      // Añade una etapa $match para la búsqueda de texto si existe en 'searchExercisesFilterGroup'.
      if (searchExercisesFilterGroup.search) {
        const searchText = searchExercisesFilterGroup.search.trim();

        if (searchText.length > 0) {
          const searchTerms = searchText
            .split(" ")
            .filter((term) => term.trim().length > 0);

          // Función para crear regex insensible a acentos
          function createAccentInsensitiveRegex(term) {
            return term
              .replace(/[aáàäâ]/gi, "[aáàäâ]")
              .replace(/[eéèëê]/gi, "[eéèëê]")
              .replace(/[iíìïî]/gi, "[iíìïî]")
              .replace(/[oóòöô]/gi, "[oóòöô]")
              .replace(/[uúùüû]/gi, "[uúùüû]")
              .replace(/[nñ]/gi, "[nñ]")
              .replace(/[cç]/gi, "[cç]");
          }

          const regexTerms = searchTerms.map((term) =>
            createAccentInsensitiveRegex(term),
          );

          agg.push({
            $match: {
              $and: regexTerms.map((term) => ({
                name: { $regex: term, $options: "i" },
              })),
            },
          });
        }
      }

      const exerciseDocs = await exerciseSchema
        .aggregate(agg)
        .skip(page * limit)
        .limit(limit)
        .exec();

      return exerciseDocs;
    } catch (err) {
      throw err;
    }
  },

  async createExercise(exercise) {
    return new Promise((resolve, reject) =>
      exerciseSchema.create(exercise, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async archiveExercise(idExercise, idUser) {
    const user = await userSchema.findById(idUser);
    const exerciseExist = !!user.archivedExercises.includes(idExercise);

    const archiveExercise = exerciseExist
      ? { $pull: { archivedExercises: idExercise } }
      : { $push: { archivedExercises: idExercise } };

    try {
      await userSchema.findByIdAndUpdate(idUser, archiveExercise);
      return { isFavorite: !exerciseExist };
    } catch (err) {
      throw err;
    }
  },

  async arhiveExercise(id, exercise) {
    const update = { $set: exercise };

    return new Promise((resolve, reject) =>
      exerciseSchema.updateOne({ _id: id }, update, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async deleteExercise(id) {
    return new Promise((resolve, reject) =>
      exerciseSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },
};
