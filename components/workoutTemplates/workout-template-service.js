const workoutTemplateDao = require("./workout-template-dao");
const { forbidden, notFound } = require("../util/http-error");

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

  // Copia la plantilla como sesión nueva del microciclo del cliente. Devuelve
  // los microciclos de la rutina (mismo shape que el resto de altas).
  applyToTable: (template, tableId, clientId) => workoutTemplateDao.applyToTable(template, tableId, clientId),

  // Una sesión ya construida se guarda como plantilla: solo si el profesional
  // tiene acceso a la rutina de la que cuelga.
  async saveWorkoutAsTemplate(trainerId, workoutId, fields) {
    const workout = await workoutTemplateDao.findWorkoutForTemplateSource(workoutId);
    if (!workout) throw notFound("Entrenamiento no encontrado");
    const owningTable = await workoutTemplateDao.findWorkoutOwnerTable(workoutId);
    if (!(await workoutTemplateDao.canTrainerAccessTable(trainerId, owningTable))) {
      throw forbidden("No tienes acceso a este entrenamiento");
    }
    return workoutTemplateDao.create(trainerId, { ...fields, blocks: workoutTemplateDao.buildBlockFromWorkout(workout) });
  },
};
