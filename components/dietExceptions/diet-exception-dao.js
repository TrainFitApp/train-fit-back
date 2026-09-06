const dietDaySchema = require("../dietDays/diet-days-schema");
const mealSchema = require("../meals/meal-schema");

// Refactor nutrición (2026-09) — la colección `dietexceptions` desapareció.
// Una excepción ya no es un documento aparte: es una marca en el registro
// real que afecta, igual que `Workout.rest` en entrenamiento.
//
//   día entero saltado -> DietDay.skipped
//   una comida cambiada -> Meal.wasOverridden
//
// El contenido del override no se guarda por duplicado: al aplicarlo ya
// queda como el customProducts/customRecipes real de esa comida.
//
// Se conserva la forma del DAO anterior para no reescribir sus consumidores
// (plan-resolver, historial del entrenador).

function toException(day, meal) {
  return {
    _id: meal ? meal._id : day._id,
    clientId: day.userId,
    date: day.date,
    mealSlot: meal ? meal.name : null,
    action: meal ? "override" : "skip",
    override: { customProducts: [], customRecipes: [] },
  };
}

module.exports = {
  // Marca la desviación donde toca según haya mealSlot o no.
  async create({ clientId, date, mealSlot, action }) {
    const day = await dietDaySchema.findOne({ userId: clientId, date });
    if (!day) return null;

    if (!mealSlot) {
      day.skipped = action !== "override";
      await day.save();
      return toException(day, null);
    }

    const meal = await mealSchema.findOne({ _id: { $in: day.meals }, name: mealSlot });
    if (!meal) return null;
    meal.wasOverridden = true;
    await meal.save();
    return toException(day, meal);
  },

  // Excepciones de una fecha exacta — la usa plan-resolver para saber si ese
  // día (o alguna de sus comidas) se desvió del plan.
  async findForDate(clientId, date) {
    const day = await dietDaySchema.findOne({ userId: clientId, date }).lean();
    if (!day) return [];

    const result = [];
    if (day.skipped) result.push(toException(day, null));

    const meals = await mealSchema
      .find({ _id: { $in: day.meals || [] }, wasOverridden: true })
      .select("name")
      .lean();
    meals.forEach((meal) => result.push(toException(day, meal)));

    return result;
  },

  // TASK-045 — historial de nutrición del entrenador. Antes era un find
  // sobre la colección propia; ahora sale del índice (userId, date) de
  // dietdays, que además ya está ordenado por lo que se pide.
  async findAllForClient(clientId, limit = 100) {
    const days = await dietDaySchema
      .find({ userId: clientId })
      .select("date skipped meals userId")
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    if (!days.length) return [];

    const allMealIds = days.flatMap((day) => day.meals || []);
    const overridden = await mealSchema
      .find({ _id: { $in: allMealIds }, wasOverridden: true })
      .select("name")
      .lean();
    const overriddenById = new Map(overridden.map((meal) => [String(meal._id), meal]));

    const result = [];
    days.forEach((day) => {
      if (day.skipped) result.push(toException(day, null));
      (day.meals || []).forEach((mealId) => {
        const meal = overriddenById.get(String(mealId));
        if (meal) result.push(toException(day, meal));
      });
    });

    return result.slice(0, limit);
  },
};
