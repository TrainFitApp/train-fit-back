const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const splitSchema = require("../splits/split-schema");

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
    // Marca permanente de qué trainer asignó esta tabla (funcionalidad 5,
    // docs/trainfit-trainers/05-especificaciones-acordadas.md) — independiente
    // del estado vivo de la relación TrainerClient, se conserva aunque se
    // revoque la relación (decisión de la funcionalidad 2: dos fuentes a
    // consultar juntas para "¿esto viene de un trainer con acceso ahora?").
    assignedByTrainerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
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
    await splitSchema.deleteMany({ _id: { $in: table.splits } });
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
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Table", TableSchema);
