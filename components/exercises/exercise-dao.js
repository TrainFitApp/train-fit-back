const favoritesDao = require("../favorites/favorites-dao");
const exerciseSchema = require("./exercise-schema");
const WorkoutBase = require("../workouts/workout-base-schema");
const { Types } = require("mongoose");
const { cleanObject } = require("../util/clean-data");
const { normalizeMuscles, expandMuscleFilter } = require("./muscle-catalog");
const { createAccentInsensitiveRegex } = require("../util/accent-insensitive-regex");

// updateOne no pasa por el hook pre("validate") del schema: `muscles` se
// deja en forma canónica aquí, con la misma función.
function withSyncedMuscles(fields) {
  return Array.isArray(fields.muscles) ? { ...fields, muscles: normalizeMuscles(fields.muscles) } : fields;
}

// Cuántas veces aparece el ejercicio: en plantillas sueltas del entrenador
// por un lado y en sesiones de rutinas por otro (las dos en `workouts`).
async function countExerciseUsage(id) {
  const exerciseId = new Types.ObjectId(String(id));
  const [row] = await WorkoutBase.aggregate([
    { $match: { "exercises.exercise": exerciseId } },
    { $unwind: "$exercises" },
    { $match: { "exercises.exercise": exerciseId } },
    {
      $group: {
        _id: null,
        templates: { $sum: { $cond: [{ $eq: ["$kind", "template"] }, 1, 0] } },
        sessions: { $sum: { $cond: [{ $eq: ["$kind", "template"] }, 0, 1] } },
      },
    },
  ]);
  return { templates: row?.templates || 0, sessions: row?.sessions || 0 };
}

// Etapas de la búsqueda de ejercicios, filtros incluidos. null cuando no
// puede haber resultados (filtro de favoritos sin ninguno marcado).
async function buildSearchPipeline(searchExercisesFilterGroup) {
  // Los ejercicios retirados (deletedAt) no salen nunca en la búsqueda.
  const agg = [{ $match: { deletedAt: null } }];

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
    const favIds = await favoritesDao.list(searchExercisesFilterGroup.userId, "exercises");
    if (favIds.length > 0) {
      agg.push({ $match: { _id: { $in: favIds } } });
    } else {
      // Sin favoritos no hay nada que buscar.
      return null;
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

  // Filtro por músculo del catálogo de dos niveles: ejercicios en los
  // que ese músculo es PRINCIPAL. Con secundarios, buscar "Tríceps"
  // traería todos los presses de pecho.
  const muscleIds = expandMuscleFilter(searchExercisesFilterGroup.muscles);
  if (muscleIds.length > 0) {
    agg.push({
      $match: {
        muscles: { $elemMatch: { muscle: { $in: muscleIds }, role: "primary" } },
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

  // Fuerza = ni cardio ni isométrico (mismo criterio que la
  // clasificación de table-dao). Los flags solo se guardan cuando son
  // true, así que se excluye con $ne en vez de buscar false.
  if (searchExercisesFilterGroup.isStrength === true) {
    agg.push({
      $match: {
        isCardio: { $ne: true },
        isIsometric: { $ne: true },
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

      const regexTerms = searchTerms.map(createAccentInsensitiveRegex);

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

  // Orden fijo para paginar con skip: sin él, Mongo no garantiza el mismo
  // orden entre dos consultas y una página podía repetir o saltarse
  // ejercicios de la anterior. _id mantiene el orden de alta de siempre.
  agg.push({ $sort: { _id: 1 } });

  return agg;
}

module.exports = {
  async getExercise(id) {
    return exerciseSchema.findById(id);
  },

  // Ejercicios propios vivos (los retirados no cuentan para el límite).
  async countByUserId(userId) {
    return exerciseSchema.countDocuments({ userId, deletedAt: null });
  },

  async getSearchExercise(page, limit, searchExercisesFilterGroup) {
    const agg = await buildSearchPipeline(searchExercisesFilterGroup);
    if (!agg) return [];

    return exerciseSchema
      .aggregate(agg)
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  // Lo mismo que getSearchExercise más el total de coincidencias, en una
  // sola consulta ($facet): el buscador necesita saber cuántas hay y cuándo
  // dejar de pedir páginas.
  async searchExercisePage(page, limit, searchExercisesFilterGroup) {
    const agg = await buildSearchPipeline(searchExercisesFilterGroup);
    if (!agg) return { items: [], total: 0 };

    const [result] = await exerciseSchema.aggregate([
      ...agg,
      {
        $facet: {
          items: [{ $skip: page * limit }, { $limit: limit }],
          total: [{ $count: "n" }],
        },
      },
    ]);

    return { items: result?.items || [], total: result?.total?.[0]?.n || 0 };
  },

  async createExercise(exercise) {
    return exerciseSchema.create(cleanObject(exercise));
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

    return exerciseSchema.updateOne({ _id: id }, update);
  },

  // Un ejercicio que alguna sesión usa no se borra: se retira (deletedAt)
  // para que esas sesiones lo sigan pintando. Solo se borra el que nadie usa.
  async deleteExercise(id) {
    const usage = await countExerciseUsage(id);
    if (usage.templates + usage.sessions > 0) {
      await exerciseSchema.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
      await exerciseSchema.pullFromFavorites([new Types.ObjectId(String(id))]);
      return { deletedCount: 0, retired: true };
    }
    return exerciseSchema.deleteOne({ _id: id });
  },

  // Borrado de cuenta (exercise-schema.js, cuando ya no existen las rutinas
  // ni las plantillas de la propia cuenta): los ejercicios propios que siguen
  // en sesiones o plantillas de otros (el entrenador que los pautó a sus
  // clientes) se retiran sin dueño, como deleteExercise, y salen de las
  // favoritas. Los demás los borra la cascada; antes se borraban todos y el
  // borrado se llevaba esos ejercicios del historial de los clientes.
  async releaseOwnExercises(userId) {
    const own = await exerciseSchema.find({ userId }).distinct("_id");
    if (!own.length) return;
    const used = await WorkoutBase.distinct("exercises.exercise", { "exercises.exercise": { $in: own } });
    const usedIds = own.filter((id) => used.some((usedId) => String(usedId) === String(id)));
    if (!usedIds.length) return;
    await exerciseSchema.updateMany({ _id: { $in: usedIds } }, { $set: { userId: null, deletedAt: new Date() } });
    await exerciseSchema.pullFromFavorites(usedIds);
  },

  countExerciseUsage,

  // Uso en plantillas del entrenador y en rutinas reales, por separado (el
  // frontend muestra la distinción).
  async countWorkoutTemplateUsage(id) {
    return (await countExerciseUsage(id)).templates;
  },

  async countCustomExerciseUsage(id) {
    return (await countExerciseUsage(id)).sessions;
  },
};
