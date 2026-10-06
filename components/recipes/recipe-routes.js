const express = require("@awaitjs/express");
const router = express.Router();
const controller = require("./recipe-controller");
const { validateAuth } = require("../../middleware");
const { auth } = require("../../middleware/validateAuth");

// TAREA5 — el entrenador necesita buscar recetas reales para pautar comida
// vía search-foods (misma pantalla del consumidor). Solo se abre a "trainer"
// lo de solo-lectura/navegación; crear, editar, borrar y archivar recetas
// sigue restringido a validateAuth (user/admin), ya que esas rutas
// autorizan por propiedad (existing.userId === req.user.id) y un
// entrenador nunca es dueño de una receta de su cliente.
const readAuth = auth(["admin", "user", "trainer"]);

// Search and filter routes (must be before /:id)
router.getAsync("/search", readAuth, controller.searchRecipes);
router.getAsync("/user", validateAuth, controller.getUserRecipes);
router.getAsync("/verified", readAuth, controller.getVerifiedRecipes);

// CRUD operations
router.getAsync("/:id", readAuth, controller.getRecipeById);
router.postAsync("/", validateAuth, controller.createRecipe);
// El trainer necesita crear recetas reales para su propia biblioteca desde
// el constructor de plantillas (mismo precedente que POST /product más
// abajo en components/products/product-routes.js, que ya usa
// auth(["admin","user","trainer"])). composeRecipe en sí sigue limitando lo
// que un trainer puede hacer aquí (ver isTrainer() ahí): solo crear una
// receta nueva y standalone, nunca adjuntarla a un meal/diet day vía
// recipeId/context — eso sigue siendo terreno exclusivo de "user"/"admin".
router.postAsync("/compose", auth(["admin", "user", "trainer"]), controller.composeRecipe);
router.putAsync("/:id", validateAuth, controller.updateRecipe);
router.deleteAsync("/:id", validateAuth, controller.deleteRecipe);

// CustomProduct management within Recipe
router.deleteAsync(
  "/:idRecipe/customproducts/:idCustomProduct",
  validateAuth,
  controller.removeRecipeCustomProduct,
);

module.exports = router;
