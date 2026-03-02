const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./custom-product-controller");
// const ROLES = require('../users/util/roles');

const router = express.Router();

router.getAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.getCustomProductById
);
// router.getAsync('/barcode/:barcode', controller.getProductByBarCode);
// router.getAsync('/:search', controller.getSearchProduct);
router.postAsync(
  "/",
  auth(["admin", "user"]),
  controller.createCustomProductAndAddToMeal
);
router.putAsync("/", auth(["admin", "user"]), controller.updateCustomProduct);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.delete);

module.exports = router;
