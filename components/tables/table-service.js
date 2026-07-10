const tableDao = require("./table-dao");
const tableUtil = require("./table-util");

module.exports = {
  async getTables(page, limit) {
    return tableDao.getTables(page, limit);
  },

  async getTableById(id) {
    return tableDao.getTableById(id);
  },

  async copySharedTable(idUser, idTable) {
    return tableDao.copySharedTable(idUser, idTable);
  },

  async getSearchTables(page, limit, search, isOwn, idUser) {
    return tableDao.getSearchTables(page, limit, search, isOwn, idUser);
  },

  async createTable(table) {
    return tableDao.createTable(table);
  },

  async createTableToUser(idUser, name) {
    const standardTable = tableUtil.getStandardTable();
    standardTable.name = name;
    return tableDao.createTableToUser(idUser, standardTable);
  },

  async updateTable(id, name) {
    return await tableDao.updateTable(id, name);
  },

  async deleteTable(id) {
    return tableDao.deleteTable(id);
  },

  async deleteTableSplit(idSplit, idTable) {
    return tableDao.deleteTableSplit(idSplit, idTable);
  },
};
