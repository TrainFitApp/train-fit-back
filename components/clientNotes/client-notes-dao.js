const Table = require("../tables/table-schema");
const Workout = require("../workouts/workout-schema");
const Exercise = require("../exercises/exercise-schema");
const { PainEntry } = require("../painLog/pain-schema");
const DietDay = require("../dietDays/diet-days-schema");
const TrainerNoteRead = require("./trainer-note-read-schema");

const NON_EMPTY = { $exists: true, $nin: [null, ""] };

// Todo en .lean(): así no salta mongoose-autopopulate, que poblaría sesiones,
// productos y recetas enteros. Aquí basta con los ids y los campos de texto.
module.exports = {
  // Devuelve las fuentes en forma NORMALIZADA (cada nivel en su lista, con
  // los hijos como ids), que es lo que espera client-notes-builder.js. En
  // base de datos los microciclos y las notas ancladas van dentro de la
  // tabla, y los ejercicios dentro de su sesión (2026-10).
  async loadTrainingSources(clientId) {
    const fullTables = await Table.find({ userId: clientId }).select("name splits pinnedNotes").lean();
    const tables = fullTables.map((table) => ({
      _id: table._id,
      name: table.name,
      splits: (table.splits || []).map((split) => split._id),
    }));
    const splits = fullTables.flatMap((table) =>
      (table.splits || []).map((split) => ({ _id: split._id, workouts: split.workouts || [] })),
    );
    const pinnedNotes = fullTables.flatMap((table) =>
      (table.pinnedNotes || []).map((note) => ({ ...note, tableId: table._id })),
    );
    const workoutIds = splits.flatMap((split) => split.workouts);
    const fullWorkouts = workoutIds.length
      ? await Workout.find({ _id: { $in: workoutIds } })
          .select("name clientNotes date createdAt exercises._id exercises.exercise exercises.clientNotes")
          .lean()
      : [];
    const workouts = fullWorkouts.map((workout) => ({
      ...workout,
      exercises: (workout.exercises || []).map((customExercise) => customExercise._id),
    }));
    const customExercises = fullWorkouts.flatMap((workout) => workout.exercises || []);
    const exerciseIds = [...new Set(customExercises.map((customExercise) => customExercise.exercise).filter(Boolean).map(String))];
    const exercises = exerciseIds.length ? await Exercise.find({ _id: { $in: exerciseIds } }).select("name").lean() : [];
    return { tables, splits, workouts, customExercises, exercises, pinnedNotes };
  },

  async loadPainEntries(clientId) {
    return PainEntry.find({ userId: clientId, note: NON_EMPTY }).select("date zone level note").lean();
  },

  // Misma forma normalizada que antes (días con ids de comida y comidas con
  // nota aparte); las comidas van embebidas en su día (2026-10).
  async loadNutritionSources(clientId) {
    const fullDays = await DietDay.find({ userId: clientId })
      .select("date notes menuName meals._id meals.name meals.notes")
      .lean();
    const dietDays = fullDays.map((day) => ({ ...day, meals: (day.meals || []).map((meal) => meal._id) }));
    const meals = fullDays.flatMap((day) =>
      (day.meals || []).filter((meal) => meal.notes != null && meal.notes !== ""),
    );
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
