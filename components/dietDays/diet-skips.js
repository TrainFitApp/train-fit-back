const dietDaySchema = require("./diet-days-schema");
const mealDao = require("../meals/meal-dao");
const mealAlternatives = require("../meals/meal-alternatives");

// Días SALTADOS: "este día el cliente no sigue el plan".
//
// No hay colección propia (la hubo, `dietexceptions`, y se retiró en el
// refactor de 2026-09): saltarse un día es una marca en el registro real que
// afecta, igual que `Workout.rest` en entrenamiento. Un día saltado NO es un
// día sin plan — el plan sigue vigente, es ese día concreto el que no cuenta.
//
// Lo que existió como "excepción por comida" (`Meal.wasOverridden`) se ha
// eliminado: nadie lo escribía, su contenido nunca se guardaba y el resolver
// acababa tratándolo como un salto de esa comida. Si algún día hace falta
// sustituir UNA comida, el camino ya existe y es pautarla.

/**
 * Deja el día sin nada PAUTADO: borra los alimentos que puso el profesional
 * (los que anotó el cliente por su cuenta se quedan), olvida el menú elegido
 * y retira las propuestas de comida pendientes.
 *
 * Es el mismo vaciado que hace "salir del menú" en la app del cliente, por
 * eso vive aquí y no duplicado en cada controller.
 */
async function clearPlannedDay(userId, date, dietDay) {
  for (const meal of dietDay.meals || []) {
    const mealId = meal?._id || meal;
    if (mealId) await mealDao.removePlannedItems(mealId);
  }
  await dietDaySchema.findByIdAndUpdate(dietDay._id, { $set: { menuName: null } });
  await mealAlternatives.clearForDate(userId, date);
}

/**
 * Marca el día como saltado Y lo vacía de verdad. Antes solo escribía la
 * marca, así que un día que el cliente ya había resuelto se quedaba con sus
 * comidas puestas pese a decir la UI que "queda vacío".
 */
async function markDaySkipped(clientId, date) {
  const dietDay = await dietDaySchema.findOne({ userId: clientId, date });
  if (!dietDay) return null;

  await clearPlannedDay(clientId, date, dietDay);
  await dietDaySchema.updateOne({ _id: dietDay._id }, { $set: { skipped: true } });
  return { clientId, date };
}

/** ¿Este día está saltado? Lo pregunta el resolver antes de pautar nada. */
async function isDaySkipped(clientId, date) {
  const dietDay = await dietDaySchema.findOne({ userId: clientId, date }).select("skipped").lean();
  return !!dietDay?.skipped;
}

/**
 * Fechas saltadas del cliente, de la más reciente a la más antigua. Sale del
 * índice (userId, date), que ya viene ordenado por lo que se pide.
 */
async function listSkippedDates(clientId, limit = 100) {
  const days = await dietDaySchema
    .find({ userId: clientId, skipped: true })
    .select("date")
    .sort({ date: -1 })
    .limit(limit)
    .lean();
  return days.map((day) => day.date);
}

module.exports = { clearPlannedDay, markDaySkipped, isDaySkipped, listSkippedDates };
