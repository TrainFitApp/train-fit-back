const mealSchema = require("../meals/meal-schema");
const mealDao = require("../meals/meal-dao");
const dietDaySchema = require("../dietDays/diet-days-schema");

// Refactor nutrición (2026-09) — la colección `mealproposals` desapareció:
// las alternativas viven dentro de la propia Meal a la que afectan
// (Meal.alternatives / chosenAlternativeIndex / alternativesTrainerId). Este
// DAO conserva la forma de antes para no reescribir sus consumidores, pero
// cada "propuesta" es ahora una comida con alternativas.
//
// El `_id` que se expone como id de propuesta es el de la propia Meal: el
// cliente solo lo reenvía tal cual al elegir, así que el cambio es
// transparente para las apps ya instaladas.
//
// Opciones de comida (2026-09) — ya no existe el estado "pendiente de
// elegir": una comida con 2+ alternativas nace con la opción 1 aplicada
// (chosenAlternativeIndex = 0) y el cliente alterna desde ahí. Con una sola
// alternativa se aplica igual pero sin selector (alternatives queda vacío).
// Aplicar una opción SOLO toca lo pautado: los productos/recetas que el
// cliente añadió por su cuenta (sin assignedByTrainerId) sobreviven al
// cambio, mismo criterio que "salir del menú" (plan §11).

// Convierte una Meal (con su día) al shape que esperaban los consumidores.
function toProposal(meal, date) {
  return {
    _id: meal._id,
    trainerId: meal.alternativesTrainerId || null,
    date,
    mealSlot: meal.name,
    alternatives: meal.alternatives || [],
    chosenIndex: meal.chosenAlternativeIndex ?? null,
  };
}

async function mealsWithAlternativesForDate(clientId, date) {
  const day = await dietDaySchema
    .findOne({ userId: clientId, date })
    .select("meals date")
    .lean();
  if (!day?.meals?.length) return [];

  const meals = await mealSchema
    .find({ _id: { $in: day.meals } })
    .select("name alternatives chosenAlternativeIndex alternativesTrainerId")
    .lean();

  return meals
    .filter((meal) => (meal.alternatives || []).length)
    .map((meal) => toProposal(meal, day.date));
}

async function findMealForSlot(clientId, date, mealSlot) {
  const day = await dietDaySchema
    .findOne({ userId: clientId, date })
    .select("meals date")
    .lean();
  if (!day?.meals?.length) return { day: null, meal: null };
  const meal = await mealSchema.findOne({ _id: { $in: day.meals }, name: mealSlot });
  return { day, meal };
}

// Materializa `alternative` como lo pautado de la comida: quita lo pautado
// anterior (los items del cliente se quedan), pastea en modo combinar con
// trainerId para que cada item nuevo quede marcado como pautado. No bloquea
// la comida entera (markAssignedByTrainer): sigue siendo mixta.
async function applyAlternative(mealId, alternative, chosenIndex, trainerId) {
  const cleaned = await mealDao.removePlannedItems(mealId);
  if (!cleaned) return null;
  await mealDao.pasteMeal(
    {
      customProducts: alternative?.customProducts || [],
      customRecipes: alternative?.customRecipes || [],
    },
    cleaned,
    true,
    trainerId
  );
  return mealSchema.findByIdAndUpdate(
    mealId,
    { $set: { chosenAlternativeIndex: chosenIndex } },
    { new: true }
  );
}

