const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-subscription-controller");

const router = express.Router();

router.getAsync("/subscription", auth(["trainer"]), controller.getMine);

module.exports = router;
