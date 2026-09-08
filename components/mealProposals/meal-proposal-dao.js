const mealSchema = require("../meals/meal-schema");
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

module.exports = {
  // Guardar alternativas ES escribirlas en la comida correspondiente del día.
  async create(trainerId, clientId, date, mealSlot, alternatives) {
    const day = await dietDaySchema
      .findOne({ userId: clientId, date })
      .select("meals date")
      .lean();
    if (!day?.meals?.length) return null;

    const meal = await mealSchema.findOneAndUpdate(
      { _id: { $in: day.meals }, name: mealSlot },
      {
        $set: {
          alternatives,
          alternativesTrainerId: trainerId,
          chosenAlternativeIndex: null,
        },
      },
      { new: true }
    );
    return meal ? toProposal(meal, day.date) : null;
  },

  async listPendingForClientAndDate(clientId, date) {
    const all = await mealsWithAlternativesForDate(clientId, date);
    return all.filter((proposal) => proposal.chosenIndex === null);
  },

  // Sin filtrar por elección: el selector del cliente es persistente, tiene
  // que poder alternar entre opciones ya elegidas.
  async listForClientAndDate(clientId, date) {
    return mealsWithAlternativesForDate(clientId, date);
  },

  // Todas las pendientes del cliente, sin filtrar por fecha (dashboard Coach).
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

  async findById(id) {
    const meal = await mealSchema.findById(id).lean();
    if (!meal || !(meal.alternatives || []).length) return null;
    const day = await dietDaySchema.findOne({ meals: meal._id }).select("date").lean();
    return toProposal(meal, day?.date);
  },

  async setChosenIndex(id, chosenIndex) {
    const meal = await mealSchema.findByIdAndUpdate(
      id,
      { $set: { chosenAlternativeIndex: chosenIndex } },
      { new: true }
    );
    if (!meal) return null;
    const day = await dietDaySchema.findOne({ meals: meal._id }).select("date").lean();
    return toProposal(meal, day?.date);
  },

  // Fase 9 — antes de volver a resolver el plan para esta fecha+comida se
  // retiran las alternativas que quedaran sin elegir, para no dejar restos de
  // una resolución anterior. Una ya elegida no se toca: es historial real.
  async deletePendingForDateAndSlot(clientId, date, mealSlot) {
    const day = await dietDaySchema
      .findOne({ userId: clientId, date })
      .select("meals")
      .lean();
    if (!day?.meals?.length) return { deletedCount: 0 };

    const res = await mealSchema.updateMany(
      { _id: { $in: day.meals }, name: mealSlot, chosenAlternativeIndex: null },
      { $set: { alternatives: [], alternativesTrainerId: null } }
    );
    return { deletedCount: res.modifiedCount || 0 };
  },
};
