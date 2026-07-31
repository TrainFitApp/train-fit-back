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
    return tableDao.getTables(page, limit);
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
};