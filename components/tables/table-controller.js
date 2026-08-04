const tableModel = require("./table-service");
const tableAccess = require("./table-access");
const featureAccessService = require("../billing/feature-access-service");

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

  // Replanteamiento MVP (rutinas): antes sin ninguna comprobaci\u00f3n de
  // propiedad \u2014 cualquier "user"/"admin" autenticado pod\u00eda leer CUALQUIER
  // tabla por ID. Se cierra al abrir el m\u00f3dulo a "trainer".
  async getTableById(req, res) {
    const table = await tableModel.getTableById(req.params.id);
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }
    return res.send(table);
  },

async copyTable(req, res) {
    const idUser = req.body.idUser || req.params.idUser;
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countEffectiveUserTables(idUser);
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
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countEffectiveUserTables(idUser);
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
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countEffectiveUserTables(idUser);
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
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const routineCount = await tableModel.countEffectiveUserTables(idUser);
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

  // Antes escrib\u00eda siempre { _id, userId: req.user?.id } \u2014 si quien llama es
  // un profesional editando la tabla de SU CLIENTE, req.user?.id es el id del
  // profesional, no el due\u00f1o real, y el update no encontraba coincidencia
  // (fallaba en silencio, no era un hueco de seguridad pero s\u00ed romp\u00eda la
  // funci\u00f3n para "trainer"). Ahora se resuelve la tabla primero, se comprueba
  // acceso con el mismo criterio que el resto del m\u00f3dulo, y se actualiza en
  // modo admin (bypass del filtro por userId) porque el acceso ya est\u00e1
  // verificado aqu\u00ed.
  async updateTable(req, res) {
    if (!req.body._id) return res.sendStatus(400);
    if (!req.body.name) return res.sendStatus(400);

    const table = await tableModel.getTableById(req.body._id);
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }

    const tableName = await tableModel.updateTable(req.body._id, req.body.name, table.userId, true);
    return res.send(tableName);
  },

  async deleteTable(req, res) {
    const idUser = req.params.idUser;
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const result = await tableModel.deleteTable(idUser, req.params.idTable, true);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Tabla no encontrada o sin permiso" });
    }
    res.sendStatus(204);
  },

  // Replanteamiento MVP (rutinas): sin comprobaci\u00f3n de propiedad antes de
  // este cambio (bug preexistente, cerrado de paso).
  async deleteTableSplit(req, res) {
    const tableDoc = await tableModel.getTableById(req.params.idTable);
    if (!tableDoc) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, tableDoc.userId))) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }

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
