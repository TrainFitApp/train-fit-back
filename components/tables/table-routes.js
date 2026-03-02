const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./table-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getTables);
router.getAsync("/:id", auth(["admin", "user"]), controller.getTableById);
router.getAsync(
  "/share/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.copySharedTable
);
router.postAsync(
  "/search",
  auth(["admin", "user"]),
  controller.getSearchTables
);
router.postAsync("/", auth(["admin", "user"]), controller.createTable);
router.postAsync(
  "/:idUser",
  auth(["admin", "user"]),
  controller.createTableToUser
);
// router.postAsync("/migrate/newtable", controller.migrateTable);
router.putAsync("/", auth(["admin", "user"]), controller.updateTable);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteTable);
router.deleteAsync(
  "/:idTable/:idSplit",
  auth(["admin", "user"]),
  controller.deleteTableSplit
);

module.exports = router;
