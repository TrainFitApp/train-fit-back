const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./product-controller");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getProducts);
router.getAsync(
  "/code/:userId/:barcode",
  auth(["admin", "user"]),
  controller.getProductByCode
);
router.getAsync("/count", auth(["admin", "user"]), controller.getProductsCount);
// "trainer" añadido — necesita buscar en el catálogo para el picker de
// "añadir producto" al construir una plantilla de dieta (funcionalidad 6),
// mismo criterio que exercises/exercise-routes.js (funcionalidad 5).
router.postAsync(
  "/search",
  auth(["admin", "user", "trainer"]),
  controller.searchProduct
);
router.postAsync("/", auth(["admin", "user"]), controller.createProduct);
router.putAsync("/", auth(["admin", "user"]), controller.updateProduct);
router.putAsync(
  "/promote/:id",
  auth(["admin", "user"]),
  controller.promoteToGlobal
);
router.putAsync(
  "/favProduct",
  auth(["admin", "user"]),
  controller.addFavoriteProduct
);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteProduct);

module.exports = router;
