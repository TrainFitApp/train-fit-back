const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getDiets);
// TAREA5 — el entrenador necesita ver los productos/recetas más usados en la
// comida de un cliente (misma pantalla search-foods) para no partir de cero
// en cada búsqueda. Solo lectura, no expone ni muta datos de otro usuario
// (dietId/mealIndex van por la URL, sin comprobación de propiedad hoy).
router.getAsync(
  "/:id/recent-products",
  auth(["admin", "user", "trainer"]),
  controller.getRecentMealProducts
);
router.getAsync(
  "/:id/recent-recipes",
  auth(["admin", "user", "trainer"]),
  controller.getRecentMealRecipes
);
router.getAsync("/:id", auth(["admin", "user"]), controller.getDietById);
router.postAsync("/search", auth(["admin", "user"]), controller.getSearchDiets);
router.postAsync("/", auth(["admin", "user"]), controller.createDiet);
router.putAsync(
  "/:idDiet/:idDietDay",
  auth(["admin", "user"]),
  controller.addDietDietDay
);
router.putAsync(
  "/add/:idUser/:idDiet",
  auth(["admin", "user"]),
  controller.addDietUser
);
router.patchAsync("/:id", auth(["admin", "user"]), controller.updateDiet);
router.patchAsync("/:id/pinned-note", auth(["admin", "user"]), controller.updatePinnedNote);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteDiet);
router.deleteAsync(
  "/:iddiet/:iddietday",
  auth(["admin", "user"]),
  controller.deleteDietDietDay
);

module.exports = router;
