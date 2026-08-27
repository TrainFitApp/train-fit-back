const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./coach-task-controller");

const router = express.Router();

// Montadas bajo /trainer (ver routes/index.js), como "coach-tasks" y no
// como "tasks": /trainer/tasks/mine y /trainer/tasks/:taskId/toggle YA
// existen y son los HÁBITOS DEL CLIENTE (ver trainerTasks/
// trainer-task-routes.js). Express las distinguiría sin problema por forma
// de ruta, pero dos recursos opuestos compartiendo prefijo es una trampa
// para el siguiente que lea el listado de rutas — el mismo problema de
// nombres que motivó una colección aparte.
//
// Sin :clientId en la URL: una tarea del profesional puede no ser de ningún
// cliente. Cuando SÍ lleva clientId (en el body), el controller comprueba la
// relación activa a mano — ver coach-task-controller.js#resolveClientId.
router.getAsync("/coach-tasks", auth(["trainer"]), controller.listMine);
router.postAsync("/coach-tasks", auth(["trainer"]), controller.create);
router.patchAsync("/coach-tasks/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/coach-tasks/:id", auth(["trainer"]), controller.remove);

module.exports = router;
