const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-snippet-controller");

const router = express.Router();

// --- Biblioteca de snippets de comida del profesional (TAREA5, Fase C) ---
router.postAsync("/trainer/meal-snippets", auth(["trainer"]), controller.createSnippet);
router.getAsync("/trainer/meal-snippets", auth(["trainer"]), controller.listSnippets);
router.putAsync("/trainer/meal-snippets/:id", auth(["trainer"]), controller.renameSnippet);
router.deleteAsync("/trainer/meal-snippets/:id", auth(["trainer"]), controller.deleteSnippet);

module.exports = router;
