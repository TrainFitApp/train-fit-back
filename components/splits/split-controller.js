const splitService = require("./split-service");
const splitDTO = require("./split-dto");
const ownTableSchema = require("../ownTables/own-table-schema");
const featureAccessService = require("../billing/feature-access-service");
const mongoose = require("mongoose");

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function userOwnsTable(req, tableId) {
  if (isAdmin(req)) return true;
  const ownTables = Array.isArray(req.user?.ownTables) ? req.user.ownTables : [];
  return ownTables.some((id) => id?.toString() === tableId?.toString());
}

module.exports = {
  async getSplits(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const splits = await splitService.getSplits(page, limit);
    return res.send(splits);
  },

  async getSplitByCode(req, res) {
    const split = await splitService.getSplitByCode(req.params.barcode);
    return res.send(split);
  },

  async getSplitsCount(req, res) {
    const count = await splitService.getSplitsCount();
    return res.send({ splitsCount: count });
  },

  async getSearchSplit(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const splits = await splitService.getSearchSplit(
      page,
      limit,
      req.params.search,
    );
    return res.send(splits);
  },

  async createSplit(req, res) {
    const split = await splitService.createSplit(req.body);
    return res.send(split);
    // return res.send(splitDTO.single(split, req.body));
  },
  async createSplitAndAddToTable(req, res) {
    const table = await ownTableSchema
      .findById(req.params.tableInUseId)
      .select("_id splits");
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!userOwnsTable(req, table._id)) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }
    if (!featureAccessService.canAddMicrocycle(req.user, table.splits.length)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_MICROCYCLES",
        message:
          "L\u00edmite Free alcanzado. Solo puedes tener 4 micro-ciclos por rutina.",
      });
    }

    const split = await splitService.createSplitAndAddToTable(
      req.params.tableInUseId,
    );
    return res.send(split);
    // return res.send(splitDTO.single(split, req.body));
  },

  async addSplitToTable(req, res) {
    const table = await ownTableSchema.findById(req.body.idTable).select("_id splits");
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!userOwnsTable(req, table._id)) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }
    if (!featureAccessService.canAddMicrocycle(req.user, table.splits.length)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_MICROCYCLES",
        message:
          "L\u00edmite Free alcanzado. Solo puedes tener 4 micro-ciclos por rutina.",
      });
    }

    const splitDoc = await splitService.addSplitToTable(
      req.body.idTable,
      req.body.idSplit,
      req.body.withSets,
    );
    return res.send(splitDoc);
    // return res.send(splitDTO.single(split, req.body));
  },

  async addTableSplit(req, res) {
    const tableDoc = await ownTableSchema.findById(req.params.idTable).select("_id");
    if (!tableDoc) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!userOwnsTable(req, tableDoc._id)) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }

    const table = await splitService.addTableSplit(
      req.params.idTable,
      req.params.idSplit,
    );

    return res.send(table);
  },

  async addWorkoutsSplit(req, res) {
    const split = await splitService.addWorkoutsSplit(
      req.params.idSplit,
      req.params.idWorkout,
    );

    return res.send(split);
  },

  async updateSplit(req, res) {
    const split = await splitService.getSplit(req.params.id);
    if (!split) return res.sendStatus(404);

    await splitService.updateSplit(req.params.id, req.body);

    return res.sendStatus(204);
  },

  async deleteSplit(req, res) {
    const table = await ownTableSchema.findById(req.params.idTable).select("_id");
    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!userOwnsTable(req, table._id)) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }

    await splitService.deleteSplit(req.params.idTable, req.params.idSplit);
    res.sendStatus(204);
  },

  async deleteSplits(req, res) {
    if (!mongoose.isValidObjectId(req.params.idTable)) {
      return res.status(400).send({
        message: "La rutina indicada no es valida",
      });
    }

    const splitIds = Array.from(
      new Set(
        (Array.isArray(req.body?.splitIds) ? req.body.splitIds : [])
          .map((id) => id?.toString())
          .filter(Boolean),
      ),
    );

    if (
      splitIds.length === 0 ||
      splitIds.some((id) => !mongoose.isValidObjectId(id))
    ) {
      return res.status(400).send({
        message: "Debes seleccionar micro-ciclos validos",
      });
    }

    const table = await ownTableSchema
      .findById(req.params.idTable)
      .select("_id splits");

    if (!table) return res.status(404).send({ message: "Rutina no encontrada" });
    if (!userOwnsTable(req, table._id)) {
      return res.status(403).send({
        message: "No tienes permiso para esta rutina",
      });
    }

    const tableSplitIds = new Set(
      (table.splits || []).map((split) =>
        (split?._id || split)?.toString(),
      ),
    );

    if (splitIds.some((id) => !tableSplitIds.has(id))) {
      return res.status(400).send({
        message: "Uno o mas micro-ciclos no pertenecen a esta rutina",
      });
    }

    const result = await splitService.deleteSplits(
      table._id,
      splitIds,
      req.user?._id,
      req.user?.workoutInUse,
    );

    return res.send(result);
  },
};
