const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-snippet-controller");

const router = express.Router();

router.getAsync("/meal-snippets", auth(["trainer"]), controller.list);
router.postAsync("/meal-snippets", auth(["trainer"]), controller.create);
router.getAsync("/meal-snippets/:id", auth(["trainer"]), controller.getById);
router.putAsync("/meal-snippets/:id", auth(["trainer"]), controller.rename);
router.deleteAsync("/meal-snippets/:id", auth(["trainer"]), controller.remove);

router.postAsync(
  "/meal-snippets/:id/products",
  auth(["trainer"]),
  controller.addCustomProduct
);
router.deleteAsync(
  "/meal-snippets/:id/products/:customProductId",
  auth(["trainer"]),
  controller.removeCustomProduct
);

module.exports = router;
