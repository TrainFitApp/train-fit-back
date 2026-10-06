const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./table-controller");

const router = express.Router();

// Listar tablas: GET /tables?own=true&page=0&limit=5
router.getAsync("/", auth(["admin", "user", "trainer"]), controller.getTables);

// Obtener tabla por ID
router.getAsync("/:id", auth(["admin", "user", "trainer"]), controller.getTableById);

// Buscar tablas (públicas o propias)
router.postAsync("/search", auth(["admin", "user", "trainer"]), controller.getSearchTables);

// Crear plantilla pública (admin)
router.postAsync("/", auth(["admin"]), controller.createTable);

// Crear tabla predeterminada sin userId (admin)
router.postAsync("/default", auth(["admin"]), controller.createDefaultTable);

// Crear tabla propia del usuario
router.postAsync("/user/:idUser", auth(["admin", "user", "trainer"]), controller.createTableToUser);

// Copiar plantilla pública -> usuario
router.postAsync("/copy/:idTable", auth(["admin", "user", "trainer"]), controller.copyTable);

// Duplicar tabla propia
router.postAsync("/duplicate/:idTable", auth(["admin", "user", "trainer"]), controller.duplicateTable);

// Actualizar nombre
router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateTable);

// Borrar una tabla: el acceso se comprueba contra su dueño real.
router.deleteAsync("/:idTable", auth(["admin", "user", "trainer"]), controller.deleteTable);

// All-time exercise history stats
router.getAsync(
  "/exercise-history/stats",
  auth(["admin", "user", "trainer"]),
  controller.getExerciseHistoryStats
);

module.exports = router;