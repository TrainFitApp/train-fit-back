const express = require("express");
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
router.get("/search", readAuth, controller.searchRecipes);
router.get("/user", validateAuth, controller.getUserRecipes);
router.get("/verified", readAuth, controller.getVerifiedRecipes);
// TAREA5 — favoritos son la biblioteca personal del entrenador (req.user.id
// real), por eso viaja con "trainer" igual que /search, no con las rutas de
// propiedad de abajo.
router.get("/archived", readAuth, controller.getArchivedRecipes);

// CRUD operations
router.get("/:id", readAuth, controller.getRecipeById);
router.post("/", validateAuth, controller.createRecipe);
router.post("/compose", validateAuth, controller.composeRecipe);
router.put("/:id", validateAuth, controller.updateRecipe);
router.delete("/:id", validateAuth, controller.deleteRecipe);

// Archive toggle (recipes archived by user) — mismo motivo que /archived arriba
router.post("/:id/archive", readAuth, controller.toggleArchivedRecipe);

// CustomProduct management within Recipe
router.post(
  "/:idRecipe/customproducts/:idCustomProduct",
  validateAuth,
  controller.addRecipeCustomProduct,
);
router.delete(
  "/:idRecipe/customproducts/:idCustomProduct",
  validateAuth,
  controller.removeRecipeCustomProduct,
);

module.exports = router;
