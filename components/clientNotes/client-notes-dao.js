const Table = require("../tables/table-schema");
const Split = require("../splits/split-schema");
const Workout = require("../workouts/workout-schema");
const CustomExercise = require("../customExercises/custom-exercise-schema");
const Exercise = require("../exercises/exercise-schema");
const PinnedExerciseNote = require("../pinnedExerciseNotes/pinned-exercise-note-schema");
const { PainEntry } = require("../painLog/pain-schema");
const DietDay = require("../dietDays/diet-days-schema");
const Meal = require("../meals/meal-schema");
const TrainerNoteRead = require("./trainer-note-read-schema");

const NON_EMPTY = { $exists: true, $nin: [null, ""] };

// Todo en .lean(): así no salta mongoose-autopopulate, que con Table
// arrastraría splits → workouts → ejercicios → series enteros. Aquí basta con
// los ids y los campos de texto. Workout y Meal filtran por trainerId: null en
// sus pre(/^find/) salvo que la consulta lleve _id, y todas las de abajo lo llevan.
module.exports = {
  async loadTrainingSources(clientId) {
    const tables = await Table.find({ userId: clientId }).select("name splits").lean();
    const splitIds = tables.flatMap((table) => table.splits || []);
    const splits = splitIds.length ? await Split.find({ _id: { $in: splitIds } }).select("workouts").lean() : [];
    const workoutIds = splits.flatMap((split) => split.workouts || []);
    const workouts = workoutIds.length
      ? await Workout.find({ _id: { $in: workoutIds } }).select("name notes date createdAt exercises").lean()
      : [];
    const customExerciseIds = workouts.flatMap((workout) => workout.exercises || []);
    const [customExercises, pinnedNotes] = await Promise.all([
      customExerciseIds.length
        ? CustomExercise.find({ _id: { $in: customExerciseIds } }).select("exercise clientNotes").lean()
        : [],
      tables.length ? PinnedExerciseNote.find({ tableId: { $in: tables.map((table) => table._id) } }).lean() : [],
    ]);
    const exerciseIds = [...new Set(customExercises.map((customExercise) => String(customExercise.exercise)).filter(Boolean))];
    const exercises = exerciseIds.length ? await Exercise.find({ _id: { $in: exerciseIds } }).select("name").lean() : [];
    return { tables, splits, workouts, customExercises, exercises, pinnedNotes };
  },

  async loadPainEntries(clientId) {
    return PainEntry.find({ userId: clientId, note: NON_EMPTY }).select("date zone level note").lean();
  },

  async loadNutritionSources(clientId) {
    const dietDays = await DietDay.find({ userId: clientId }).select("date notes menuName meals").lean();
    const mealIds = dietDays.flatMap((day) => day.meals || []);
    const meals = mealIds.length
      ? await Meal.find({ _id: { $in: mealIds }, notes: NON_EMPTY }).select("name notes").lean()
      : [];
    return { dietDays, meals };
  },

  async listReads(trainerId, clientId) {
    return TrainerNoteRead.find({ trainerId, clientId }).select("noteKey textHash").lean();
  },

  async markSeen(trainerId, clientId, notes) {
    if (!notes.length) return;
    await TrainerNoteRead.bulkWrite(
      notes.map((note) => ({
        updateOne: {
          filter: { trainerId, clientId, noteKey: note.key },
          update: { $set: { textHash: note.hash, readAt: new Date() } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  },

  async markUnseen(trainerId, clientId, keys) {
    if (!keys.length) return;
    await TrainerNoteRead.deleteMany({ trainerId, clientId, noteKey: { $in: keys } });
  },
};
