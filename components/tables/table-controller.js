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
    const own = req.query.own === "true";
    const defaultOnly = req.query.defaultOnly === "true";
    const idUser = (own || defaultOnly) ? req.user?.id : null;

    const tables = await tableModel.getTables(page, limit, own, idUser, defaultOnly);

    return res.send(tables);
  },

  async getTableById(req, res) {
    const table = await tableModel.getTableById(req.params.id);
    return res.send(table);
  },

async copyTable(req, res) {
    const idUser = req.body.idUser || req.params.idUser;
    if (!canActOnUser(req, idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countUserTables(idUser);
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableModel.copyTable(idUser, req.params.idTable);
    return res.send(table);
  },

  async duplicateTable(req, res) {
    const idUser = req.body.idUser || req.params.idUser;
    if (!canActOnUser(req, idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countUserTables(idUser);
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const duplicatedTable = await tableModel.duplicateTable(idUser, req.params.idTable);
    return res.send(duplicatedTable);
  },

  async duplicateTable(req, res) {
    const idUser = req.body.idUser || req.params.idUser;
    if (!canActOnUser(req, idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countUserTables(idUser);
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const duplicatedTable = await tableModel.duplicateTable(idUser, req.params.idTable);
    return res.send(duplicatedTable);
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
    const limit = parseInt((req.query.limit || 5).toString(), 10);
    const { search, isOwn, idUser, defaultOnly } = req.body;
    const tables = await tableModel.getSearchTables(page, limit, search, isOwn, idUser, defaultOnly);
    return res.send(tables);
  },

  async createTable(req, res) {
    const userId = req.body.userId || req.user?.id;
    const table = await tableModel.createTable({
      name: req.body.name,
      type: req.body.type,
      ...(userId && { userId }),
      splits: req.body.splits,
    });

    return res.send(table);
  },

  async createTableToUser(req, res) {
    const idUser = req.params.idUser || req.body.idUser;
    if (!canActOnUser(req, idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countUserTables(idUser);
    if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableModel.createTableToUser(idUser, req.body.name);
    return res.send(table);
  },

  async createDefaultTable(req, res) {
    const table = await tableModel.createDefaultTable(req.body.name);
    return res.send(table);
  },

  async updateTable(req, res) {
    if (!req.body._id) return res.sendStatus(400);
    if (!req.body.name) return res.sendStatus(400);

    const tableName = await tableModel.updateTable(req.body._id, req.body.name, req.user?.id);
    return res.send(tableName);
  },

  async deleteTable(req, res) {
    const idUser = req.params.idUser;
    if (!canActOnUser(req, idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const result = await tableModel.deleteTable(idUser, req.params.idTable);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Tabla no encontrada o sin permiso" });
    }
    res.sendStatus(204);
  },

  async deleteTableSplit(req, res) {
    const table = await tableModel.deleteTableSplit(
      req.params.idTable,
      req.params.idSplit
    );

    return res.send(table);
  },

  async getExerciseHistoryStats(req, res) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).send({ message: "No autorizado" });

    const exerciseId = req.query.exerciseId || null;
    const exerciseName = req.query.exerciseName || "";
    if (!exerciseId && !exerciseName) {
      return res.status(400).send({ message: "exerciseId o exerciseName requerido" });
    }

    const stats = await tableModel.getExerciseHistoryStats(
      userId,
      exerciseId,
      exerciseName
    );
    return res.send(stats);
  },
};
