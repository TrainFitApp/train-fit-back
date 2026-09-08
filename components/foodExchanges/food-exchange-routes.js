const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./food-exchange-controller");

const router = express.Router();

// --- Lado cliente ---
// Declarada ANTES que "/food-exchanges/:id" del profesional: "my-plan" no es
// un ObjectId, pero el router prueba en orden y lo más específico va primero
// (mismo criterio que el resto del proyecto).
//
// Los intercambios los consulta el CLIENTE cuando no puede comer lo pautado:
// sin esta ruta la funcionalidad estaría escrita pero nadie la usaría. Una
// sola: su reparto del día en raciones y sus grupos van juntos, y hubo un
// "/food-exchanges/mine" aparte que no llegó a llamar nadie.
router.getAsync("/food-exchanges/my-plan", auth(["user", "admin"]), controller.getMyPlan);

// --- Lado profesional (montado bajo /trainer, ver routes/index.js) ---
router.getAsync("/food-exchanges", auth(["trainer"]), controller.listMine);
router.postAsync("/food-exchanges", auth(["trainer"]), controller.create);
router.putAsync("/food-exchanges/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/food-exchanges/:id", auth(["trainer"]), controller.remove);

module.exports = router;
