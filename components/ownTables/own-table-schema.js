const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const splitSchema = require("../splits/split-schema");

const OwnTableSchema = Schema({
  name: String,
  type: String,
  splits: [
    {
      type: Schema.Types.ObjectId,
      ref: "Split",
      autopopulate: true,
    },
  ],
});

OwnTableSchema.plugin(require("mongoose-autopopulate"));

OwnTableSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const table = await this.model.findOne(query);
    await splitSchema.deleteMany({ _id: { $in: table.splits } });
    next();
  } catch (error) {
    // Maneja el error de manera adecuada, por ejemplo, puedes llamar a next con el error
    next(error);
  }
});

OwnTableSchema.pre("deleteMany", async function (next) {
  try {
    // Obtén el filtro utilizado en la operación deleteMany
    const filter = this.getFilter();
    // Busca los documentos de OwnTable que cumplen con el filtro y obtén los _id de las divisiones
    const tablesToDelete = await this.model.find(filter, "splits");
    // Obtén un arreglo de _id de divisiones de todos los documentos
    const splitIds = tablesToDelete.flatMap((table) => table.splits);
    // Elimina las divisiones relacionadas en la colección splitSchema
    await splitSchema.deleteMany({ _id: { $in: splitIds } });
    next();
  } catch (error) {
    // Maneja el error de manera adecuada, por ejemplo, puedes llamar a next con el error
    next(error);
  }
});

module.exports = mongoose.model("OwnTable", OwnTableSchema);
