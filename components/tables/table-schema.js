const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const splitSchema = require("../splits/split-schema");
const pinnedExerciseNoteSchema = require("../pinnedExerciseNotes/pinned-exercise-note-schema");

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
    splits: [
      {
        type: Schema.Types.ObjectId,
        ref: "Split",
        autopopulate: true,
      },
    ],
  },
  { collection: "tables" }
);

TableSchema.plugin(require("mongoose-autopopulate"));

TableSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const table = await this.model.findOne(query);
    // Sin match (dueño equivocado, id ya borrado) es un resultado normal de
    // deleteOne — no un error. Sin este guard, table.splits revienta con
    // TypeError y el 404 limpio que espera el controller (deletedCount: 0)
    // nunca llega, sale un 500 en su lugar.
    if (!table) return next();
    await splitSchema.deleteMany({ _id: { $in: table.splits } });
    // Hueco preexistente (2026-08): las notas fijadas de esta tabla nunca se
    // limpiaban, ni aquí ni al borrar la cuenta del dueño (que pasa por este
    // mismo hook vía la cascada de users/schema.js).
    await pinnedExerciseNoteSchema.deleteMany({ tableId: table._id });
    next();
  } catch (error) {
    next(error);
  }
});

TableSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const tablesToDelete = await this.model.find(filter, "splits");
    const splitIds = tablesToDelete.flatMap((table) => table.splits);
    await splitSchema.deleteMany({ _id: { $in: splitIds } });
    await pinnedExerciseNoteSchema.deleteMany({
      tableId: { $in: tablesToDelete.map((table) => table._id) },
    });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Table", TableSchema);
