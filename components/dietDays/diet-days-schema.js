const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const mealSchema = require("../meals/meal-schema");

const DietDaySchema = Schema({
  date: String,
  notes: { type: String, trim: true, maxlength: 500 },
  steps: Number,
  // Fase 9 — qué patrón/menú de un plan "mode: choice" eligió el cliente
  // para ESTE día concreto (p. ej. "Entrenamiento"/"Descanso"). null en el
  // 100% de los días sin un plan de este tipo — ver diet-days-controller.js
  // getDayType/chooseDayType y planAssignments/plan-resolver.js.
  dayTypeName: { type: String, default: null },
  meals: [
    {
      type: Schema.Types.ObjectId,
      ref: "Meal",
      autopopulate: true,
    },
  ],
});

DietDaySchema.plugin(mongooseAutopopulate);

const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const dietDay = await this.model.findOne(query);
    if (dietDay) {
      await mealSchema.deleteMany({ _id: { $in: dietDay.meals } });
    }
    next();
  } catch (error) {
    next(error);
  }
};

DietDaySchema.pre("deleteOne", handleDeleteOne);
DietDaySchema.pre("findOneAndDelete", handleDeleteOne);
DietDaySchema.pre("findOneAndRemove", handleDeleteOne);

DietDaySchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const dietsDayToDelete = await this.model.find(filter, "meals");
    const mealIds = dietsDayToDelete.flatMap((dietsDay) => dietsDay.meals);
    await mealSchema.deleteMany({ _id: { $in: mealIds } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("DietDay", DietDaySchema);
