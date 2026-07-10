const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const dietDaySchema = require('../dietDays/diet-days-schema');


const DietSchema = Schema({
  name: String,
  dietsDay: [
    {
      type: Schema.Types.ObjectId,
      ref: "DietDay",
      autopopulate: true
    },
  ],
});

DietSchema.plugin(mongooseAutopopulate);

const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const diet = await this.model.findOne(query);
    if (diet) {
      await dietDaySchema.deleteMany({ _id: { $in: diet.dietsDay } });
    }
    next();
  } catch (error) {
    next(error);
  }
};

DietSchema.pre("deleteOne", handleDeleteOne);
DietSchema.pre("findOneAndDelete", handleDeleteOne);
DietSchema.pre("findOneAndRemove", handleDeleteOne);

DietSchema.pre("deleteMany", async function (next) {
  try {
    // Obtén el filtro utilizado en la operación deleteMany
    const filter = this.getFilter();
    // Busca los documentos de Table que cumplen con el filtro y obtén los _id de las divisiones
    const dietsToDelete = await this.model.find(filter, "dietsDay");
    // Obtén un arreglo de _id de divisiones de todos los documentos
    const dietDaysIds = dietsToDelete.flatMap((diet) => diet.dietsDay);
    // Elimina las divisiones relacionadas en la colección splitSchema
    await dietDaySchema.deleteMany({ _id: { $in: dietDaysIds } });
    next();
  } catch (error) {
    // Maneja el error de manera adecuada, por ejemplo, puedes llamar a next con el error
    next(error);
  }
});

module.exports = mongoose.model("Diet", DietSchema);
