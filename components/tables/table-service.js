const tableDao = require("./table-dao");
const tableUtil = require("./table-util");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

module.exports = {
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

  async getTableById(id) {
    return tableDao.getTableById(id);
  },

  async copyTable(idUser, idTable) {
    return tableDao.copyTable(idUser, idTable);
  },

  async duplicateTable(idUser, idTable) {
    return tableDao.duplicateTable(idUser, idTable);
  },

  async copySharedTable(idUser, idTable) {
    return tableDao.copySharedTable(idUser, idTable);
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

  async deleteTable(idUser, idTable, adminMode = false) {
    return tableDao.deleteTable(idUser, idTable, adminMode);
  },

  async deleteTableSplit(idSplit, idTable) {
    return tableDao.deleteTableSplit(idSplit, idTable);
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
    const hasActiveTraining = await trainerClientDao.hasActiveRelation(userId, "training");
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
    if (!sourceTable) {
      const err = new Error("La plantilla de origen no existe");
      err.code = "TEMPLATE_NOT_FOUND";
      throw err;
    }

    const isPublicTemplate = !sourceTable.userId;
    const isOwnTemplate = String(sourceTable.userId) === String(trainerId);
    if (!isPublicTemplate && !isOwnTemplate) {
      const err = new Error(
        "Solo puedes asignar plantillas públicas o rutinas propias"
      );
      err.code = "TEMPLATE_FORBIDDEN";
      throw err;
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
};