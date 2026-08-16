const express = require("@awaitjs/express");
const path = require("path");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./exercise-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

// "trainer" añadido a los dos de solo lectura/búsqueda — necesita listar el
// catálogo para el picker de "añadir ejercicio" al construir una rutina/
// plantilla (funcionalidad 5). El resto (crear/editar/archivar/favoritos/
// borrar) se queda igual, sin acceso de trainer — no es su catálogo.
router.getAsync("/", auth(["admin", "user", "trainer"]), controller.getExercises);
router.getAsync(
  "/code/:barcode",
  auth(["admin", "user"]),
  controller.getExerciseByCode
);
router.postAsync(
  "/:search",
  auth(["admin", "user", "trainer"]),
  controller.getSearchExercise
);
router.postAsync("/", auth(["admin", "user"]), controller.createExercise);
router.patchAsync("/:id", auth(["admin", "user"]), controller.updateExercise);
router.putAsync(
  "/archive",
  auth(["admin", "user"]),
  controller.archiveExercise
);
router.putAsync(
  "/favorite",
  auth(["admin", "user"]),
  controller.addExerciseToFavorites
);

// Servir helper de YouTube embed protegido (requiere admin o user)
router.getAsync("/youtube-embed", auth(["admin", "user"]), async (req, res) => {
  const filePath = path.join(__dirname, "../../youtube-embed.html");
  res.sendFile(filePath);
});
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteExercise);

module.exports = router;
