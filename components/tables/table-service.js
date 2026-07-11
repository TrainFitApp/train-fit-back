const tableDao = require("./table-dao");
const tableUtil = require("./table-util");

module.exports = {
  async getTables(page, limit, own = false, idUser = null, defaultOnly = false) {
    if (own && idUser) {
      return tableDao.getSearchTables(page, limit, "", true, idUser);
    }
    if (defaultOnly && idUser) {
      return tableDao.getSearchTables(page, limit, "", false, idUser, true);
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

  async createTableToUser(idUser, name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableToUser(idUser, standardTable);
  },

  async updateTable(id, name, userId) {
    return tableDao.updateTable(id, name, userId);
  },

  async deleteTable(idUser, idTable) {
    return tableDao.deleteTable(idUser, idTable);
  },

  async deleteTableSplit(idSplit, idTable) {
    return tableDao.deleteTableSplit(idSplit, idTable);
  },

  async countUserTables(userId) {
    return tableDao.countUserTables(userId);
  },
};