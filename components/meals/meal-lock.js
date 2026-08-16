const mealSchema = require("./meal-schema");
const trainerClientAccess = require("../trainerClients/trainer-client-access");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  // Funcionalidad 8 — mientras un trainer haya pautado esta comida directa
  // (Meal.assignedByTrainerId) y la relación siga activa, el cliente no
  // puede tocar sus productos/recetas directo. Se libera solo si se revoca
  // la relación. Alcance de esta pasada: solo se aplica en los puntos de
  // entrada de CustomProduct (crear/borrar) — no en meal-controller
  // (renombrar/borrar el Meal entero) ni en customRecipes, por tiempo; ver
  // docs/trainfit-trainers/06-estado-actual.md.
  async assertMealEditable(mealId, actingUserId) {
    if (!mealId) return;
    const meal = await mealSchema.findById(mealId).select("assignedByTrainerId").lean();
    if (!meal?.assignedByTrainerId) return;

    const locked = await trainerClientAccess.hasActiveRelation(
      meal.assignedByTrainerId,
      actingUserId,
      "nutrition"
    );
    if (locked) {
      throw makeError(403, "MEAL_TRAINER_LOCKED", "Tu entrenador gestiona esta comida");
    }
  },
};
