const express = require("@awaitjs/express");
const path = require("path");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./exercise-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

// Replanteamiento MVP (rutinas) — catálogo global de ejercicios, sin dueño
// (a diferencia de Table/Split/Workout/...), igual que ya ocurría con
// ProductAPIService.searchProduct para el buscador de alimentos del
// entrenador: no hace falta comprobación de relación, solo estar autenticado.
router.getAsync("/", auth(["admin", "user", "trainer"]), controller.getExercises);
router.getAsync(
  "/code/:barcode",
  auth(["admin", "user", "trainer"]),
  controller.getExerciseByCode
);
router.postAsync(
  "/:search",
  auth(["admin", "user", "trainer"]),
  controller.getSearchExercise
);
// El profesional crea/edita/borra ejercicios propios desde Biblioteca →
// Ejercicios. Hasta ahora solo podía hacerlo de rebote desde el Planner
// (POST /workouts/add-data-exercise/:idWorkout crea el Exercise como efecto
// secundario), porque estas tres rutas no tenían "trainer" en el allowlist.
// Crear y borrar ya comprueban dueño/límite en el controller; update lo
// comprueba desde ahora (antes no validaba nada, ver updateExercise).
router.postAsync("/", auth(["admin", "user", "trainer"]), controller.createExercise);
router.patchAsync("/:id", auth(["admin", "user", "trainer"]), controller.updateExercise);
router.putAsync(
  "/archive",
  auth(["admin", "user"]),
  controller.archiveExercise
);
// "trainer": Configurar ejercicio (planner) marca favoritos del propio
// entrenador; sin el rol daba 403 y el botón no hacía nada.
router.putAsync(
  "/favorite",
  auth(["admin", "user", "trainer"]),
  controller.addExerciseToFavorites
);

// Servir helper de YouTube embed protegido (requiere admin o user)
router.getAsync("/youtube-embed", auth(["admin", "user"]), async (req, res) => {
  const filePath = path.join(__dirname, "../../youtube-embed.html");
  res.sendFile(filePath);
});
router.deleteAsync("/:id", auth(["admin", "user", "trainer"]), controller.deleteExercise);

module.exports = router;
