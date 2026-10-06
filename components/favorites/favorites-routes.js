const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./favorites-controller");

// Favoritos del usuario de la sesión. "trainer": el profesional marca los
// suyos al construir dietas y rutinas.
const router = express.Router();
const roles = auth(["admin", "user", "trainer"]);

router.putAsync("/:kind/:id", roles, controller.add);
router.deleteAsync("/:kind/:id", roles, controller.remove);

module.exports = router;
