const splitSchema = require("./split-schema");
const splitService = require("./split-service");
const splitUtil = require("./split-util");
const tableSchema = require("../tables/table-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const workoutService = require("../workouts/workout-service");

const { default: mongoose } = require("mongoose");
const setSchema = require("../sets/set-schema");
const { normalizeSetsOrder } = require("../sets/set-order-util");
const userSchema = require("../users/schema");

const { isSamePermutation } = require("../util/permutation-util");

function normalizeSetForTemplateCopy(setTemp) {
  delete setTemp.doned;
  // Bug: drop/restPause/FALLO (expectedRir con -1) se clonaban tal cual al
  // duplicar semana, así que marcar una técnica en un microciclo terminaba
  // "propagada" al nuevo. Son decisiones de ESA semana, no de la rutina.
  delete setTemp.drop;
  delete setTemp.restPause;
  if (Array.isArray(setTemp.expectedRir) && setTemp.expectedRir.includes(-1)) {
    setTemp.expectedRir = [];
  }
}

// Planificador visual (Fase C) — el nuevo orden de columnas debe ser
// exactamente una permutación de los splits actuales de la tabla: nunca
// añade ni quita splits, solo reordena. Alias local sobre el util
// compartido, mantenido para no romper el nombre ya usado en
// split-dao.test.js.
const isValidSplitPermutation = isSamePermutation;

module.exports = {
  async getSplits(page, limit) {
    return new Promise((resolve, reject) =>
      splitSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async getSplitByCode(barcode) {
    return new Promise((resolve, reject) =>
      splitSchema.findOne({ code: barcode }, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async getSplitsCount() {
    return new Promise((resolve, reject) =>
      splitSchema.estimatedDocumentCount({}).exec((err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async getSplitsByUser(page, limit) {
    return new Promise((resolve, reject) =>
      splitSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async getSearchSplit(page, limit, search) {
    return new Promise((resolve, reject) =>
      splitSchema
        .find({ name: { $regex: search, $options: "i" } })
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async createSplit(split) {
    return new Promise((resolve, reject) =>
      splitSchema.create(split, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async createSplitAndAddToTable(tableInUse, split) {
    try {
      return await this.addSplitToTable(tableInUse._id, split);
    } catch (err) {
      throw err;
    }
  },

  async addSplit(idTable, currentSplit) {
    return new Promise((resolve, reject) => {
      let exercisesFinal = [];
      currentSplit._id = undefined;

      currentSplit.workouts.forEach((w) => {
        w._id = new mongoose.Types.ObjectId();

        w.exercises.forEach((e) => {
          e._id = new mongoose.Types.ObjectId();

          e.sets = [];
          exercisesFinal.push(e);
        });
      });

      splitSchema.create(currentSplit, (err, splitDoc) => {
        if (err) return reject(err);
        const addSplit = { $push: { splits: splitDoc._id } };
        tableSchema.findByIdAndUpdate(
          idTable,
          addSplit,
          {},
          (err2, tableDoc) => {
            if (err2) return reject(err2);
            workoutSchema.insertMany(currentSplit.workouts, (err3, doc) => {
              if (err3) return reject(err3);
              customExerciseSchema.insertMany(exercisesFinal, (err4, doc2) => {
                if (err4) return reject(err4);
                tableSchema.findById(tableDoc._id, (err5, doc) => {
                  if (err5) reject(err5);
                  return resolve(doc);
                });
              });
            });
          },
        );
      });
    });
  },

  async addSplitToTable(idTable, idSplit, withSets) {
    try {
      let tableDoc = await tableSchema.findById(idTable);
      tableDoc = tableDoc.toObject();

      let splitIndex = 0;
      const splitSel = tableDoc.splits.find((splitTemp, index) => {
        if (splitTemp._id.toString() === idSplit) {
          splitIndex = index;
          return splitTemp;
        }
      });

      let newSplit = splitSel ? splitSel : splitUtil.getStandarSplit();

      newSplit._id = new mongoose.Types.ObjectId();

      let newWorkouts = [];
      let newCustomExercises = [];
      let newSets = [];
      newSplit.workouts.forEach((workoutTemp) => {
        workoutTemp._id = new mongoose.Types.ObjectId();
        // Se mantienen las notes del workout al duplicar
        delete workoutTemp.date;
        delete workoutTemp.startedAt;
        newWorkouts.push(workoutTemp);
        workoutTemp.exercises.forEach((exerciseTemp) => {
          exerciseTemp._id = new mongoose.Types.ObjectId();
          // delete exerciseTemp.notes;
          if (withSets) {
            exerciseTemp.sets = normalizeSetsOrder(exerciseTemp.sets || []);
            exerciseTemp.sets.forEach((setTemp) => {
              setTemp._id = new mongoose.Types.ObjectId();
              normalizeSetForTemplateCopy(setTemp);
              newSets.push(setTemp);
            });
          } else exerciseTemp.sets = [];
          newCustomExercises.push(exerciseTemp);
        });
      });

      if (newSets.length > 0) await setSchema.insertMany(newSets);
      if (newCustomExercises.length > 0)
        await customExerciseSchema.insertMany(newCustomExercises);
      if (newWorkouts.length > 0) await workoutSchema.insertMany(newWorkouts);
      newSplit = await splitSchema.create(newSplit);

      const addSplitQuery = {
        $push: {
          splits: {
            $each: [newSplit._id],
            $position: splitIndex + 1,
          },
        },
      };
      await tableSchema.findByIdAndUpdate(idTable, addSplitQuery);

      return newSplit;
    } catch (err) {
      throw err;
    }
  },

  // async addSplitToTable(idTable) {
  //   try {
  //     const tableDoc = await tableSchema.findById(idTable);
  //     let firstSplit = tableDoc.splits[0];

  //     if (firstSplit) {
  //       // Clonar firstSplit para evitar modificar el objeto original
  //       firstSplit = firstSplit.toObject();
  //     } else {
  //       firstSplit = splitUtil.getStandardSplit(); // Asume que getStandardSplit devuelve un objeto válido
  //       firstSplit._id = new mongoose.Types.ObjectId();
  //     }

  //     const workoutsSplit = firstSplit.workouts.map((workoutTemp) => {
  //       // Clonar workoutTemp para evitar modificar el objeto original
  //       const workout = {
  //         ...workoutTemp,
  //         _id: new mongoose.Types.ObjectId(),
  //         exercises: workoutTemp.exercises.map((exerciseTemp) => {
  //           // Clonar exerciseTemp y eliminar las sets
  //           const exercise = { ...exerciseTemp };
  //           delete exercise.sets;
  //           return exercise;
  //         }),
  //       };
  //       return workout;
  //     });

  //     await workoutSchema.insertMany(workoutsSplit);

  //     firstSplit.workouts = workoutsSplit.map((workout) => workout._id);

  //     // Eliminar el _id antes de crear el nuevo split
  //     delete firstSplit._id;

  //     firstSplit = await splitSchema.create(firstSplit);

  //     const addSplit = {
  //       $push: { splits: firstSplit._id },
  //     };

  //     await tableSchema.findByIdAndUpdate(idTable, addSplit);

  //     return firstSplit;
  //   } catch (err) {
  //     console.error("Error en addSplitToTable:", err.message);
  //     throw err;
  //   }
  // },

  // Planificador visual (Fase C) — primer caller real de este método (antes
  // sin ningún wrapper en el frontend). findByIdAndUpdate sin { new: true }
  // devuelve el documento ANTERIOR a la actualización — bug preexistente que
  // habría devuelto el split sin el workout recién añadido; corregido aquí.
  async addWorkoutsSplit(idSplit, idWorkout) {
    const addWorkout = {
      $push: { workouts: idWorkout },
    };

    return new Promise((resolve, reject) =>
      splitSchema.findByIdAndUpdate(idSplit, addWorkout, { new: true }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async updateSplit(id, split) {
    const update = { $set: split };

    return new Promise((resolve, reject) =>
      splitSchema.updateOne({ _id: id }, update, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  // Función pura exportada para test (split-dao.test.js).
  isValidSplitPermutation,

  // Planificador visual (Fase C) — reordena las columnas (splits) de una
  // tabla. Nunca crea/borra splits, solo reescribe table.splits en el orden
  // pedido — igual de simple que reordenar cualquier otro array de
  // referencias en este backend, pero a nivel Table en vez de Split.
  async reorderSplits(idTable, splitIdsOrder) {
    const tableDoc = await tableSchema.findById(idTable).select("_id splits");
    if (!tableDoc) {
      const err = new Error("Table not found");
      err.code = "TABLE_NOT_FOUND";
      throw err;
    }

    // table.splits está autopoblado (mongoose-autopopulate) — cada elemento
    // es un Split completo, no un ObjectId suelto; hay que extraer el _id
    // explícitamente (mismo patrón ya usado en split-controller.js#deleteSplits).
    const currentIds = tableDoc.splits.map((s) => (s._id || s).toString());
    const requestedIds = (Array.isArray(splitIdsOrder) ? splitIdsOrder : []).map((id) =>
      (id?._id || id).toString(),
    );

    if (!isValidSplitPermutation(currentIds, requestedIds)) {
      const err = new Error("splitIdsOrder debe ser una permutación exacta de los splits actuales");
      err.code = "INVALID_SPLIT_ORDER";
      throw err;
    }

    await tableSchema.findByIdAndUpdate(idTable, { $set: { splits: requestedIds } });

    const updatedTable = await tableSchema.findById(idTable);
    return updatedTable.splits;
  },

  // Planificador visual (Fase C) — "Añadir semana" en blanco (a diferencia de
  // addSplitToTable, que SIEMPRE duplica un split existente). Reutiliza
  // splitUtil.getStandarSplit() como base (ya devuelve workouts: []) en vez
  // de reinventar el shape por defecto.
  async createBlankSplitAndAddToTable(idTable, name) {
    const tableDoc = await tableSchema.findById(idTable).select("_id splits");
    if (!tableDoc) {
      const err = new Error("Table not found");
      err.code = "TABLE_NOT_FOUND";
      throw err;
    }

    const blankSplit = splitUtil.getStandarSplit();
    if (name) blankSplit.name = name;

    const newSplit = await splitSchema.create(blankSplit);

    await tableSchema.findByIdAndUpdate(idTable, {
      $push: { splits: newSplit._id },
    });

    const updatedTable = await tableSchema.findById(idTable);
    return updatedTable.splits;
  },

  async deleteSplit(idTable, idSplit) {
    try {
      const pullSplit = { $pull: { splits: idSplit } };
      await tableSchema.findByIdAndUpdate(idTable, pullSplit);
      await splitSchema.deleteOne({ _id: idSplit });
    } catch (err) {
      throw err;
    }
  },

  async deleteSplits(idTable, splitIds, userId, workoutInUse) {
    try {
      const selectedSplits = await splitSchema
        .find({ _id: { $in: splitIds } })
        .select("_id workouts");

      const workoutInUseId = workoutInUse?.toString();
      const clearedWorkoutInUse = Boolean(
        workoutInUseId &&
          selectedSplits.some((split) =>
            (split.workouts || []).some(
              (workout) =>
                (workout?._id || workout)?.toString() === workoutInUseId,
            ),
          ),
      );

      await tableSchema.findByIdAndUpdate(idTable, {
        $pull: { splits: { $in: splitIds } },
      });
      await splitSchema.deleteMany({ _id: { $in: splitIds } });

      if (clearedWorkoutInUse && userId) {
        await userSchema.findByIdAndUpdate(userId, {
          $unset: { workoutInUse: 1 },
        });
      }

      return {
        deletedSplitIds: splitIds.map((id) => id.toString()),
        clearedWorkoutInUse,
      };
    } catch (err) {
      throw err;
    }
  },
};
