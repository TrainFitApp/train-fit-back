const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getDiets);
router.getAsync(
  "/:id/recent-products",
  auth(["admin", "user"]),
  controller.getRecentMealProducts
);
router.getAsync(
  "/:id/recent-recipes",
  auth(["admin", "user"]),
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
