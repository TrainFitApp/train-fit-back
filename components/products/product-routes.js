const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./product-controller");

const router = express.Router();

// Replanteamiento MVP (nutrición) — catálogo global de productos, sin dueño
// para efectos de búsqueda (igual que exercise-routes.js): el entrenador
// necesita buscar alimentos reales para ProductSearchModalComponent (pautar
// comida F12/F28 y constructor de plantillas de dieta).
router.getAsync("/", auth(["admin", "user", "trainer"]), controller.getProducts);
router.getAsync(
  "/code/:userId/:barcode",
  auth(["admin", "user"]),
  controller.getProductByCode
);
router.getAsync("/count", auth(["admin", "user", "trainer"]), controller.getProductsCount);
router.postAsync("/search", auth(["admin", "user", "trainer"]), controller.searchProduct);
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
