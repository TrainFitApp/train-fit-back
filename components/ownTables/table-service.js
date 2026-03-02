const tableDao = require("./table-dao");
const tableUtil = require("./table-util");

module.exports = {
  async getTables(page, limit) {
    return tableDao.getTables(page, limit);
  },

  async getTableById(id) {
    return tableDao.getTableById(id);
  },

  async copyTable(idUser, idTable) {
    return tableDao.copyTable(idUser, idTable);
  },

  async copyOwnTable(idUser, idTable) {
    return tableDao.copyOwnTable(idUser, idTable);
  },

  async getSearchTables(page, limit, search, isOwn) {
    return tableDao.getSearchTables(page, limit, search, isOwn);
  },

  async createTable(table) {
    return tableDao.createTable(table);
  },

  async createTableToUser(idUser, name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableToUser(idUser, standardTable);
  },

  async updateTable(table) {
    return tableDao.updateTable(table);
  },

  async deleteTable(idUser, idTable) {
    return tableDao.deleteTable(idUser, idTable);
  },

  async deleteTableSplit(idSplit, idTable) {
    return tableDao.deleteTableSplit(idSplit, idTable);
  },
};
