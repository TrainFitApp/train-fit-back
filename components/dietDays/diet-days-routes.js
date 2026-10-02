const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-days-controller");
const ROLES = require("../users/util/roles");

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

// Listado global (find({}) paginado, días de todos los usuarios): solo admin.
router.getAsync("/", auth(["admin"]), controller.getDietDays);
// Las rutas que llevaban el id de la Diet en la URL (:id / :dietInUseId /
// :idDiet) lo conservan a propósito aunque ya no se use: así las apps ya
// instaladas siguen funcionando tras el refactor. El dueño sale del token.
router.postAsync(
  "/between/:id",
  auth(["admin", "user"]),
  controller.getDietDaysBetweenDatesByUser,
);
router.postAsync(
  "/date/:id",
  auth(["admin", "user"]),
  controller.getDietDayByIdDietAndDate,
);
// Todas las rutas de "crear algo en un día" aseguran el día de esa fecha
// dentro de la MISMA llamada (ver diet-days-controller.js): nunca crean un
// día a ciegas, así que no pueden dejar dos DietDay con la misma fecha.
router.postAsync("/", auth(["admin", "user"]), controller.createDietDay);
router.postAsync(
  "/create/on/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createDayWeightOnNewDietDay,
);
router.postAsync(
  "/create/recipe/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomRecipeOnNewDietDay,
);
router.postAsync(
  "/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomProductOnNewDietDay,
);
// La nota del día por fecha (el :id de la variante de abajo se ignora: el día
// se resuelve por dueño + fecha). Lo específico primero.
router.putAsync("/date/:date", auth(["admin", "user"]), controller.updateDietDay);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateDietDay);
// Engancha una comida suelta a un día por ids, sin comprobar dueños. Ninguna
// app la usa: solo admin (con "user" metía comidas en el día de cualquiera).
router.putAsync(
  "/:idDietDay/:idMeal",
  auth(["admin"]),
  controller.addDietDayMeal,
);
router.putAsync(
  "/copy/paste/:id",
  auth(["admin", "user"]),
  controller.pasteDietDayByUser,
);
router.deleteAsync(
  "/:idDiet/:idDietDay",
  auth(["admin", "user"]),
  controller.deleteDietDay,
);

// El cliente elige, para una fecha concreta, cuál de los menús del plan le
// toca (p. ej. Entrenamiento/Descanso). Ownership resuelta contra
// req.user.id, nunca contra un DietDay._id suelto.
router.getAsync("/date/:date/menu", auth(["admin", "user"]), controller.getMenu);
router.putAsync("/date/:date/menu", auth(["admin", "user"]), controller.chooseMenu);
router.deleteAsync("/date/:date/menu", auth(["admin", "user"]), controller.leaveMenu);

module.exports = router;
