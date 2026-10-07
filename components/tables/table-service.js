const tableDao = require("./table-dao");
const tableUtil = require("./table-util");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const routineAssignmentService = require("../routineAssignments/routine-assignment-service");
const { badRequest } = require("../util/http-error");

module.exports = {
  // Trainer viendo la ficha de un cliente concreto — ver comentario de
  // buildAssignedByTrainerMatch en table-dao.js.
  async getTablesAssignedByTrainer(clientId, trainerId, page, limit) {
    return tableDao.getTablesAssignedByTrainer(clientId, trainerId, page, limit);
  },

  async getTables(page, limit, own = false, idUser = null, defaultOnly = false) {
    if (own && idUser) {
      return tableDao.getTables(page, limit, true, idUser);
    }
    if (defaultOnly && idUser) {
      return tableDao.getTables(page, limit, false, idUser, true);
    }
    // TASK-009 — antes se perdía idUser aquí: el caso "propias + públicas"
    // (getAvailableTemplates, own=false con idUser real) caía a
    // tableDao.getTables(page, limit) sin reenviar idUser, así que el $or
    // de la rama final del DAO evaluaba ObjectId(null) — nunca matchea
    // ninguna tabla real, el entrenador nunca veía sus propias rutinas como
    // plantilla disponible. El caso público puro (idUser ya null desde el
    // controller) sigue comportándose igual: ObjectId(null) tampoco matchea
    // nada, el $or degrada a solo "públicas", sin cambio de comportamiento.
    return tableDao.getTables(page, limit, false, idUser);
  },

  findSummary: (id) => tableDao.findSummary(id),
  // Series hechas y adherencia por sesión del usuario en [start, end] (instantes).
  listCompletedSetsForUser: (userId, start, end) => tableDao.listCompletedSetsForUser(userId, start, end),
  listSessionAdherenceForUser: (userId, start, end) => tableDao.listSessionAdherenceForUser(userId, start, end),
  listIdsAssignedBy: (clientId, trainerIds) => tableDao.listIdsAssignedBy(clientId, trainerIds),

  async getTableById(id) {
    return tableDao.getTableById(id);
  },

  async copyTable(idUser, idTable) {
    return tableDao.copyTable(idUser, idTable);
  },

  async duplicateTable(idUser, idTable) {
    return tableDao.duplicateTable(idUser, idTable);
  },

  async getSearchTables(page, limit, search, isOwn, idUser, defaultOnly = false) {
    return tableDao.getSearchTables(page, limit, search, isOwn, idUser, defaultOnly);
  },

  async createTable(table) {
    return tableDao.createTable(table);
  },

  async createDefaultTable(name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTable(standardTable);
  },

  async createTableToUser(idUser, name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableToUser(idUser, standardTable);
  },

  async updateTable(id, name, userId, adminMode = false) {
    return tableDao.updateTable(id, name, userId, adminMode);
  },

  // Antes de borrar una rutina, fuera sus fases (si regía hoy, vuelve a regir
  // la anterior: la rutina en uso se calcula, routine-in-use.js), y si era la
  // elegida, fuera la elección.
  async deleteTable(idUser, idTable, adminMode = false) {
    await routineAssignmentService.removeAssignmentsForTable(idUser, idTable);
    const result = await tableDao.deleteTable(idUser, idTable, adminMode);
    if (result.deletedCount > 0 && idUser) {
      await tableDao.clearTableInUseIfMatches(idUser, idTable);
    }
    return result;
  },

  async countUserTables(userId) {
    return tableDao.countUserTables(userId);
  },

  // MVP-trainers D10: cuenta EFECTIVA a usar contra el límite FREE de
  // rutinas propias. Si el cliente tiene AHORA una relación "training"
  // activa, excluye las asignadas por el profesional (exentas mientras dure
  // la relación); si no, cuenta todas (la exención revierte de inmediato al
  // terminar la relación, sin periodo de gracia — ver F14, F08).
  async countEffectiveUserTables(userId) {
    const hasActiveTraining = await trainerClientDao.hasActiveTrainer(userId, "training");
    return hasActiveTraining
      ? tableDao.countOwnUserTables(userId)
      : tableDao.countUserTables(userId);
  },

  async getExerciseHistoryStats(userId, exerciseId, exerciseName) {
    return tableDao.getExerciseHistoryStats(userId, exerciseId, exerciseName);
  },

  // MVP-trainers F11 — Flujo A: crear rutina nueva para el cliente.
  async assignNewRoutineToClient(clientId, name, trainerId) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableForClient(clientId, standardTable, trainerId);
  },

  // MVP-trainers F11 — Flujo B: duplicar una plantilla hacia el cliente.
  // La plantilla origen debe ser pública (sin userId) o propia del
  // profesional — nunca de otro cliente suyo (ver F11 punto 9-10).
  async assignTemplateToClient(clientId, sourceTableId, trainerId) {
    const sourceTable = await tableDao.getTableById(sourceTableId);
    if (!sourceTable) throw badRequest("La plantilla de origen no existe", "TEMPLATE_NOT_FOUND");

    const isPublicTemplate = !sourceTable.userId;
    const isOwnTemplate = String(sourceTable.userId) === String(trainerId);
    if (!isPublicTemplate && !isOwnTemplate) {
      throw badRequest("Solo puedes asignar plantillas públicas o rutinas propias", "TEMPLATE_FORBIDDEN");
    }

    return tableDao.copyTableForClient(clientId, sourceTableId, trainerId);
  },

  // Rutinas -> Plantillas (rediseño 2026-08): mismo criterio que
  // assignNewRoutineToClient (F11) — SIN gate de canCreateRoutine. Ese
  // límite Free/Premium es la palanca de negocio del CLIENTE final
  // (routines: 1 en FREE_LIMITS); no aplica a la biblioteca de plantillas de
  // un profesional, que debe poder construir tantas como quiera aunque su
  // propia cuenta no sea premium.
  async createOwnRoutineTemplate(trainerId, name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableForTrainer(trainerId, standardTable);
  },

  // Mismo criterio que createOwnRoutineTemplate: sin gate de
  // canCreateRoutine (la biblioteca del profesional no tiene límite).
  async saveTableAsTrainerTemplate(trainerId, sourceTableId, name) {
    return tableDao.copyTableAsTrainerTemplate(trainerId, sourceTableId, name);
  },
};