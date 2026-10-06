const mealDao = require("./meal-dao");
const mealStore = require("./meal-store");
const dietDaySchema = require("../dietDays/diet-days-schema");
const { mutateDocument } = require("../util/embedded-store");

// Opciones de una comida del diario (Meal.alternatives,
// chosenAlternativeIndex, alternativesTrainerId). Las pone el plan del
// profesional al resolverse sobre el día (diet-day-resolver.js): con 2+
// opciones la comida nace con la 1ª aplicada y el cliente alterna desde ahí;
// con una sola se aplica igual y no hay selector. Aplicar una opción SOLO
// toca lo pautado: lo que el cliente añadió por su cuenta (sin
// assignedByTrainerId) sobrevive al cambio, mismo criterio que "salir del
// menú".

const hasAlternatives = (meal) => (meal.alternatives || []).length > 0;

async function findMealForSlot(clientId, date, mealSlot) {
  const day = await dietDaySchema
    .findOne({ userId: clientId, date })
    .select("meals._id meals.name meals.alternatives meals.customProducts.assignedByTrainerId meals.customRecipes.assignedByTrainerId")
    .lean();
  return (day?.meals || []).find((candidate) => candidate.name === mealSlot) || null;
}

// Materializa `alternative` como lo pautado de la comida: quita lo pautado
// anterior (los items del cliente se quedan) y pega en modo combinar con
// trainerId para que cada item nuevo quede marcado como pautado. No bloquea
// la comida entera (assignedByTrainerId): sigue siendo mixta.
async function applyAlternative(mealId, alternative, chosenIndex, trainerId) {
  const cleaned = await mealDao.removePlannedItems(mealId);
  if (!cleaned) return null;
  await mealDao.pasteMeal(
    { customProducts: alternative?.customProducts || [], customRecipes: alternative?.customRecipes || [] },
    cleaned,
    true,
    trainerId,
  );
  await mealStore.mutateMeal(mealId, (meal) => ({ ...meal, chosenAlternativeIndex: chosenIndex }));
  return mealStore.readMeal(mealId);
}

module.exports = {
  // Escribe las opciones en la comida `mealSlot` del día y deja la primera
  // aplicada.
  async applyToSlot(trainerId, clientId, date, mealSlot, alternatives) {
    const meal = await findMealForSlot(clientId, date, mealSlot);
    if (!meal || !(alternatives || []).length) return null;

    const hasChoice = alternatives.length >= 2;
    await mealStore.mutateMeal(meal._id, (current) => ({
      ...current,
      alternatives: hasChoice ? alternatives : [],
      alternativesTrainerId: hasChoice ? trainerId : null,
    }));
    return applyAlternative(meal._id, alternatives[0], hasChoice ? 0 : null, trainerId);
  },

  // El cliente elige (o cambia) una opción. Volver a aplicar la misma opción
  // rehace lo pautado sin duplicar nada (lo consumido se pierde igual).
  async choose(mealId, chosenIndex) {
    const meal = await mealStore.readMeal(mealId);
    const alternative = (meal?.alternatives || [])[chosenIndex];
    if (!alternative) return null;
    return applyAlternative(mealId, alternative, chosenIndex, meal.alternativesTrainerId);
  },

  async clearForDate(clientId, date) {
    let modifiedCount = 0;
    await mutateDocument(dietDaySchema, { userId: clientId, date }, (day) => {
      modifiedCount = (day.meals || []).length;
      if (!modifiedCount) return null;
      return {
        meals: day.meals.map((meal) => ({
          ...meal,
          alternatives: [],
          alternativesTrainerId: null,
          chosenAlternativeIndex: null,
        })),
      };
    });
    return { modifiedCount };
  },

  async clearForDateAndSlot(clientId, date, mealSlot) {
    const meal = await findMealForSlot(clientId, date, mealSlot);
    if (!meal) return null;
    const hasPlanned =
      (meal.customProducts || []).some((cp) => cp?.assignedByTrainerId) ||
      (meal.customRecipes || []).some((cr) => cr?.assignedByTrainerId);
    if (!hasPlanned && !hasAlternatives(meal)) return meal;
    await mealDao.removePlannedItems(meal._id);
    await mealStore.mutateMeal(meal._id, (current) => ({
      ...current,
      alternatives: [],
      alternativesTrainerId: null,
      chosenAlternativeIndex: null,
    }));
    return mealStore.readMeal(meal._id);
  },
};
