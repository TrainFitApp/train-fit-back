const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const SplitSchema = require("../splits/split-schema");
const PinnedExerciseNoteSchema = require("../pinnedExerciseNotes/pinned-exercise-note-schema");

const TableSchema = Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    type: String,
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    urlImage: String,
    // MVP-trainers F11/F14/D10: presente si un profesional asignó esta rutina
    // a este cliente. Permanente (trazabilidad/badge F15) — NO se borra al
    // revocar la relación. La exención de límite FREE que habilita SÍ depende
    // de si hay relación activa AHORA, no de este campo por sí solo (ver
    // table-service.js#countEffectiveUserTables).
    assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // Microciclos EMBEBIDOS y en orden (2026-10; antes colección `splits`).
    // Cada uno lista las sesiones (Workout) que tiene, también en orden.
    splits: { type: [SplitSchema], default: [] },
    // Notas ancladas por posición (2026-10; antes colección
    // `pinnedexercisenotes`): viven y mueren con la rutina.
    pinnedNotes: { type: [PinnedExerciseNoteSchema], default: [] },
  },
  { collection: "tables" }
);

TableSchema.plugin(require("mongoose-autopopulate"));

// Una sesión pertenece a UNA rutina: estas consultas resuelven "¿de qué
// rutina es este microciclo / esta sesión?" (permisos y cascadas).
TableSchema.index({ "splits._id": 1 });
TableSchema.index({ "splits.workouts": 1 });

function workoutIdsOf(tables) {
  return tables.flatMap((table) =>
    (table.splits || []).flatMap((split) => (split.workouts || []).map((w) => w?._id || w)),
  );
}

// Borrar una rutina borra sus sesiones (los microciclos y las notas van
// dentro del propio documento). Sin match (dueño equivocado, id ya borrado)
// es un resultado normal de deleteOne, no un error.
async function deleteWorkoutsOf(model, filter, { one = false } = {}) {
  const tables = one
    ? [await model.findOne(filter).select("splits.workouts").lean()].filter(Boolean)
    : await model.find(filter).select("splits.workouts").lean();
  const workoutIds = workoutIdsOf(tables);
  if (workoutIds.length) {
    await mongoose.model("Workout").deleteMany({ _id: { $in: workoutIds } });
  }
}

TableSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    await deleteWorkoutsOf(this.model, this.getQuery(), { one: true });
    next();
  } catch (error) {
    next(error);
  }
});

TableSchema.pre("deleteMany", async function (next) {
  try {
    await deleteWorkoutsOf(this.model, this.getFilter());
    next();
  } catch (error) {
    next(error);
  }
});

// Borrado de cuenta: sus rutinas se van con ella (y sus sesiones, por el hook
// de arriba); las que asignó como entrenador pasan a ser del cliente, sin la
// marca de asignada (si no, quedaban bloqueadas para siempre).
TableSchema.plugin(require("../util/account-cascade").accountCascade, {
  owners: ["userId"],
  detach: { assignedByTrainerId: "unset" },
});

const TableModel = mongoose.model("Table", TableSchema);
TableModel.workoutIdsOf = workoutIdsOf;

module.exports = TableModel;
