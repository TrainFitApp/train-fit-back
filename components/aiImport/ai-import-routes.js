const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./ai-import-controller");

const router = express.Router();

router.postAsync(
  "/interpret-excel",
  auth(["admin", "user"]),
  controller.interpretExcel
);

router.postAsync(
  "/create-table",
  auth(["admin", "user"]),
  controller.createTable
);

module.exports = router;
