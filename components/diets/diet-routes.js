const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-controller");

const router = express.Router();

// Capa de compatibilidad — ver cabecera de diet-dao.js. Las rutas mantienen
// su forma para que las apps ya instaladas sigan funcionando; el ":id" que
// mandan (lo que ellas llaman dietId) ya es el id del propio usuario.
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
router.putAsync(
  "/:idDiet/:idDietDay",
  auth(["admin", "user"]),
  controller.addDietDietDay
);
router.patchAsync("/:id/pinned-note", auth(["admin", "user"]), controller.updatePinnedNote);

module.exports = router;
