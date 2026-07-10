const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./table-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

// router.getAsync("/", controller.getTables);
router.getAsync(
  "/copy/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.copyTable
);
router.getAsync(
  "/copy/own/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.duplicateTable
);
// router.getAsync("/:id", controller.getTableById);
// router.postAsync("/search", controller.getSearchTables);
// router.postAsync("/", controller.createTable);
router.postAsync(
  "/:idUser",
  auth(["admin", "user"]),
  controller.createTableToUser
);
// router.putAsync("/", controller.updateTable);
router.deleteAsync(
  "/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.deleteTable
);
// router.deleteAsync("/:idTable/:idSplit", controller.deleteTableSplit);

module.exports = router;
