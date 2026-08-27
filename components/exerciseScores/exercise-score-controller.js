const mongoose = require("mongoose");
const exerciseScoreDao = require("./exercise-score-dao");
const {
  SCORE_MUSCLES,
  SCORE_JOINTS,
  SCORE_MIN,
  SCORE_MAX,
  MUSCLE_SCORE_ANCHORS,
  JOINT_SCORE_ANCHORS,
  sanitizeMuscleScores,
  sanitizeJointScores,
} = require("./exercise-score-catalog");
const { buildSessionLoad, estimateSessionSeconds } = require("./session-load-service");
const workoutSchema = require("../workouts/workout-schema");

// Tope de la carga masiva. 500 cubre de sobra un catálogo de ejercicios
// completo; sin tope, una petición podría intentar escribir cien mil
// documentos de una vez.
const MAX_BULK_ENTRIES = 500;

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function toSecondsOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 600 ? seconds : null;
}

module.exports = {
  // El vocabulario lo decide el backend, igual que en dolor, agujetas y
  // reglas: así es imposible que la interfaz ofrezca un músculo o una
  // articulación que el validador no conoce.
  async getCatalog(_req, res) {
    return res.send({
      muscles: SCORE_MUSCLES,
      joints: SCORE_JOINTS,
      min: SCORE_MIN,
      max: SCORE_MAX,
      muscleAnchors: MUSCLE_SCORE_ANCHORS,
      jointAnchors: JOINT_SCORE_ANCHORS,
    });
  },

  async listMine(req, res) {
    const scores = await exerciseScoreDao.listForTrainer(req.auth.userId);
    return res.send(scores);
  },

  async upsert(req, res) {
    const exerciseId = req.params.exerciseId;
    if (!isValidObjectId(exerciseId)) {
      return res.status(400).send({ message: "Ejercicio no válido" });
    }

    const score = await exerciseScoreDao.upsert(req.auth.userId, exerciseId, {
      muscleScores: sanitizeMuscleScores(req.body?.muscleScores),
      jointScores: sanitizeJointScores(req.body?.jointScores),
      secondsPerSet: toSecondsOrNull(req.body?.secondsPerSet),
    });
    return res.send(score);
  },

  async remove(req, res) {
    await exerciseScoreDao.remove(req.auth.userId, req.params.exerciseId);
    return res.sendStatus(204);
  },

  /**
   * PUT /trainer/exercise-scores/bulk — Movimiento 6 Coach Pro.
   *
   * Puntuar 200 ejercicios de uno en uno es lo que hace que nadie lo haga
   * nunca. Aquí entran de golpe, tal y como el entrenador ya los tiene en su
   * hoja de cálculo.
   *
   * Las filas mal formadas se DESCARTAN y se cuentan, no tumban la petición:
   * subir 200 y perderlas todas por un id mal escrito sería el peor
   * resultado posible. La respuesta dice cuántas entraron y cuántas no.
   */
  async bulkUpsert(req, res) {
    const rows = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!rows.length) {
      return res.status(400).send({ message: "No hay nada que guardar" });
    }
    if (rows.length > MAX_BULK_ENTRIES) {
      return res.status(400).send({
        message: `Como mucho ${MAX_BULK_ENTRIES} ejercicios por carga`,
        code: "SCORES_BULK_TOO_LARGE",
      });
    }

    const valid = [];
    const skipped = [];
    const seen = new Set();

    for (const row of rows) {
      const exerciseId = row?.exerciseId;
      if (!isValidObjectId(exerciseId)) {
        skipped.push({ exerciseId: exerciseId || null, reason: "Ejercicio no válido" });
        continue;
      }
      // Un ejercicio repetido en la misma carga se queda con su ÚLTIMA fila,
      // no genera dos escrituras que se pisan en orden indeterminado.
      const key = String(exerciseId);
      if (seen.has(key)) {
        const index = valid.findIndex((entry) => String(entry.exerciseId) === key);
        if (index >= 0) valid.splice(index, 1);
      }
      seen.add(key);

      valid.push({
        exerciseId,
        muscleScores: sanitizeMuscleScores(row?.muscleScores),
        jointScores: sanitizeJointScores(row?.jointScores),
        secondsPerSet: toSecondsOrNull(row?.secondsPerSet),
      });
    }

    if (!valid.length) {
      return res.status(400).send({
        message: "Ninguna fila era válida",
        code: "SCORES_BULK_ALL_INVALID",
        skipped,
      });
    }

    const result = await exerciseScoreDao.bulkUpsert(req.auth.userId, valid);
    return res.send({ ...result, saved: valid.length, skipped });
  },

  /**
   * GET /trainer/exercise-scores/session/:workoutId — el reparto de UNA
   * sesión, para el panel del planificador.
   *
   * Se calcula en el backend y no en el navegador porque necesita las
   * puntuaciones del entrenador, y bajarse las 200 del catálogo para sumar
   * las 6 de la sesión abierta sería mover mucho para calcular poco.
   *
   * No comprueba propiedad del workout: solo devuelve agregados de las
   * puntuaciones DEL PROPIO entrenador que consulta (los ejercicios que no
   * ha puntuado no aportan nada), así que no expone datos de nadie más.
   */
  async getSessionLoad(req, res) {
    const workout = await workoutSchema.findById(req.params.workoutId).lean();
    if (!workout) return res.status(404).send({ message: "Sesión no encontrada" });

    const customExercises = workout.exercises || [];
    const exerciseIds = customExercises
      .map((customExercise) => customExercise?.exercise?._id || customExercise?.exercise)
      .filter(Boolean);

    const scores = await exerciseScoreDao.listForExercises(req.auth.userId, exerciseIds);
    const scoresById = new Map(scores.map((score) => [String(score.exerciseId), score]));

    return res.send({
      ...buildSessionLoad(customExercises, scoresById),
      estimatedSeconds: estimateSessionSeconds(customExercises, scoresById),
    });
  },
};
