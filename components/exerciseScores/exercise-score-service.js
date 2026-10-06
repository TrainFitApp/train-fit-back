const exerciseScoreDao = require("./exercise-score-dao");
const exerciseDao = require("../exercises/exercise-dao");
const workoutDao = require("../workouts/workout-dao");
const tableAccess = require("../tables/table-access");
const { buildSessionLoad, estimateSessionSeconds } = require("./session-load-service");
const { getDefaultScoreForName } = require("./exercise-score-defaults");
const { forbidden, notFound } = require("../util/http-error");

// Puntuaciones de ejercicios del profesional (exercise-score-schema.js) y la
// carga de una sesión calculada con ellas.

module.exports = {
  /**
   * Sugerencia inicial para el editor cuando aún no ha puntuado el ejercicio
   * (por patrón de movimiento, emparejado por el NOMBRE, nunca por sus
   * músculos: exercise-score-defaults.js). No escribe nada. null si ningún
   * patrón encaja.
   */
  async defaultFor(exerciseId) {
    const exercise = await exerciseDao.getExercise(exerciseId);
    if (!exercise) throw notFound("Ejercicio no encontrado");
    return getDefaultScoreForName(exercise.name);
  },

  listForTrainer: (trainerId) => exerciseScoreDao.listForTrainer(trainerId),
  upsert: (trainerId, exerciseId, data) => exerciseScoreDao.upsert(trainerId, exerciseId, data),
  remove: (trainerId, exerciseId) => exerciseScoreDao.remove(trainerId, exerciseId),
  bulkUpsert: (trainerId, entries) => exerciseScoreDao.bulkUpsert(trainerId, entries),

  /**
   * El reparto de UNA sesión y su duración estimada, con las puntuaciones de
   * este profesional. `canAccessOwner(userId)`: si quien pide puede ver la
   * rutina de ese usuario (table-access.js): `estimatedSeconds` usa los
   * descansos REALES de la sesión, que son datos del cliente.
   */
  async sessionLoad(trainerId, workoutId, canAccessOwner) {
    const workout = await workoutDao.findWithExercises(workoutId);
    if (!workout) throw notFound("Sesión no encontrada");
    const table = await tableAccess.findTableOwningWorkout(workoutId);
    if (!table || !(await canAccessOwner(table.userId))) throw forbidden("No tienes acceso a esta sesión");

    const customExercises = workout.exercises || [];
    const exerciseIds = customExercises.map((item) => item?.exercise?._id || item?.exercise).filter(Boolean);
    const scores = await exerciseScoreDao.listForExercises(trainerId, exerciseIds);
    const scoresById = new Map(scores.map((score) => [String(score.exerciseId), score]));
    return {
      ...buildSessionLoad(customExercises, scoresById),
      estimatedSeconds: estimateSessionSeconds(customExercises, scoresById),
    };
  },
};
