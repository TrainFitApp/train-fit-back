const exerciseSchema = require("./exercise-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const userSchema = require("../users/schema");
const { Types } = require("mongoose");
const { cleanObject } = require("../util/clean-data");
const {
  normalizeMuscles,
  toLegacyMuscleGroups,
  fromLegacyMuscleGroups,
  expandMuscleFilter,
} = require("./muscle-catalog");

// updateOne no pasa por el hook pre("validate") del schema: la sincronía
// entre `muscles` y la proyección antigua se hace aquí, con las mismas
// funciones. Si llega `muscles`, manda; si solo llega el modelo antiguo (la
// app cliente edita así sus ejercicios propios), se traduce.
function withSyncedMuscles(fields) {
  if (Array.isArray(fields.muscles)) {
    const muscles = normalizeMuscles(fields.muscles);
    return { ...fields, muscles, ...toLegacyMuscleGroups(muscles) };
  }
  if (Array.isArray(fields.muscleGroups1) || Array.isArray(fields.muscleGroups2)) {
    const { muscles } = fromLegacyMuscleGroups(fields.muscleGroups1, fields.muscleGroups2);
    // Solo "Piernas" o "Brazos" no dicen qué músculo es: mejor conservar lo
    // que ya había que borrarlo.
    return muscles.length ? { ...fields, muscles } : fields;
  }
  return fields;
}

// trainerId set = plantilla suelta (ver workout-schema.js). Se pasa
// trainerId:{$ne:null} explícito para saltar el guardarraíl por defecto del
// schema (que excluye plantillas cuando el caller no filtra por trainerId).
async function getTemplateExerciseIds() {
  const templates = await workoutSchema
    .find({ trainerId: { $ne: null } }, "exercises")
    .lean();
  return templates.flatMap((t) => t.exercises || []).map(String);
}

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

  async getExercise(id) {
    return new Promise((resolve, reject) =>
      exerciseSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async countByUserId(userId) {
    return exerciseSchema.countDocuments({ userId });
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

      // Filtro por músculo del catálogo de dos niveles (2026-09): ejercicios
      // en los que ese músculo es PRINCIPAL. Con secundarios, buscar
      // "Tríceps" traería todos los presses de pecho. Las versiones de la
      // app anteriores siguen mandando muscleGroups1/2 y se atienden abajo.
      const muscleIds = expandMuscleFilter(searchExercisesFilterGroup.muscles);
      if (muscleIds.length > 0) {
        agg.push({
          $match: {
            muscles: { $elemMatch: { muscle: { $in: muscleIds }, role: "primary" } },
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

      if (searchExercisesFilterGroup.isCardio === true) {
        agg.push({
          $match: {
            isCardio: true,
          },
        });
      }

      if (searchExercisesFilterGroup.isIsometric === true) {
        agg.push({
          $match: {
            isIsometric: true,
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
                $or: [
                  { name: { $regex: term, $options: "i" } },
                  { keywords: { $regex: term, $options: "i" } },
                ],
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
    const cleanedExercise = cleanObject(exercise);
    return new Promise((resolve, reject) =>
      exerciseSchema.create(cleanedExercise, (err, docs) => {
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

  async updateExercise(id, exercise) {
    const cleanedExercise = withSyncedMuscles(cleanObject(exercise));
    const update = {};

    if (Object.keys(cleanedExercise).length > 0) {
      update.$set = cleanedExercise;
    }

    update.$unset = update.$unset || {};
    if (exercise?.isCardio !== true) {
      update.$unset.isCardio = "";
    }
    if (exercise?.isIsometric !== true) {
      update.$unset.isIsometric = "";
    }
    if (Object.keys(update.$unset).length === 0) {
      delete update.$unset;
    }

    if (Object.keys(update).length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

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

  // TASK-016 (MASTER_BACKLOG.md) — borrar un Exercise referenciado deja
  // `exercise: null` tras el autopopulate en CustomExercise, tanto en
  // rutinas reales de clientes como en plantillas del entrenador (desde la
  // unificación workoutTemplates -> workouts, ambas son CustomExercise,
  // distinguibles solo subiendo al Workout padre vía trainerId). Se
  // comprueba uso real vs. uso en plantilla por separado para no perder la
  // distinción que ya mostraba el frontend.
  async countWorkoutTemplateUsage(id) {
    const templateExerciseIds = await getTemplateExerciseIds();
    if (templateExerciseIds.length === 0) return 0;
    return customExerciseSchema.countDocuments({
      exercise: id,
      _id: { $in: templateExerciseIds },
    });
  },

  async countCustomExerciseUsage(id) {
    const [total, templateExerciseIds] = await Promise.all([
      customExerciseSchema.countDocuments({ exercise: id }),
      getTemplateExerciseIds(),
    ]);
    if (templateExerciseIds.length === 0) return total;
    const templateUsage = await customExerciseSchema.countDocuments({
      exercise: id,
      _id: { $in: templateExerciseIds },
    });
    return total - templateUsage;
  },
};
