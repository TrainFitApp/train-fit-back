const mongoose = require("mongoose");
const favoritesDao = require("./favorites-dao");
const productService = require("../products/product-service");
const recipeService = require("../recipes/recipe-service");
const exerciseService = require("../exercises/exercise-service");
const { badRequest, notFound } = require("../util/http-error");

// Marcar y desmarcar favoritos, siempre del usuario de la sesión.

const NOT_FOUND = {
  products: "Producto no encontrado",
  recipes: "Receta no encontrada",
  exercises: "Ejercicio no encontrado",
};

function assertKindAndId(kind, id) {
  if (!favoritesDao.KINDS.includes(kind)) throw notFound("Tipo de favorito desconocido");
  if (!mongoose.isValidObjectId(id)) throw badRequest("Id inválido");
}

// Solo se marca lo que existe y el usuario puede ver. Las recetas se listan
// por id desde sus favoritas: marcar una privada ajena serviría para leerla.
async function assertCanFavorite(userId, kind, id, { isAdmin }) {
  if (kind === "products" && (await productService.getProduct(id))) return;
  if (kind === "exercises" && (await exerciseService.getExercise(id))) return;
  if (kind === "recipes") {
    const recipe = await recipeService.getRecipeById(id);
    if (recipe && (isAdmin || (await recipeService.canUserReadRecipe(recipe, userId)))) return;
  }
  throw notFound(NOT_FOUND[kind]);
}

module.exports = {
  async add(userId, kind, id, { isAdmin = false } = {}) {
    assertKindAndId(kind, id);
    await assertCanFavorite(userId, kind, id, { isAdmin });
    await favoritesDao.add(userId, kind, id);
  },

  // Quitar siempre se puede, exista o no lo marcado.
  async remove(userId, kind, id) {
    assertKindAndId(kind, id);
    await favoritesDao.remove(userId, kind, id);
  },
};
