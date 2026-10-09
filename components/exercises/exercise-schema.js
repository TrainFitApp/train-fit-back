const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { MUSCLE_IDS, ROLE_IDS, normalizeMuscles } = require("./muscle-catalog");

// Músculo implicado y cuánto cuenta (ver muscle-catalog.js). Sin _id: es un
// valor del ejercicio, no una entidad con vida propia.
const ExerciseMuscleSchema = new Schema(
  {
    muscle: { type: String, enum: MUSCLE_IDS, required: true },
    role: { type: String, enum: ROLE_IDS, required: true },
  },
  { _id: false },
);

const ExerciseSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  videoUrl: String,
  // GIF de demostración del catálogo (lo pinta el front en el buscador y en
  // el entrenamiento).
  gifUrl: String,
  description: { type: String, trim: true, maxlength: 6500 },
  // Músculos que trabaja, cada uno con su papel. [] = ninguno (cardio).
  muscles: { type: [ExerciseMuscleSchema], default: [] },
  category: [String],
  equipment: [String],
  keywords: [String],
  isCardio: Boolean,
  isIsometric: Boolean,
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  // Borrado de un ejercicio que alguna sesión usa (2026-10): no se borra,
  // se retira. Deja de salir en búsquedas y listados, pero las sesiones que
  // lo tienen (también las de otros: el entrenador que lo creó y lo pautó a
  // sus clientes) lo siguen pintando con su nombre y su ficha. Antes el
  // borrado arrastraba esos ejercicios y sus series del historial de todos.
  deletedAt: { type: Date, default: undefined },
});

// Cubre create, save e insertMany: `muscles` siempre en forma canónica (un
// papel por músculo, en orden). updateOne no pasa por aquí: lo hace
// exercise-dao.js#updateExercise con la misma función.
ExerciseSchema.pre("validate", function (next) {
  if (this.isNew || this.isModified("muscles")) {
    this.muscles = normalizeMuscles(this.muscles);
  }
  next();
});

// Un ejercicio borrado sale de los favoritos de quien lo tuviera. Las
// sesiones que lo usan no se tocan: solo se borra de verdad un ejercicio que
// nadie usa (ver exercise-dao.js#deleteExercise).
async function pullFromFavorites(exerciseIds) {
  await require("../favorites/favorites-dao").removeEverywhere("exercises", exerciseIds);
}

ExerciseSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    const exercise = await this.model.findOne(this.getQuery()).select("_id").lean();
    if (exercise) await pullFromFavorites([exercise._id]);
    next();
  } catch (error) {
    next(error);
  }
});

ExerciseSchema.pre("deleteMany", async function (next) {
  try {
    const exercises = await this.model.find(this.getFilter()).select("_id").lean();
    await pullFromFavorites(exercises.map((exercise) => exercise._id));
    next();
  } catch (error) {
    next(error);
  }
});

// Borrado de cuenta: después de sus rutinas y plantillas, para que solo
// cuente el uso que hacen otros (exercise-dao.js#releaseOwnExercises).
const { accountCascade, STAGE } = require("../util/account-cascade");
ExerciseSchema.plugin(accountCascade, {
  owners: ["userId"],
  keep: (userId) => require("./exercise-dao").releaseOwnExercises(userId),
  stage: STAGE.catalog,
});

const ExerciseModel = mongoose.model("Exercise", ExerciseSchema);
ExerciseModel.pullFromFavorites = pullFromFavorites;

module.exports = ExerciseModel;
