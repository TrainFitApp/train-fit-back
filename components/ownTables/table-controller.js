const tableModel = require("./table-service");
const featureAccessService = require("../billing/feature-access-service");

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function canActOnUser(req, targetUserId) {
  return isAdmin(req) || String(req.user?.id) === String(targetUserId);
}

module.exports = {
  async getTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 5).toString(), 10);

    const tables = await tableModel.getTables(page, limit, req.params.search);

    return res.send(tables);
  },

  async getTableById(req, res) {
    const table = await tableModel.getTableById(req.params.id);
    return res.send(table);
  },

  async copyTable(req, res) {
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = Array.isArray(req.user?.ownTables)
      ? req.user.ownTables.length
      : 0;
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableModel.copyTable(req.params.idUser, req.params.idTable);
    return res.send(table);
  },

  async copyOwnTable(req, res) {
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = Array.isArray(req.user?.ownTables)
      ? req.user.ownTables.length
      : 0;
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const copyOwnTable = await tableModel.copyOwnTable(req.params.idUser, req.params.idTable);
    return res.send(copyOwnTable);
  },

  async getSearchTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 5).toString(), 10);
    const tables = await tableModel.getSearchTables(
      page,
      limit,
      req.body.search,
      req.body.isOwn
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
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = Array.isArray(req.user?.ownTables)
      ? req.user.ownTables.length
      : 0;
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableModel.createTableToUser(
      req.params.idUser,
      req.body.name
    );
    return res.send(table);
  },

  async updateTable(req, res) {
    // if (!req.body.name) return res.sendStatus(400);
    // if (!req.body.splits) return res.sendStatus(400);

    const table = await tableModel.updateTable(req.body);

    return res.send(table);
  },

  async deleteTable(req, res) {
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    await tableModel.deleteTable(req.params.idUser, req.params.idTable);
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
