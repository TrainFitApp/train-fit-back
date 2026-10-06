const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./recent-food-controller");

const router = express.Router();

// Montadas bajo /recent-foods. Ocultar y restaurar actúan siempre sobre el
// usuario del token; los listados aceptan ?userId= para el profesional de
// nutrición que pauta a un cliente.
router.getAsync("/products", auth(["admin", "user", "trainer"]), controller.listProducts);
router.getAsync("/recipes", auth(["admin", "user", "trainer"]), controller.listRecipes);
router.postAsync("/hidden", auth(["admin", "user"]), controller.hide);
router.postAsync("/hidden/restore", auth(["admin", "user"]), controller.restore);

module.exports = router;
