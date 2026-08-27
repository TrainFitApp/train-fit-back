const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./food-exchange-controller");

const router = express.Router();

// --- Lado cliente ---
// Declaradas ANTES que "/food-exchanges/:id" del profesional: "mine" y
// "my-plan" no son ObjectIds, pero el router prueba en orden y lo más
// específico va primero (mismo criterio que el resto del proyecto).
//
// Los intercambios los consulta el CLIENTE cuando no puede comer lo pautado:
// sin estas rutas la funcionalidad estaría escrita pero nadie la usaría.
router.getAsync("/food-exchanges/mine", auth(["user", "admin"]), controller.listForClient);
// Movimiento 5 Coach Pro — su reparto del día en raciones, con los grupos a
// los que apunta.
router.getAsync("/food-exchanges/my-plan", auth(["user", "admin"]), controller.getMyPlan);

// --- Lado profesional (montado bajo /trainer, ver routes/index.js) ---
router.getAsync("/food-exchanges", auth(["trainer"]), controller.listMine);
router.postAsync("/food-exchanges", auth(["trainer"]), controller.create);
router.putAsync("/food-exchanges/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/food-exchanges/:id", auth(["trainer"]), controller.remove);

module.exports = router;
