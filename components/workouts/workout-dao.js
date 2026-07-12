const tableSchema = require("../tables/table-schema");
const splitSchema = require("../splits/split-schema");
const workoutSchema = require("./workout-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const setSchema = require("../sets/set-schema");
const Workout = require("./workout-class");
const { default: mongoose } = require("mongoose");
const customExerciseDao = require("../customExercises/custom-exercise-dao");
const userSchema = require("../users/schema");

function normalizeSetForTemplateCopy(setTemp) {
  delete setTemp.doned;
}

function cloneSetForTemplateCopy(setTemp) {
  const clonedSet =
    typeof setTemp.toObject === "function" ? setTemp.toObject() : { ...setTemp };
  clonedSet._id = new mongoose.Types.ObjectId();
  normalizeSetForTemplateCopy(clonedSet);
  return clonedSet;
}

function cloneCustomExerciseForTemplateCopy(exerciseTemp, setsToCreate) {
  const clonedExercise =
    typeof exerciseTemp.toObject === "function"
      ? exerciseTemp.toObject()
      : { ...exerciseTemp };

  clonedExercise._id = new mongoose.Types.ObjectId();
  clonedExercise.sets = (exerciseTemp.sets || []).map((setTemp) => {
    const clonedSet = cloneSetForTemplateCopy(setTemp);
    setsToCreate.push(clonedSet);
    return clonedSet._id;
  });

  return clonedExercise;
}

function cloneWorkoutForTemplateCopy(workoutTemp, options = {}) {
  const setsToCreate = [];
  const customExercisesToCreate = [];
  const clonedWorkout =
    typeof workoutTemp.toObject === "function"
      ? workoutTemp.toObject()
      : { ...workoutTemp };

  clonedWorkout._id = new mongoose.Types.ObjectId();
  delete clonedWorkout.date;
  delete clonedWorkout.paused;
  delete clonedWorkout.cronometer;

  if (options.nameSuffix) {
    clonedWorkout.name = `${clonedWorkout.name || ""} ${options.nameSuffix}`.trim();
  }

  clonedWorkout.exercises = (workoutTemp.exercises || []).map((exerciseTemp) => {
    const clonedExercise = cloneCustomExerciseForTemplateCopy(
      exerciseTemp,
      setsToCreate,
    );
    customExercisesToCreate.push(clonedExercise);
    return clonedExercise._id;
  });

  return {
    workout: clonedWorkout,
    customExercises: customExercisesToCreate,
    sets: setsToCreate,
  };
}

module.exports = {
  async getWorkouts(page, limit) {
    return new Promise((resolve, reject) =>
      workoutSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async getWorkoutById(id) {
    return await workoutSchema.findById(id);
  },

  // TODO: De momento se hace en el front por el tema fechas que pille las del cliente
  // TODO: debería hacerse en lado en queries
  async getWorkoutByIdAndDate(id, date) {
    try {
      const d = new Date(date);

      const minDate = new Date(d).setHours(0, 0, 0, 0);
      const maxDate = new Date(d).setHours(23, 59, 59, 999);

      const workout = await tableSchema.aggregate([
        // Etapa de filtro para obtener la tabla por su ID
        { $match: { _id: new mongoose.Types.ObjectId(id) } },

        // Etapa de expansión para obtener los workouts de la tabla
        {
          $lookup: {
            from: "splits",
            localField: "splits",
            foreignField: "_id",
            as: "splits",
          },
        },
        { $unwind: "$splits" },
        {
          $lookup: {
            from: "workouts",
            localField: "splits.workouts",
            foreignField: "_id",
            as: "workouts",
          },
        },
        { $unwind: "$workouts" },

        // Etapa de filtro para obtener solo los workouts con la fecha deseada
        {
          $match: {
            "workouts.date": {
              $gte: new Date(minDate),
              $lte: new Date(maxDate),
            },
          },
        },

        // Etapa de expansión para obtener los ejercicios de los workouts
        {
          $lookup: {
            from: "customexercises",
            localField: "workouts.exercises",
            foreignField: "_id",
            as: "exercises",
          },
        },
        { $unwind: "$exercises" },
        {
          $lookup: {
            from: "exercises",
            localField: "exercises.exercise",
            foreignField: "_id",
            as: "exercise",
          },
        },
        { $unwind: "$exercise" },

        // Etapa de expansión para obtener los sets de los ejercicios
        {
          $lookup: {
            from: "sets",
            localField: "exercises.sets",
            foreignField: "_id",
            as: "sets",
          },
        },

        // Agrupar por el ID del workout
        {
          $group: {
            _id: "$workouts._id",
            name: { $first: "$workouts.name" },
            date: { $first: "$workouts.date" },
            order: { $first: "$workouts.order" },
            cronometer: { $first: "$workouts.cronometer" },
            exercises: {
              $push: {
                _id: "$exercises._id",
                order: "$exercises.order",
                exercise: "$exercise",
                sets: "$sets",
              },
            },
          },
        },

        // Proyección para obtener solo los datos necesarios
        {
          $project: {
            _id: 1,
            name: 1,
            date: 1,
            order: 1,
            cronometer: 1,
            exercises: 1,
          },
        },
      ]);

      return workout[0];
    } catch (err) {
      throw err;
    }
  },

  async pasteWorkout(workoutClipboard, workoutToPaste) {
    try {
      const workoutIdsCustomExercises = workoutToPaste.exercises.map(
        (exerciseTemp) => exerciseTemp._id,
      );
      const workoutSetsIdsExercises = workoutToPaste.exercises.flatMap(
        (exerciseTemp) => exerciseTemp.sets.map((setTemp) => setTemp._id),
      );

      await setSchema.deleteMany({ _id: { $in: workoutSetsIdsExercises } });
      await customExerciseSchema.deleteMany({
        _id: { $in: workoutIdsCustomExercises },
      });

      const exercisesToCreate = [];
      const setsToCreate = [];

      workoutClipboard.exercises.forEach((exerciseTemp) => {
        const clonedExercise = cloneCustomExerciseForTemplateCopy(
          exerciseTemp,
          setsToCreate,
        );
        exercisesToCreate.push(clonedExercise);
      });

      workoutToPaste.exercises = exercisesToCreate.map(
        (exerciseTemp) => exerciseTemp._id,
      );
      // Copiar las notas del workout copiado
      workoutToPaste.notes = workoutClipboard.notes;

      await Promise.all([
        setSchema.insertMany(setsToCreate),
        customExerciseSchema.insertMany(exercisesToCreate),
      ]);

      const updatedWorkout = await workoutSchema.findByIdAndUpdate(
        workoutToPaste._id,
        workoutToPaste,
        { new: true },
      );

      return updatedWorkout;
    } catch (error) {
      throw error;
    }
  },

  async duplicateWorkoutRow(idTable, idWorkout, nameSuffix = "Copy") {
    try {
      const tableDoc = await tableSchema.findById(idTable);
      if (!tableDoc) throw new Error("Table not found");

      let workoutIndex = -1;
      tableDoc.splits.some((splitTemp) => {
        const foundIndex = splitTemp.workouts.findIndex(
          (workoutTemp) => workoutTemp._id.toString() === idWorkout,
        );

        if (foundIndex >= 0) {
          workoutIndex = foundIndex;
          return true;
        }

        return false;
      });

      if (workoutIndex < 0) throw new Error("Workout not found in table");

      const workoutsToCreate = [];
      const customExercisesToCreate = [];
      const setsToCreate = [];
      const splitUpdates = [];

      tableDoc.splits.forEach((splitTemp) => {
        const workoutToCopy = splitTemp.workouts[workoutIndex];
        if (!workoutToCopy) {
          throw new Error("Workout row is not complete in all splits");
        }

        const cloned = cloneWorkoutForTemplateCopy(workoutToCopy, {
          nameSuffix,
        });

        workoutsToCreate.push(cloned.workout);
        customExercisesToCreate.push(...cloned.customExercises);
        setsToCreate.push(...cloned.sets);
        splitUpdates.push({
          updateOne: {
            filter: { _id: splitTemp._id },
            update: {
              $push: {
                workouts: {
                  $each: [cloned.workout._id],
                  $position: workoutIndex + 1,
                },
              },
            },
          },
        });
      });

      if (setsToCreate.length > 0) await setSchema.insertMany(setsToCreate);
      if (customExercisesToCreate.length > 0) {
        await customExerciseSchema.insertMany(customExercisesToCreate);
      }
      if (workoutsToCreate.length > 0) {
        await workoutSchema.insertMany(workoutsToCreate);
      }
      if (splitUpdates.length > 0) await splitSchema.bulkWrite(splitUpdates);

      const updatedTable = await tableSchema.findById(idTable);
      return updatedTable.splits;
    } catch (error) {
      throw error;
    }
  },

  async reorderWorkoutRows(idTable, workoutIdsOrder) {
    try {
      const tableDoc = await tableSchema.findById(idTable);
      if (!tableDoc) throw new Error("Table not found");

      if (
        !Array.isArray(workoutIdsOrder) ||
        workoutIdsOrder.length !== tableDoc.splits[0]?.workouts?.length
      ) {
        throw new Error("Invalid workout order");
      }

      const referenceSplit = tableDoc.splits.find((splitTemp) =>
        workoutIdsOrder.every((idWorkout) =>
          splitTemp.workouts.some(
            (workoutTemp) => workoutTemp._id.toString() === idWorkout,
          ),
        ),
      );

      if (!referenceSplit) throw new Error("Workout order does not match table");

      const referenceIndexes = workoutIdsOrder.map((idWorkout) =>
        referenceSplit.workouts.findIndex(
          (workoutTemp) => workoutTemp._id.toString() === idWorkout,
        ),
      );

      if (referenceIndexes.some((index) => index < 0)) {
        throw new Error("Workout order does not match table");
      }

      const splitUpdates = tableDoc.splits.map((splitTemp) => ({
        updateOne: {
          filter: { _id: splitTemp._id },
          update: {
            $set: {
              workouts: referenceIndexes.map(
                (workoutIndex) => splitTemp.workouts[workoutIndex]._id,
              ),
            },
          },
        },
      }));

      await splitSchema.bulkWrite(splitUpdates);

      const updatedTable = await tableSchema.findById(idTable);
      return updatedTable.splits;
    } catch (error) {
      throw error;
    }
  },

  async createWorkout(workout) {
    let exercises = workout.exercises;

    workout.exercises = [];

    return new Promise((resolve, reject) =>
      workoutSchema.create(workout, (err, doc) => {
        if (err) return reject(err);

        exerciseSchema.insertMany(exercises, (err2, doc2) => {
          if (err2) return reject(err2);

          let ids = doc2.map((exerciseTemp) => exerciseTemp._id);

          workoutSchema.findByIdAndUpdate(
            doc._id,
            { $set: { exercises: ids } },
            { new: true },
            (err3, doc3) => {
              if (err3) return reject(err3);

              return resolve(doc3);
            },
          );
        });
      }),
    );
  },

  async addWorkoutsToSplits(idTable, workout) {
    const promises = [];
    const workoutsToAdd = [];
    const tableDoc = await tableSchema.findById(idTable);

    for (let i = 0; i < tableDoc.splits.length; i++) {
      const newWorkout = new Workout(workout);
      newWorkout._id = new mongoose.Types.ObjectId();

      tableDoc.splits[i].workouts.push(newWorkout);

      const promise = splitSchema.updateOne(
        { _id: tableDoc.splits[i]._id },
        { $push: { workouts: newWorkout._id } },
      );

      workoutsToAdd.push(newWorkout);
      promises.push(promise);
    }

    await workoutSchema.insertMany(workoutsToAdd);
    await Promise.all(promises);

    return tableDoc.splits;
  },

  async addExerciseToWorkouts(workoutIds, exerciseId) {
    try {
      if (!Array.isArray(workoutIds) || workoutIds.length === 0) {
        return [];
      }

      const customExercisesData = workoutIds.map(() => ({
        exercise: exerciseId,
        sets: [],
        notes: null,
      }));

      const insertedCustomExercises = await customExerciseSchema.insertMany(customExercisesData);

      const bulkOperations = workoutIds.map((wId, i) => ({
        updateOne: {
          filter: { _id: wId },
          update: { $push: { exercises: insertedCustomExercises[i]._id } }
        }
      }));

      await workoutSchema.bulkWrite(bulkOperations);

      await customExerciseSchema.populate(insertedCustomExercises, { path: "exercise" });

      const result = workoutIds.map((wId, i) => ({
        workoutId: wId,
        customExercise: insertedCustomExercises[i]
      }));

      return result;
    } catch (err) {
      throw err;
    }
  },

  async addWorkoutExercise(idWorkout, idExercise) {
    const addExercise = {
      $push: { exercises: idExercise },
    };

    return new Promise((resolve, reject) =>
      workoutSchema.findByIdAndUpdate(
        idWorkout,
        addExercise,
        {},
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async addWorkoutsExercises(idTable, idExercise, workoutOrder) {
    return new Promise((resolve, reject) =>
      tableSchema.findById(idTable, {}, (err, tableDoc) => {
        if (err) return reject(err);

        // tableDoc.splits.forEach((splitTemp) => {
        //   let workouts = [];
        //   splitTemp.workouts.forEach((workoutTemp) => {
        //     if (workoutTemp.order === Number(workoutOrder)) {
        //       workouts.push(workoutTemp);
        //     }
        //   });

        //   workouts.forEach((workoutTemp) => {
        //     const addExercises = { $push: { exercises: idExercise } };
        //     workoutSchema.findOneAndUpdate(
        //       { _id: workoutTemp._id },
        //       addExercises,
        //       {},
        //       (err, docs) => {
        //         if (err) return reject(err);
        //       }
        //     );
        //   });
        // });

        // tableSchema.findById(idTable, {}, (err, tableDoc) => {
        //   if (err) return reject(err);
        //   return resolve(tableDoc);
        // });
      }),
    );
  },

  async deleteWorkoutExercise(idWorkout, idExercise) {
    const deleteWorkout = {
      $pull: { workout: idExercise },
    };

    return new Promise((resolve, reject) =>
      workoutSchema.findByIdAndUpdate(
        idWorkout,
        deleteWorkout,
        {},
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async modifyWorkout(workout) {
    return new Promise((resolve, reject) => {
      const update = { $set: {} };
      const unset = {};

      // Set all provided fields
      for (const key in workout) {
        if (key !== "_id") {
          // Parse date if it comes as ISO string
          if (key === "date" && typeof workout[key] === "string") {
            update.$set[key] = new Date(workout[key]);
          } else {
            update.$set[key] = workout[key];
          }
        }
      }

      const hasDate = Object.prototype.hasOwnProperty.call(workout, "date");
      const hasPaused = Object.prototype.hasOwnProperty.call(workout, "paused");
      const hasNotes = Object.prototype.hasOwnProperty.call(workout, "notes");

      // Only unset date when it is explicitly sent as null
      if (hasDate && workout.date === null) {
        delete update.$set.date;
        unset.date = 1;
      }

      // Only unset paused when it is explicitly sent as null/undefined/false
      if (
        hasPaused &&
        (workout.paused === null ||
          workout.paused === undefined ||
          workout.paused === false)
      ) {
        delete update.$set.paused;
        unset.paused = 1;
      }

      // Only unset notes when it is explicitly sent as null/undefined/empty
      if (
        hasNotes &&
        (workout.notes === null ||
          workout.notes === undefined ||
          workout.notes?.trim() === "")
      ) {
        delete update.$set.notes;
        unset.notes = 1;
      }

      if (Object.keys(unset).length > 0) {
        update.$unset = unset;
      }

      workoutSchema.findByIdAndUpdate(
        workout._id,
        update,
        { new: true },
        (err2, workoutDoc) => {
          if (err2) return reject(err2);
          return resolve(workoutDoc);
        },
      );
    });
  },

  async finishWorkout(workoutId, userId, date) {
    const finishDate = date ? new Date(date) : new Date();

    const [workoutDoc, userDoc] = await Promise.all([
      workoutSchema.findByIdAndUpdate(
        workoutId,
        { $set: { date: finishDate }, $unset: { paused: 1 } },
        { new: true },
      ),
      userSchema.findByIdAndUpdate(
        userId,
        { $unset: { workoutInUse: 1 } },
        { new: true },
      ),
    ]);

    return {
      workout: workoutDoc,
      userUpdated: !!userDoc,
    };
  },

  async updateWorkout(workout, customExercise) {
    return new Promise((resolve, reject) =>
      customExerciseSchema.create(customExercise, (err, customExerciseDoc) => {
        if (err) return reject(err);

        workout.exercises.push(customExerciseDoc);

        const update = { $set: workout };

        workoutSchema.findByIdAndUpdate(
          workout._id,
          update,
          { new: true },
          (err2, workoutDoc) => {
            if (err2) return reject(err2);
            return resolve(workoutDoc);
          },
        );
      }),
    );
  },

  async updateWorkoutsOrder(idWorkout, idTable, newOrder) {
    try {
      const tableDoc = await tableSchema.findById(idTable);

      let indexWorkout;

      // Obtener índice de Workout
      tableDoc.splits.forEach((sTemp) => {
        sTemp.workouts.forEach((wTemp, iW) => {
          if (wTemp._id.toString() === idWorkout) {
            indexWorkout = iW;
          }
        });
      });

      let bulkOperations = [];

      tableDoc.splits.forEach((sTemp) => {
        sTemp.workouts.forEach((wTemp, iW) => {
          if (iW === indexWorkout) {
            // Copiar el array de ejercicios y reorganizar según `newOrder`
            const newOrderedExercises = newOrder.map(
              (index) => wTemp.exercises[index],
            );

            // Agregar operación a bulkWrite solo para actualizar el array `exercises`
            bulkOperations.push({
              updateOne: {
                filter: { _id: wTemp._id },
                update: { $set: { exercises: newOrderedExercises } },
              },
            });
          }
        });
      });
      return await workoutSchema.bulkWrite(bulkOperations);
    } catch (error) {
      throw error;
    }
  },

  async updateCustomExercises(
    idTable,
    idWorkout,
    idCustomExercise,
    idExercise,
  ) {
    const tableDoc = await tableSchema.findById(idTable);
    const exerciseDoc = await exerciseSchema.findById(idExercise);

    let indexWorkout;
    tableDoc.splits.forEach((sTemp) => {
      sTemp.workouts.forEach((wTemp, iW) => {
        if (idWorkout === wTemp._id.toString()) {
          indexWorkout = iW;
        }
      });
    });

    let customExercisesToUpdate = [];

    let indexCustomExercise;
    tableDoc.splits.forEach((sTemp) => {
      sTemp.workouts.forEach((wTemp) => {
        wTemp.exercises.forEach((ceTemp, iCE) => {
          if (ceTemp._id.toString() === idCustomExercise)
            indexCustomExercise = iCE;
        });
      });
    });

    tableDoc.splits.forEach((sTemp) => {
      sTemp.workouts.forEach((wTemp, iW) => {
        if (indexWorkout === iW) {
          const customExercise =
            sTemp.workouts[indexWorkout].exercises[indexCustomExercise];
          customExercise.exercise = exerciseDoc;
          customExercisesToUpdate.push(customExercise);
        }
      });
    });

    const updateOperations = customExercisesToUpdate.map((ceTemp) => ({
      updateOne: {
        filter: { _id: ceTemp._id },
        update: { $set: { exercise: ceTemp.exercise } },
      },
    }));
    await customExerciseSchema.bulkWrite(updateOperations);

    return await tableSchema.findById(idTable);
  },

  async updateWorkoutsName(idTable, idWorkout, workoutsName) {
    try {
      const tableDoc = await tableSchema.findById(idTable);

      let indexS;
      tableDoc.splits.forEach((splitTemp, indexSplit) => {
        splitTemp.workouts.forEach((workoutTemp) => {
          if (workoutTemp._id.toString() === idWorkout) indexS = indexSplit;
        });
      });

      const indexWorkout = tableDoc.splits[indexS].workouts.findIndex(
        (workoutTemp) => workoutTemp._id.toString() === idWorkout,
      );

      const workoutIdsToUpdate = tableDoc.splits.map((splitTemp) =>
        splitTemp.workouts[indexWorkout]._id.toString(),
      );

      await workoutSchema.updateMany(
        { _id: { $in: workoutIdsToUpdate } },
        { $set: { name: workoutsName } },
      );

      return;
    } catch (err) {
      throw err;
    }
  },

  async deleteWorkoutCustomExercises(id) {
    return new Promise((resolve, reject) =>
      workoutSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const customExerciseIds = doc.exercises.map(
          (exerciseTemp) => exerciseTemp._id,
        );
        customExerciseSchema.deleteMany(
          { _id: { $in: customExerciseIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            return resolve(doc2);
          },
        );
      }),
    );
  },

  async addDataExerciseToWorkout(workoutId, dataExerciseData) {
    try {
      // 1. Crear el Exercise si viene como objeto (sin _id)
      let exerciseId;
      if (dataExerciseData.exercise && !dataExerciseData.exercise._id) {
        const exerciseDoc = await exerciseSchema.create(
          dataExerciseData.exercise,
        );
        exerciseId = exerciseDoc._id;
      } else {
        // Si ya tiene _id, usar ese
        exerciseId = dataExerciseData.exercise._id || dataExerciseData.exercise;
      }

      // 2. Procesar los Sets
      let setIds = [];
      if (dataExerciseData.sets && dataExerciseData.sets.length > 0) {
        // Si vienen como objetos (con propiedades), hacer insertMany
        if (
          typeof dataExerciseData.sets[0] === "object" &&
          dataExerciseData.sets[0]._id === undefined
        ) {
          const setsDoc = await setSchema.insertMany(dataExerciseData.sets);
          setIds = setsDoc.map((s) => s._id);
        } else {
          // Si vienen como IDs (strings), usarlos directamente
          setIds = dataExerciseData.sets;
        }
      }

      // 3. Crear el CustomExercise (DataExercise) con la referencia al exercise
      const customExerciseData = {
        exercise: exerciseId,
        sets: setIds,
        notes: dataExerciseData.notes || null,
      };

      const customExerciseDoc =
        await customExerciseSchema.create(customExerciseData);

      // 4. Agregar el CustomExercise al Workout y devolver el workout autopoblado
      await workoutSchema.findByIdAndUpdate(
        workoutId,
        { $push: { exercises: customExerciseDoc._id } },
        { new: true },
      );

      // Leer nuevamente para aplicar autopopulate
      const updatedWorkout = await workoutSchema.findById(workoutId);
      return updatedWorkout;
    } catch (error) {
      throw error;
    }
  },

  async deleteWorkout(id) {
    return new Promise((resolve, reject) =>
      workoutSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async deleteWorkouts(workouts) {
    const workoutIds = workouts.map((workoutTemp) => workoutTemp._id);

    const deleteWorkouts = { _id: workoutIds };
    return new Promise((resolve, reject) =>
      workoutSchema.deleteMany(deleteWorkouts, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },
};
