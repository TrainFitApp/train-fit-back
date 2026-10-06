const tableService = require("./table-service");
const tableAccess = require("./table-access");
const featureAccess = require("../billing/feature-access");

// Copiar o duplicar una rutina: la de origen tiene que ser una plantilla
// pública (sin userId) o una rutina a la que quien llama ya tiene acceso. Sin
// esto, cualquiera copiaba a su cuenta la rutina privada de otro usuario.
async function rejectIfSourceTableForbidden(req, res, idTable) {
  const source = await tableService.getTableById(idTable);
  if (!source) {
    res.status(404).send({ message: "Rutina no encontrada" });
    return true;
  }
  if (source.userId && !(await tableAccess.canAccessUserTable(req, source.userId))) {
    res.status(403).send({ message: "No tienes permiso para esta rutina" });
    return true;
  }
  return false;
}

module.exports = {
  async getTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 5).toString(), 10);
    const own = req.query.own === "true";
    const defaultOnly = req.query.defaultOnly === "true";
    const idUser = (own || defaultOnly) ? req.user?.id : null;

    const tables = await tableService.getTables(page, limit, own, idUser, defaultOnly);

    return res.send(tables);
  },

  // Replanteamiento MVP (rutinas): antes sin ninguna comprobaci\u00f3n de
  // propiedad \u2014 cualquier "user"/"admin" autenticado pod\u00eda leer CUALQUIER
  // tabla por ID. Se cierra al abrir el m\u00f3dulo a "trainer".
  async getTableById(req, res) {
    const table = await tableService.getTableById(req.params.id);
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
    if (await rejectIfSourceTableForbidden(req, res, req.params.idTable)) return;

    const routineCount = await tableService.countEffectiveUserTables(idUser);
    if (!featureAccess.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableService.copyTable(idUser, req.params.idTable);
    return res.send(table);
  },

  // TASK-069 (MASTER_BACKLOG.md) \u2014 antes definida dos veces de forma
  // id\u00e9ntica en este mismo m\u00f3dulo (la segunda ganaba silenciosamente en
  // JS, la primera era c\u00f3digo muerto inalcanzable). Se deja una sola copia.
  async duplicateTable(req, res) {
    const idUser = req.body.idUser || req.params.idUser;
    if (!(await tableAccess.canAccessUserTable(req, idUser))) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }
    if (await rejectIfSourceTableForbidden(req, res, req.params.idTable)) return;

    const routineCount = await tableService.countEffectiveUserTables(idUser);
    if (!featureAccess.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const duplicatedTable = await tableService.duplicateTable(idUser, req.params.idTable);
    return res.send(duplicatedTable);
  },

  async getSearchTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 5).toString(), 10);
    const { search, isOwn, defaultOnly } = req.body;
    // El idUser del cuerpo solo vale si quien llama puede ver las rutinas de
    // ese usuario (él mismo, admin o su entrenador); si no, las suyas.
    const idUser = req.body.idUser && (await tableAccess.canAccessUserTable(req, req.body.idUser))
      ? req.body.idUser
      : req.user.id;
    const tables = await tableService.getSearchTables(page, limit, search, isOwn, idUser, defaultOnly);
    return res.send(tables);
  },

  async createTable(req, res) {
    const userId = req.body.userId || req.user?.id;
    const table = await tableService.createTable({
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

    const routineCount = await tableService.countEffectiveUserTables(idUser);
    if (!featureAccess.canCreateRoutine(req.user, routineCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_ROUTINES",
        message: "L\u00edmite Free alcanzado. Solo puedes tener 1 rutina.",
      });
    }

    const table = await tableService.createTableToUser(idUser, req.body.name);
    return res.send(table);
  },

  async createDefaultTable(req, res) {
    const table = await tableService.createDefaultTable(req.body.name);
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

    const table = await tableService.getTableById(req.body._id);
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const tableName = await tableService.updateTable(req.body._id, req.body.name, table.userId, true);
    return res.send(tableName);
  },

  // El acceso se comprueba contra el dueño REAL de la tabla. Las plantillas
  // públicas (sin userId) solo las borra un admin.
  async deleteTable(req, res) {
    const table = await tableService.getTableById(req.params.idTable);
    if (!table) return res.status(404).send({ message: "Tabla no encontrada o sin permiso" });
    const allowed = table.userId
      ? await tableAccess.canAccessUserTable(req, table.userId)
      : tableAccess.isAdmin(req);
    if (!allowed) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const result = await tableService.deleteTable(table.userId, table._id, !table.userId);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Tabla no encontrada o sin permiso" });
    }
    res.sendStatus(204);
  },

  async getExerciseHistoryStats(req, res) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).send({ message: "No autorizado" });

    const exerciseId = req.query.exerciseId || null;
    const exerciseName = req.query.exerciseName || "";
    if (!exerciseId && !exerciseName) {
      return res.status(400).send({ message: "exerciseId o exerciseName requerido" });
    }

    const stats = await tableService.getExerciseHistoryStats(
      userId,
      exerciseId,
      exerciseName
    );
    return res.send(stats);
  },
};
