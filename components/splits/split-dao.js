const splitSchema = require("./split-schema");
const splitService = require("./split-service");
const splitUtil = require("./split-util");
const ownTableSchema = require("../ownTables/own-table-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const workoutService = require("../workouts/workout-service");

const { default: mongoose } = require("mongoose");
const setSchema = require("../sets/set-schema");
const tableSchema = require("../tables/table-schema");

function normalizeSetForTemplateCopy(setTemp) {
  // Solo borramos el estado de completado para que el nuevo microciclo
  // empiece de cero, pero mantenemos los valores de rendimiento (peso, reps, rir, etc.)
  // como punto de partida para el usuario.
  delete setTemp.doned;

  setTemp.expectedRir = Array.isArray(setTemp.expectedRir)
    ? [...setTemp.expectedRir]
    : setTemp.expectedRir != null
      ? [setTemp.expectedRir]
      : [];

  setTemp.expectedReps = Array.isArray(setTemp.expectedReps)
    ? [...setTemp.expectedReps]
    : setTemp.expectedReps != null
      ? [setTemp.expectedReps]
      : [];
}

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
        ownTableSchema.findByIdAndUpdate(
          idTable,
          addSplit,
          {},
          (err2, tableDoc) => {
            if (err2) return reject(err2);
            workoutSchema.insertMany(currentSplit.workouts, (err3, doc) => {
              if (err3) return reject(err3);
              customExerciseSchema.insertMany(exercisesFinal, (err4, doc2) => {
                if (err4) return reject(err4);
                ownTableSchema.findById(tableDoc._id, (err5, doc) => {
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
      let tableDoc = await ownTableSchema.findById(idTable);
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
        newWorkouts.push(workoutTemp);
        workoutTemp.exercises.forEach((exerciseTemp) => {
          exerciseTemp._id = new mongoose.Types.ObjectId();
          // delete exerciseTemp.notes;
          if (withSets)
            exerciseTemp.sets.forEach((setTemp) => {
              setTemp._id = new mongoose.Types.ObjectId();
              normalizeSetForTemplateCopy(setTemp);
              newSets.push(setTemp);
            });
          else exerciseTemp.sets = [];
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
      await ownTableSchema.findByIdAndUpdate(idTable, addSplitQuery);

      return newSplit;
    } catch (err) {
      throw err;
    }
  },

  // async addSplitToTable(idTable) {
  //   try {
  //     const tableDoc = await ownTableSchema.findById(idTable);
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

  //     await ownTableSchema.findByIdAndUpdate(idTable, addSplit);

  //     return firstSplit;
  //   } catch (err) {
  //     console.error("Error en addSplitToTable:", err.message);
  //     throw err;
  //   }
  // },

  async addWorkoutsSplit(idSplit, idWorkout) {
    const addWorkout = {
      $push: { workouts: idWorkout },
    };

    return new Promise((resolve, reject) =>
      splitSchema.findByIdAndUpdate(idSplit, addWorkout, {}, (err, docs) => {
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

  async deleteSplit(idTable, idSplit) {
    try {
      const pullSplit = { $pull: { splits: idSplit } };
      await ownTableSchema.findByIdAndUpdate(idTable, pullSplit);
      await splitSchema.deleteOne({ _id: idSplit });
    } catch (err) {
      throw err;
    }
  },
};