module.exports = {
  // Guardar alternativas ES escribirlas en la comida correspondiente del día
  // y dejar la primera aplicada. Vale con 1 alternativa (sin selector) o
  // con 2+ (selector persistente en la app del cliente).
  async create(trainerId, clientId, date, mealSlot, alternatives) {
    const { day, meal } = await findMealForSlot(clientId, date, mealSlot);
    if (!meal || !(alternatives || []).length) return null;

    const hasChoice = alternatives.length >= 2;
    await mealSchema.updateOne(
      { _id: meal._id },
      {
        $set: {
          alternatives: hasChoice ? alternatives : [],
          alternativesTrainerId: hasChoice ? trainerId : null,
        },
      }
    );
    const updated = await applyAlternative(meal._id, alternatives[0], hasChoice ? 0 : null, trainerId);
    return updated ? toProposal(updated, day.date) : null;
  },

  // El cliente elige (o cambia) una opción. Volver a aplicar la misma opción
  // rehace lo pautado sin duplicar nada (lo consumido se pierde igual).
  async choose(mealId, chosenIndex) {
    const meal = await mealSchema.findById(mealId).lean();
    const alternative = (meal?.alternatives || [])[chosenIndex];
    if (!alternative) return null;
    return applyAlternative(mealId, alternative, chosenIndex, meal.alternativesTrainerId);
  },

  // Sin filtrar por elección: el selector del cliente es persistente, tiene
  // que poder alternar entre opciones ya elegidas.
  async listForClientAndDate(clientId, date) {
    return mealsWithAlternativesForDate(clientId, date);
  },

  // Dashboard Coach — hoy ninguna comida queda "pendiente" (nace con la
  // opción 1 aplicada); se mantiene por los días anteriores a ese cambio
  // que la migración no haya tocado y para no romper al consumidor.
  async listAllPendingForClient(clientId) {
    const days = await dietDaySchema
      .find({ userId: clientId })
      .select("meals date")
      .lean();
    if (!days.length) return [];

    const mealIdToDate = new Map();
    days.forEach((day) =>
      (day.meals || []).forEach((mealId) => mealIdToDate.set(String(mealId), day.date))
    );

    const meals = await mealSchema
      .find({
        _id: { $in: [...mealIdToDate.keys()] },
        chosenAlternativeIndex: null,
      })
      .select("name alternatives chosenAlternativeIndex alternativesTrainerId")
      .lean();

    return meals
      .filter((meal) => (meal.alternatives || []).length)
      .map((meal) => toProposal(meal, mealIdToDate.get(String(meal._id))));
  },

  // Incluye clientId (dueño del día) para que el controller compruebe que
  // quien elige es el propio cliente.
  async findById(id) {
    const meal = await mealSchema.findById(id).lean();
    if (!meal || !(meal.alternatives || []).length) return null;
    const day = await dietDaySchema.findOne({ meals: meal._id }).select("date userId").lean();
    return { ...toProposal(meal, day?.date), clientId: day?.userId || null };
  },

  // Retira las alternativas de todas las comidas del día — "salir del menú"
  // (diet-days-controller#leaveDayType) ya quita lo pautado, así que el
  // selector tampoco tiene sentido.
  async clearForDate(clientId, date) {
    const day = await dietDaySchema
      .findOne({ userId: clientId, date })
      .select("meals")
      .lean();
    if (!day?.meals?.length) return { modifiedCount: 0 };
    const res = await mealSchema.updateMany(
      { _id: { $in: day.meals } },
      { $set: { alternatives: [], alternativesTrainerId: null, chosenAlternativeIndex: null } }
    );
    return { modifiedCount: res.modifiedCount || 0 };
  },

  // Re-resolver el plan sobre una comida que en el plan nuevo queda vacía:
  // fuera selector y fuera lo pautado (los items del cliente se quedan).
  async clearForDateAndSlot(clientId, date, mealSlot) {
    const { meal } = await findMealForSlot(clientId, date, mealSlot);
    if (!meal) return null;
    const hasPlanned =
      (meal.customProducts || []).some((cp) => cp?.assignedByTrainerId) ||
      (meal.customRecipes || []).some((cr) => cr?.assignedByTrainerId);
    if (!hasPlanned && !(meal.alternatives || []).length) return meal;
    await mealDao.removePlannedItems(meal._id);
    return mealSchema.findByIdAndUpdate(
      meal._id,
      { $set: { alternatives: [], alternativesTrainerId: null, chosenAlternativeIndex: null } },
      { new: true }
    );
  },
};
