const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getDiets);
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
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteDiet);
router.deleteAsync(
  "/:iddiet/:iddietday",
  auth(["admin", "user"]),
  controller.deleteDietDietDay
);

module.exports = router;
