const userSchema = require("../users/schema");
const dietDaysService = require("./diet-days-service");
const dietDaysUtil = require("./diet-days-util");
const dietModel = require("../diets/diet-model");

// Extraído de trainer-client-data-controller.js (F12) para reutilizarlo
// también en meal-proposal-controller.js (F28) — resuelve/crea el DietDay de
// un usuario para una fecha dada, sin asumir que ya existe. Nunca confiar en
// un mealId/mealSlot suelto sin resolverlo contra el dietInUse real del
// usuario (ver el IDOR ya documentado en meal-dao.js#pasteMeal).
async function resolveOwnedDietDay(userId, date) {
  let user = await userSchema.findById(userId).select("dietInUse");
  let dietId = user?.dietInUse;

  if (!dietId) {
    const diet = await dietModel.createDiet({ name: "Dieta", dietsDay: [] });
    dietId = diet._id;
    await userSchema.findByIdAndUpdate(userId, { $set: { dietInUse: dietId } });
  }

  let dietDay = await dietDaysService.findByIdDietAndDate(dietId, date);
  if (!dietDay) {
    const standardDietDay = dietDaysUtil.getStandardDietDay(date);
    const dietDayDoc = await dietDaysService.createDietDay(standardDietDay);
    await dietModel.addDietDietDay(dietId, dietDayDoc._id.toString());
    dietDay = dietDayDoc;
  }

  return dietDay;
}

// Resuelve un mealId suelto (p. ej. `mealToPaste._id` enviado por el cliente
// en `PUT /meals/paste`) contra el `dietInUse` REAL del usuario autenticado,
// devolviendo el `Meal` auténtico ya autopoblado desde BD — nunca el objeto
// que pudiera enviar el cliente en el body. Corrige el IDOR documentado en
// `meal-dao.js#pasteMeal` (ver `MVP-trainers/funcionalidades/F12-pautar-comida.md`
// §15): un `mealToPaste`/`customProducts` controlado por el cliente nunca debe
// usarse para identificar QUÉ comida mutar ni qué productos/recetas borrar.
async function resolveOwnedMealById(userId, mealId) {
  const user = await userSchema.findById(userId).select("dietInUse");
  const diet = user?.dietInUse ? await dietModel.getDietById(user.dietInUse) : null;

  for (const dietDay of diet?.dietsDay || []) {
    const meal = (dietDay.meals || []).find((m) => String(m._id) === String(mealId));
    if (meal) return meal;
  }

  const err = new Error("La comida indicada no pertenece a tu dieta");
  err.code = "MEAL_NOT_FOUND";
  throw err;
}

module.exports = { resolveOwnedDietDay, resolveOwnedMealById };
