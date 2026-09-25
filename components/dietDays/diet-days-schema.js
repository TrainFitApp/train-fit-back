const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const mealSchema = require("../meals/meal-schema");

const DietDaySchema = Schema({
  // Refactor nutrición (2026-09) — dueño DIRECTO del día. Antes la única
  // forma de saber de quién era un DietDay era recorrer Diet.dietsDay[] del
  // usuario: findByIdDietAndDate cargaba el historial ENTERO (autopopulate,
  // o sea con todas las comidas y productos de todos los días) para filtrar
  // en JavaScript un único día. Con este campo + el índice de abajo, esa
  // consulta pasa a ser un findOne indexado.
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  date: String,
  notes: { type: String, trim: true, maxlength: 500 },
  // "El cliente se saltó este día": un booleano del registro real, no un
  // documento en una colección aparte (mismo criterio que Workout.rest en
  // entrenamiento). Lo escribe dietDays/diet-skips.js, que además vacía el
  // día de lo pautado. El historial de nutrición del entrenador (TASK-045)
  // se resuelve con find({userId, skipped:true}) sobre el índice de abajo.
  skipped: { type: Boolean, default: false },
  // Qué menú del plan eligió el cliente para ESTE día concreto (p. ej.
  // "Entrenamiento"/"Descanso"). null mientras no elija, y en el 100% de los
  // días de quien no tiene plan — ver diet-days-controller.js getMenu/
  // chooseMenu y planAssignments/plan-resolver.js.
  menuName: { type: String, default: null },
  meals: [
    {
      type: Schema.Types.ObjectId,
      ref: "Meal",
      autopopulate: true,
    },
  ],
});

DietDaySchema.plugin(mongooseAutopopulate);

// "El día de tal fecha de este usuario" es LA consulta del módulo (se hace en
// cada apertura de la pantalla de dieta). Compuesto y en este orden porque
// también sirve para los rangos (userId + date entre X e Y) y para el
// historial de saltos (userId + skipped), que solo añade un filtro sobre un
// prefijo ya indexado.
DietDaySchema.index({ userId: 1, date: 1 });

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
