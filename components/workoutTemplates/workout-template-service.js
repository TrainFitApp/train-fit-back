const workoutTemplateDao = require("./workout-template-dao");
const workoutService = require("../workouts/workout-service");
const { badRequest, forbidden, notFound } = require("../util/http-error");

// Plantillas de sesión de la biblioteca del profesional
// (workout-template-schema.js), siempre filtradas por él.

module.exports = {
  create: (trainerId, data) => workoutTemplateDao.create(trainerId, data),
  listByTrainer: (trainerId) => workoutTemplateDao.listByTrainer(trainerId),
  findOwned: (trainerId, id) => workoutTemplateDao.findOwnedByTrainer(trainerId, id),
  update: (trainerId, id, patch) => workoutTemplateDao.update(trainerId, id, patch),

  // true si existía y era suya.
  async remove(trainerId, id) {
    return (await workoutTemplateDao.delete(trainerId, id)).deletedCount > 0;
  },

  // La plantilla entra como una fila nueva al final de todos los microciclos
  // de la rutina del cliente, por la misma vía que crear un entrenamiento a
  // mano (bloques nuevos compartidos por toda la fila, ejercicios y series
  // copiados en cada microciclo). Devuelve los microciclos de la rutina.
  async applyToTable(template, tableId, clientId) {
    const table = await workoutTemplateDao.findTableForApply(tableId);
    if (!table) throw notFound("Rutina no encontrada", "TABLE_NOT_FOUND");
    if (String(table.userId) !== String(clientId)) {
      throw forbidden("La rutina no pertenece a este cliente", "TABLE_FORBIDDEN");
    }
    if (!(table.splits || []).length) {
      throw badRequest("La rutina no tiene microciclos", "TABLE_WITHOUT_SPLITS");
    }
    return workoutService.addWorkoutsToSplits(table._id, workoutTemplateDao.workoutDataFromTemplate(template));
  },

  // Una sesión ya construida se guarda como plantilla: solo si el profesional
  // tiene acceso a la rutina de la que cuelga.
  async saveWorkoutAsTemplate(trainerId, workoutId, fields) {
    const workout = await workoutTemplateDao.findWorkoutForTemplateSource(workoutId);
    if (!workout) throw notFound("Entrenamiento no encontrado");
    const owningTable = await workoutTemplateDao.findWorkoutOwnerTable(workoutId);
    if (!(await workoutTemplateDao.canTrainerAccessTable(trainerId, owningTable))) {
      throw forbidden("No tienes acceso a este entrenamiento");
    }
    // Las indicaciones de la sesión viajan con ella salvo que lleguen otras.
    return workoutTemplateDao.create(trainerId, {
      notes: workout.notes,
      ...fields,
      blocks: workoutTemplateDao.buildBlockFromWorkout(workout),
    });
  },
};
