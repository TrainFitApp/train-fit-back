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
// TAREA5 — el entrenador crea productos reales (no macros a mano) para
// pautar comida vía search-foods/ProductSearchModalComponent (F12/F28).
router.postAsync("/", auth(["admin", "user", "trainer"]), controller.createProduct);
router.putAsync("/", auth(["admin", "user"]), controller.updateProduct);
router.putAsync(
  "/promote/:id",
  auth(["admin", "user"]),
  controller.promoteToGlobal
);
// TAREA5 — favoritos son la biblioteca personal del entrenador (idUser
// viaja en el body y el frontend del entrenador siempre manda su propio id,
// nunca el del cliente).
router.putAsync(
  "/favProduct",
  auth(["admin", "user", "trainer"]),
  controller.addFavoriteProduct
);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteProduct);

module.exports = router;
