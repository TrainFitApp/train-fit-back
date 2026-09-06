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

router.getAsync("/", auth(["admin", "user"]), controller.getDietDays);
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
router.postAsync("/", auth(["admin", "user"]), controller.createDietDay);
router.postAsync(
  "/create/on/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createDayWeightOnNewDietDay,
);
router.postAsync(
  "/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomProductOnNewDietDay,
);
router.postAsync(
  "/create/recipe/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomRecipeOnNewDietDay,
);
router.postAsync(
  "/recipe/own/:idUser",
  auth(["admin", "user"]),
  controller.createOwnCustomRecipeOnNewDietDay,
);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateDietDay);
router.putAsync(
  "/:idDietDay/:idMeal",
  auth(["admin", "user"]),
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
router.deleteAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.deleteDietDayMeal,
);

// Fase 9 — el cliente elige, para una fecha concreta, cuál de los menús de
// un plan "mode: choice" le toca (p. ej. Entrenamiento/Descanso). Ownership
// resuelta contra req.user.id, nunca contra un DietDay._id suelto.
router.getAsync("/date/:date/day-type", auth(["admin", "user"]), controller.getDayType);
router.putAsync("/date/:date/day-type", auth(["admin", "user"]), controller.chooseDayType);

module.exports = router;
