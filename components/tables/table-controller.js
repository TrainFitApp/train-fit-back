const tableModel = require("./table-service");

module.exports = {
  async getTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);

    const tables = await tableModel.getTables(page, limit, req.params.search);

    return res.send(tables);
  },

  async getTableById(req, res) {
    const table = await tableModel.getTableById(req.params.id);
    return res.send(table);
  },

  async copySharedTable(req, res) {
    const endpoint = await tableModel.copySharedTable(
      req.params.idUser,
      req.params.idTable
    );
    return res.send(endpoint);
  },

  async getSearchTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const tables = await tableModel.getSearchTables(
      page,
      limit,
      req.body.search,
      req.body.isOwn,
      req.body.idUser
    );
    return res.send(tables);
  },

  async createTable(req, res) {
    const table = await tableModel.createTable({
      name: req.body.name,
      type: req.body.type,
      splits: req.body.splits,
    });

    return res.send(table);
  },

  async createTableToUser(req, res) {
    const table = await tableModel.createTableToUser(
      req.params.idUser,
      req.body.name
    );
    return res.send(table);
  },

  async migrateTable(req, res) {
    const table = await tableModel.migrateTable(req.body);
    return res.send(table);
  },

  async updateTable(req, res) {
    if (!req.body._id) return res.sendStatus(400);
    if (!req.body.name) return res.sendStatus(400);

    const tableName = await tableModel.updateTable(req.body._id, req.body.name);

    return res.send(tableName);
  },

  async deleteTable(req, res) {
    await tableModel.deleteTable(req.params.id);
    res.sendStatus(204);
  },

  async deleteTableSplit(req, res) {
    const table = await tableModel.deleteTableSplit(
      req.params.idTable,
      req.params.idSplit
    );

    return res.send(table);
  },
};
