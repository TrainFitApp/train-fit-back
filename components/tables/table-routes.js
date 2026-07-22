const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./table-controller");

const router = express.Router();

// Listar tablas: GET /tables?own=true&page=0&limit=5
router.getAsync("/", auth(["admin", "user"]), controller.getTables);

// Obtener tabla por ID
router.getAsync("/:id", auth(["admin", "user"]), controller.getTableById);

// Buscar tablas (públicas o propias)
router.postAsync("/search", auth(["admin", "user"]), controller.getSearchTables);

// Crear plantilla pública (admin)
router.postAsync("/", auth(["admin"]), controller.createTable);

// Crear tabla propia del usuario
router.postAsync("/user/:idUser", auth(["admin", "user"]), controller.createTableToUser);

// Copiar plantilla pública -> usuario
router.postAsync("/copy/:idTable", auth(["admin", "user"]), controller.copyTable);

// Duplicar tabla propia
router.postAsync("/duplicate/:idTable", auth(["admin", "user"]), controller.duplicateTable);

// Copiar tabla compartida (genera link público)
router.getAsync(
  "/share/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.copySharedTable
);

// Actualizar nombre
router.putAsync("/", auth(["admin", "user"]), controller.updateTable);

// Borrar tabla propia (filtra por userId en DAO)
router.deleteAsync("/:idUser/:idTable", auth(["admin", "user"]), controller.deleteTable);

// Split management
router.deleteAsync(
  "/:idTable/:idSplit",
  auth(["admin", "user"]),
  controller.deleteTableSplit
);

// All-time exercise history stats
router.getAsync(
  "/exercise-history/stats",
  auth(["admin", "user"]),
  controller.getExerciseHistoryStats
);

module.exports = router;