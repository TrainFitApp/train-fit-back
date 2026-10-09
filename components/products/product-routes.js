const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./product-controller");

const router = express.Router();

// La búsqueda de alimentos va por /meals/search (search-foods, cliente y
// profesional); aquí solo queda el catálogo.
router.getAsync("/", auth(["admin", "user", "trainer"]), controller.getProducts);
router.getAsync("/code/:barcode", auth(["admin", "user"]), controller.getProductByCode);
router.getAsync("/count", auth(["admin", "user", "trainer"]), controller.getProductsCount);
// TAREA5 — el entrenador crea productos reales (no macros a mano) para
// pautar comida vía search-foods (F12/F28).
router.postAsync("/", auth(["admin", "user", "trainer"]), controller.createProduct);
// El entrenador edita los suyos desde su Biblioteca › Alimentos y desde el
// detalle del buscador; el controller solo deja tocar los propios.
router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateProduct);
router.putAsync(
  "/promote/:id",
  auth(["admin", "user"]),
  controller.promoteToGlobal
);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteProduct);

module.exports = router;
