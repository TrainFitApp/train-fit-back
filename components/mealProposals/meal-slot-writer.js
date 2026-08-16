const userSchema = require("../users/schema");
const dietDaysDao = require("../dietDays/diet-days-dao");
const dietDaysUtil = require("../dietDays/diet-days-util");
const dietDaySchema = require("../dietDays/diet-days-schema");
const mealSchema = require("../meals/meal-schema");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  // Compartido por "pautar" (fijar directo) y "elegir alternativa" de una
  // propuesta (funcionalidad 8) — ambos necesitan escribir un Meal concreto
  // en una franja concreta del día real de un cliente, creando el día si
  // hace falta (mismo criterio de "día sin tocar" que el resolver de dietas,
  // funcionalidad 6).
  async getOrCreateDietDay(clientId, date) {
    const user = await userSchema.findById(clientId).select("dietInUse");
    if (!user?.dietInUse) {
      throw makeError(409, "NO_ACTIVE_DIET", "El cliente no tiene ninguna dieta en uso");
    }

    let dietDay = await dietDaysDao.findByIdDietAndDate(user.dietInUse, date);
    if (!dietDay) {
      const standardDietDay = dietDaysUtil.getStandardDietDay(date);
      dietDay = await dietDaysDao.createDietDayOnNew(user.dietInUse, standardDietDay);
    }
    return dietDay;
  },

  // Reemplaza el Meal de la franja `mealSlot` por `newMealId`, borrando el
  // anterior (cascada real vía el hook de meal-schema.js).
  async replaceMealSlot(dietDayId, mealSlot, previousMealId, newMealId) {
    await dietDaySchema.findByIdAndUpdate(dietDayId, {
      $set: { [`meals.${mealSlot}`]: newMealId },
    });
    if (previousMealId) {
      await mealSchema.deleteOne({ _id: previousMealId });
    }
  },
};
