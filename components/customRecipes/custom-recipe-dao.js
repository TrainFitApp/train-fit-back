const { buildCustomRecipe } = require("./custom-recipe-builder");
const mealStore = require("../meals/meal-store");

// Recetas puestas en un plato, EMBEBIDAS en su comida (2026-10). Una receta
// ya no existe fuera de una comida (ni de una plantilla o una comida guardada
// del entrenador, que la construyen con el mismo builder).

const KIND = "customRecipes";

function notFound(id) {
  return new Error(`CustomRecipe not found: ${id}`);
}

module.exports = {
  // Construye la receta (sin guardarla): quien llama la mete en la comida,
  // la plantilla o la comida guardada que toque.
  async createCustomRecipe(customRecipe) {
    return buildCustomRecipe(customRecipe);
  },

  async update(id, updateData) {
    const found = await mealStore.mutateMealItem(id, KIND, (current) => buildCustomRecipe(updateData, { current }));
    if (!found) throw notFound(id);
    return mealStore.readMealItem(id, KIND);
  },

  // Marcar/desmarcar consumida — nunca bloqueado por assignedByTrainerId.
  async setConsumed(id, consumed) {
    await mealStore.mutateMealItem(id, KIND, (current) => ({ ...current, consumed: Boolean(consumed) }));
    return mealStore.readMealItem(id, KIND);
  },

  // Cantidad realmente consumida; assignedQuantity (lo pautado) no se toca.
  async setQuantity(id, quantity) {
    await mealStore.mutateMealItem(id, KIND, (current) => ({ ...current, quantity }));
    return mealStore.readMealItem(id, KIND);
  },
};
