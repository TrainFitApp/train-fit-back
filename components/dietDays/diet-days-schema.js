const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const MealSchema = require("../meals/meal-schema");

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
  // chooseMenu y dietPhases/diet-phase-resolver.js.
  menuName: { type: String, default: null },
  // Las comidas del día, EMBEBIDAS y en el orden de los huecos (Desayuno,
  // Almuerzo, Comida, Merienda, Cena, Recena), con sus alimentos y recetas
  // dentro (2026-10; antes cuatro colecciones). Un día se lee y se escribe
  // como un solo documento, y pegar un día o una comida es atómico.
  meals: { type: [MealSchema], default: [] },
});

DietDaySchema.plugin(mongooseAutopopulate);

// "El día de tal fecha de este usuario" es LA consulta del módulo (se hace en
// cada apertura de la pantalla de dieta). Compuesto y en este orden porque
// también sirve para los rangos (userId + date entre X e Y) y para la
// historia de saltos (userId + skipped), que solo añade un filtro sobre un
// prefijo ya indexado.
//
// ÚNICO (2026-10) — un usuario no puede tener dos días con la misma fecha.
// No es una optimización: era posible acabar con días solapados (dos
// documentos con el mismo (userId, date)) porque cada "crear producto/receta
// en un día nuevo" hacía un create a ciegas, sin mirar si el día ya existía.
// El invariante se defiende aquí, en la base, y no solo en el código:
// dietDays/diet-days-dao.js#ensureDietDay es la única vía de creación y se
// apoya en este índice para resolver la carrera (dos peticiones simultáneas
// para la misma fecha: la perdedora recibe E11000 y relee la ganadora).
//
// `partialFilterExpression`: los días huérfanos sin userId (restos del
// modelo viejo con wrapper Diet) se quedan fuera del índice en vez de
// colisionar todos entre sí por `null`.
//
// Al desplegar esto sobre una base que ya tenía el índice NO único hay que
// pasar `npm run migrate:modelo-datos` (paso 02: funde duplicados y
// sustituye el índice). Si no, mongoose no puede crear el índice (IndexOptionsConflict) y
// la protección se queda sin aplicar.
DietDaySchema.index(
  { userId: 1, date: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);

// Las rutas por id de comida, alimento o receta localizan su día por estos
// campos, y el borrado de un producto o una receta del catálogo encuentra
// los días que lo usan.
DietDaySchema.index({ "meals._id": 1 });
DietDaySchema.index({ "meals.customProducts._id": 1 });
DietDaySchema.index({ "meals.customRecipes._id": 1 });
DietDaySchema.index({ "meals.customProducts.product": 1 });
DietDaySchema.index({ "meals.customRecipes.recipe": 1 });
DietDaySchema.index({ "meals.customRecipes.addedCustomProducts.product": 1 });
DietDaySchema.index({ "meals.customRecipes.modifiedBaseCustomProducts.product": 1 });

DietDaySchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["userId"], authorship: ["assignedByTrainerId", "alternativesTrainerId"] });

module.exports = mongoose.model("DietDay", DietDaySchema);
