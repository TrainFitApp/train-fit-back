const workoutTemplateDao = require("./workout-template-dao");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const tableSchema = require("../tables/table-schema");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  // "Guardar como plantilla": clona en profundidad un Workout real de un
  // cliente (no se toca el original) y lo marca como plantilla del trainer
  // (trainerId set) — sin crear ninguna colección nueva, ver addendum de la
  // funcionalidad 5.
  async createFromClient(trainerId, { clientId, workoutId, name, tags, equipment }) {
    if (!clientId || !workoutId || !name) {
      throw makeError(400, "MISSING_FIELDS", "clientId, workoutId y name son requeridos");
    }

    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "training");

    const owned = await workoutTemplateDao.findWorkoutOwnedByClient(clientId, workoutId);
    if (!owned) {
      throw makeError(404, "WORKOUT_NOT_FOUND", "Ese workout no pertenece a este cliente");
    }

    const clonedId = await workoutTemplateDao.cloneWorkoutDeep(workoutId, []);

    const update = { name, trainerId };
    if (tags?.length) update.tags = tags;
    if (equipment?.length) update.equipment = equipment;

    return workoutTemplateDao
      .findById(clonedId)
      .then((doc) => Object.assign(doc, update).save());
  },

  // Vista de solo lectura de la rutina activa de un cliente — necesaria para
  // poder elegir un workoutId real al "guardar como plantilla" (ver hueco
  // de alcance anotado en docs/trainfit-trainers/06-estado-actual.md, sesión 7).
  async getClientActiveTable(trainerId, clientId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "training");

    const table = await workoutTemplateDao.getClientActiveTable(clientId);
    if (!table) {
      throw makeError(404, "NO_ACTIVE_TABLE", "El cliente no tiene ninguna rutina en uso");
    }
    return table;
  },

  async listMyTemplates(trainerId, search) {
    return workoutTemplateDao.findTemplatesByTrainer(trainerId, search);
  },

  async getMyTemplate(trainerId, templateId) {
    const template = await workoutTemplateDao.findById(templateId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }
    return template;
  },

  async deleteMyTemplate(trainerId, templateId) {
    const template = await workoutTemplateDao.findById(templateId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }
    return workoutTemplateDao.deleteTemplate(templateId);
  },

  // "Aplicar plantilla": añade una fila nueva (este día) a la Table activa
  // del cliente — mismo patrón que addWorkoutsToSplits() en
  // components/workouts/workout-dao.js: una copia distinta por cada split
  // existente, todas en la misma posición (al final) de cada split, porque
  // hoy no hay ningún id compartido entre "la misma fila" en distintas
  // semanas — solo el índice en el array cuenta.
  async applyToClient(trainerId, clientId, templateId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "training");

    const template = await workoutTemplateDao.findById(templateId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }

    const table = await workoutTemplateDao.getClientActiveTable(clientId);
    if (!table) {
      throw makeError(409, "NO_ACTIVE_TABLE", "El cliente no tiene ninguna rutina en uso");
    }
    if (!table.splits || table.splits.length === 0) {
      throw makeError(409, "TABLE_HAS_NO_SPLITS", "La rutina del cliente no tiene semanas todavía");
    }

    const splitIds = table.splits.map((split) => split._id);
    const newWorkoutIds = await Promise.all(
      splitIds.map(() => workoutTemplateDao.cloneWorkoutDeep(templateId, workoutTemplateDao.TEMPLATE_FIELDS))
    );

    await workoutTemplateDao.appendWorkoutRowToAllSplits(splitIds, newWorkoutIds);
    await workoutTemplateDao.markTableAssignedByTrainer(table._id, trainerId);

    notificationService.notifyClient(clientId, trainerId, "routine_assigned", "Table", table._id);

    return tableSchema.findById(table._id);
  },

  // --- Builder: crear/editar la rutina de un cliente ---

  async createClientTable(trainerId, clientId, name) {
    if (!name) throw makeError(400, "MISSING_FIELDS", "name es requerido");
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "training");
    return workoutTemplateDao.createTableForClient(clientId, trainerId, name);
  },

  async addSplit(trainerId, clientId, tableId, name) {
    if (!name) throw makeError(400, "MISSING_FIELDS", "name es requerido");
    await this._requireOwnedTable(trainerId, clientId, tableId);
    return workoutTemplateDao.addSplitToTable(tableId, name);
  },

  async addWorkoutRow(trainerId, clientId, tableId, name) {
    if (!name) throw makeError(400, "MISSING_FIELDS", "name es requerido");
    await this._requireOwnedTable(trainerId, clientId, tableId);
    return workoutTemplateDao.addWorkoutRow(tableId, name);
  },

  async renameWorkoutRow(trainerId, clientId, tableId, workoutId, name) {
    if (!name) throw makeError(400, "MISSING_FIELDS", "name es requerido");
    await this._requireOwnedTable(trainerId, clientId, tableId);
    return workoutTemplateDao.renameWorkoutRow(tableId, workoutId, name);
  },

  async reorderWorkoutRows(trainerId, clientId, tableId, workoutIdsOrder) {
    if (!Array.isArray(workoutIdsOrder) || !workoutIdsOrder.length) {
      throw makeError(400, "MISSING_FIELDS", "workoutIdsOrder es requerido");
    }
    await this._requireOwnedTable(trainerId, clientId, tableId);
    return workoutTemplateDao.reorderWorkoutRows(tableId, workoutIdsOrder);
  },

  async deleteWorkoutRow(trainerId, clientId, tableId, workoutId) {
    await this._requireOwnedTable(trainerId, clientId, tableId);
    return workoutTemplateDao.deleteWorkoutRow(tableId, workoutId);
  },

  // --- Builder: ejercicios y series (contexto cliente o plantilla propia) ---
  // `context` = { clientId } (edita el workout de un cliente) o
  // `context` = { templateId } (edita una plantilla propia, workoutId===templateId).

  async addExercise(trainerId, context, workoutId, { exerciseId, notes }) {
    if (!exerciseId) throw makeError(400, "MISSING_FIELDS", "exerciseId es requerido");
    await this._requireOwnedWorkout(trainerId, context, workoutId);
    return workoutTemplateDao.addExerciseToWorkout(workoutId, { exerciseId, notes });
  },

  async deleteExercise(trainerId, context, workoutId, customExerciseId) {
    await this._requireOwnedWorkout(trainerId, context, workoutId);
    const belongs = await workoutTemplateDao.workoutHasExercise(workoutId, customExerciseId);
    if (!belongs) throw makeError(404, "EXERCISE_NOT_FOUND", "Ese ejercicio no pertenece a este workout");
    return workoutTemplateDao.deleteExerciseFromWorkout(workoutId, customExerciseId);
  },

  async addSet(trainerId, context, workoutId, customExerciseId, setFields) {
    await this._requireOwnedWorkout(trainerId, context, workoutId);
    const belongs = await workoutTemplateDao.workoutHasExercise(workoutId, customExerciseId);
    if (!belongs) throw makeError(404, "EXERCISE_NOT_FOUND", "Ese ejercicio no pertenece a este workout");
    return workoutTemplateDao.addSetToExercise(customExerciseId, setFields);
  },

  async updateSet(trainerId, context, workoutId, customExerciseId, setId, fields) {
    await this._requireOwnedWorkout(trainerId, context, workoutId);
    const belongsExercise = await workoutTemplateDao.workoutHasExercise(workoutId, customExerciseId);
    if (!belongsExercise) throw makeError(404, "EXERCISE_NOT_FOUND", "Ese ejercicio no pertenece a este workout");
    const belongsSet = await workoutTemplateDao.exerciseHasSet(customExerciseId, setId);
    if (!belongsSet) throw makeError(404, "SET_NOT_FOUND", "Esa serie no pertenece a ese ejercicio");
    return workoutTemplateDao.updateSet(setId, fields);
  },

  async deleteSet(trainerId, context, workoutId, customExerciseId, setId) {
    await this._requireOwnedWorkout(trainerId, context, workoutId);
    const belongsExercise = await workoutTemplateDao.workoutHasExercise(workoutId, customExerciseId);
    if (!belongsExercise) throw makeError(404, "EXERCISE_NOT_FOUND", "Ese ejercicio no pertenece a este workout");
    const belongsSet = await workoutTemplateDao.exerciseHasSet(customExerciseId, setId);
    if (!belongsSet) throw makeError(404, "SET_NOT_FOUND", "Esa serie no pertenece a ese ejercicio");
    return workoutTemplateDao.deleteSetFromExercise(customExerciseId, setId);
  },

  // --- Builder: plantilla desde cero ---

  async createTemplateFromScratch(trainerId, { name, tags, equipment }) {
    if (!name) throw makeError(400, "MISSING_FIELDS", "name es requerido");
    return workoutTemplateDao.createTemplateFromScratch(trainerId, { name, tags, equipment });
  },

  async updateTemplateMetadata(trainerId, templateId, fields) {
    const template = await workoutTemplateDao.findById(templateId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }
    return workoutTemplateDao.updateTemplateMetadata(templateId, fields);
  },

  // --- privados ---

  // Cualquier mutación del builder sobre la tabla de un cliente cuenta como
  // "un trainer ha tocado esta tabla" — no solo "aplicar plantilla" (bug
  // real encontrado en revisión: antes solo applyToClient marcaba
  // assignedByTrainerId, así que editar la rutina a mano vía el builder no
  // dejaba rastro de qué trainer la tocó).
  async _requireOwnedTable(trainerId, clientId, tableId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "training");
    const table = await workoutTemplateDao.findTableOwnedByClient(clientId, tableId);
    if (!table) throw makeError(404, "TABLE_NOT_FOUND", "Esa tabla no pertenece a este cliente");
    if (!table.assignedByTrainerId) {
      await workoutTemplateDao.markTableAssignedByTrainer(tableId, trainerId);
    }
    return table;
  },

  async _requireOwnedWorkout(trainerId, context, workoutId) {
    if (context.clientId) {
      await trainerClientAccess.requireActiveRelation(trainerId, context.clientId, "training");
      const owned = await workoutTemplateDao.findWorkoutOwnedByClient(context.clientId, workoutId);
      if (!owned) throw makeError(404, "WORKOUT_NOT_FOUND", "Ese workout no pertenece a este cliente");
      return;
    }
    const template = await workoutTemplateDao.findById(workoutId);
    if (!template || String(template.trainerId) !== String(trainerId)) {
      throw makeError(404, "TEMPLATE_NOT_FOUND", "Plantilla no encontrada");
    }
  },
};
