const mongoose = require("mongoose");
const setSchema = require("../sets/set-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const splitSchema = require("../splits/split-schema");
const ownTableSchema = require("../ownTables/own-table-schema");
const exerciseModel = require("../exercises/exercise-model");
const userSchema = require("../users/schema");

async function createExercisesIfNeeded(exercises, userId) {
  const createdMap = {};
  for (const ex of exercises) {
    if (ex.shouldCreate && ex.exerciseData) {
      const doc = await exerciseModel.createExercise({
        name: ex.exerciseData.name || ex.name,
        muscleGroups1: ex.exerciseData.muscleGroups1 || [],
        muscleGroups2: ex.exerciseData.muscleGroups2 || [],
        category: ex.exerciseData.category || [],
        equipment: ex.exerciseData.equipment || [],
        isCardio: ex.exerciseData.isCardio || false,
        userId: userId,
      });
      createdMap[ex.name] = doc._id.toString();
    }
  }
  return createdMap;
}

function resolveExerciseId(exercise, createdMap) {
  if (exercise.matchedExerciseId) {
    return exercise.matchedExerciseId;
  }
  return createdMap[exercise.name] || null;
}

async function createFullHierarchy(tableData, userId) {
  const allExercises = tableData.splits.flatMap((s) =>
    s.workouts.flatMap((w) => w.exercises)
  );

  const createdMap = await createExercisesIfNeeded(allExercises, userId);

  const createdTable = { name: tableData.name, type: "", splits: [] };

  for (const splitData of tableData.splits) {
    const createdWorkouts = [];

    for (const workoutData of splitData.workouts) {
      const createdCustomExercises = [];

      for (const exerciseData of workoutData.exercises) {
        const exerciseId = resolveExerciseId(exerciseData, createdMap);
        if (!exerciseId) continue;

        const setsToCreate = (exerciseData.sets || []).map(
          (setData, index) => ({
            expectedReps: setData.expectedReps || [],
            expectedRir: setData.expectedRir || [],
            weight: setData.weight || undefined,
            drop: setData.drop || undefined,
            restPause: setData.restPause || undefined,
            expectedMin: setData.expectedMin || undefined,
            expectedSec: setData.expectedSec || undefined,
            order: index,
          })
        );

        let createdSets = [];
        if (setsToCreate.length > 0) {
          createdSets = await setSchema.insertMany(setsToCreate);
        }

        const customExerciseDoc = await customExerciseSchema.create({
          exercise: new mongoose.Types.ObjectId(exerciseId),
          sets: createdSets.map((s) => s._id),
          notes: exerciseData.notes || undefined,
          order: createdCustomExercises.length,
        });

        createdCustomExercises.push(customExerciseDoc);
      }

      const workoutDoc = await workoutSchema.create({
        name: workoutData.name || "Entrenamiento",
        exercises: createdCustomExercises.map((ce) => ce._id),
      });

      createdWorkouts.push(workoutDoc);
    }

    const splitDoc = await splitSchema.create({
      name: splitData.name || "Split",
      workouts: createdWorkouts.map((w) => w._id),
    });

    createdTable.splits.push(splitDoc);
  }

  const tableDoc = await ownTableSchema.create({
    name: createdTable.name,
    type: "",
    splits: createdTable.splits.map((s) => s._id),
  });

  const addTableToUser = {
    $set: { tableInUse: tableDoc._id },
    $push: { ownTables: tableDoc._id },
  };
  await userSchema.findByIdAndUpdate(userId, addTableToUser);

  const populatedTable = await ownTableSchema.findById(tableDoc._id);

  return populatedTable;
}

module.exports = {
  createExercisesIfNeeded,
  resolveExerciseId,
  createFullHierarchy,
};
