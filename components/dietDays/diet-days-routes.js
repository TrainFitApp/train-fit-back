const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-days-controller");

const router = express.Router();

// Movimiento 5 Coach Pro — la lista de la compra del PROPIO cliente. Va
// antes que "/" para que el router no la trate como un id (mismo criterio
// que el resto del proyecto: lo más específico primero).
//
// El cliente es quien va al supermercado, así que la ruta existe en los dos
// lados. La lógica está en un servicio puro compartido
// (shopping-list-service.js), no duplicada en cada controller.
router.getAsync("/shopping-list", auth(["admin", "user"]), controller.getMyShoppingList);
// Fases y semanas del cliente en un rango, para el
// slider de días de su pantalla de dieta.
router.getAsync("/timeline", auth(["admin", "user"]), controller.getMyDietTimeline);

// Los días del propio usuario en un rango (calendario y peso diario).
router.getAsync("/range", auth(["admin", "user"]), controller.getMyDietDaysInRange);
// Pin de la dieta.
router.putAsync("/pinned-note", auth(["admin", "user"]), controller.setPinnedNote);

// "El día de tal fecha" del usuario del token: la fecha es la clave del
// módulo (un día por usuario y fecha). Todas las escrituras aseguran el día
// de esa fecha dentro de la MISMA llamada (ver diet-days-controller.js), así
// que nunca pueden dejar dos DietDay con la misma fecha.
router.postAsync("/date/:date", auth(["admin", "user"]), controller.getDay);
router.deleteAsync("/date/:date", auth(["admin", "user"]), controller.deleteDay);
router.putAsync("/date/:date/notes", auth(["admin", "user"]), controller.setNotes);
router.putAsync("/date/:date/paste", auth(["admin", "user"]), controller.pasteDay);
router.postAsync(
  "/date/:date/meals/:mealIndex/customproducts",
  auth(["admin", "user"]),
  controller.addCustomProductToDay,
);

// El cliente elige, para una fecha concreta, cuál de los menús del plan le
// toca (p. ej. Entrenamiento/Descanso). Ownership resuelta contra
// req.user.id, nunca contra un DietDay._id suelto.
router.getAsync("/date/:date/menu", auth(["admin", "user"]), controller.getMenu);
router.putAsync("/date/:date/menu", auth(["admin", "user"]), controller.chooseMenu);
router.deleteAsync("/date/:date/menu", auth(["admin", "user"]), controller.leaveMenu);

module.exports = router;
