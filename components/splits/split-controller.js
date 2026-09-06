const splitService = require("./split-service");
const splitDTO = require("./split-dto");
const tableSchema = require("../tables/table-schema");
const featureAccessService = require("../billing/feature-access-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const tableAccess = require("../tables/table-access");
const mongoose = require("mongoose");

// MVP-trainers D10/F14: hasta 21 microciclos (no 4) SOLO si la rutina fue
// asignada por un profesional Y el cliente tiene AHORA relación "training"
// activa — no depende solo del campo, revierte al terminar la relación.
// Comprueba la relación del DUEÑO de la tabla (table.userId), no la de quien
// hace la petición — antes se comprobaba req.user.id, que coincidía por
// casualidad mientras solo el propio cliente podía llegar aquí; ahora que un
// profesional también puede mutar la tabla de su cliente, eran valores
// distintos y la exención quedaba mal calculada.
async function isMicrocycleExempt(table) {
  if (!table.assignedByTrainerId) return false;
  return trainerClientDao.hasActiveRelation(table.userId, "training");
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
    const table = await tableSchema
      .findById(req.params.tableInUseId)
      .select("_id userId splits assignedByTrainerId");
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    if (!featureAccessService.canAddMicrocycle(req.user, table.splits.length)) {
      const limit = featureAccessService.getLimits(
        req.user,
      ).microcyclesPerRoutine;
      return res.status(403).send({
        code: "PREMIUM_LIMIT_MICROCYCLES",
        message: `L\u00edmite alcanzado. Solo puedes tener ${limit} micro-ciclos por rutina.`,
      });
    }

    const split = await splitService.createSplitAndAddToTable(
      req.params.tableInUseId,
    );
    return res.send(split);
    // return res.send(splitDTO.single(split, req.body));
  },

  async addSplitToTable(req, res) {
    const table = await tableSchema
      .findById(req.body.idTable)
      .select("_id userId splits assignedByTrainerId");
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    if (!featureAccessService.canAddMicrocycle(req.user, table.splits.length)) {
      const limit = featureAccessService.getLimits(
        req.user,
      ).microcyclesPerRoutine;
      return res.status(403).send({
        code: "PREMIUM_LIMIT_MICROCYCLES",
        message: `L\u00edmite alcanzado. Solo puedes tener ${limit} micro-ciclos por rutina.`,
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
    const tableDoc = await tableSchema
      .findById(req.params.idTable)
      .select("_id userId assignedByTrainerId");
    if (!tableDoc)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, tableDoc.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, tableDoc)) return;

    const table = await splitService.addTableSplit(
      req.params.idTable,
      req.params.idSplit,
    );

    return res.send(table);
  },

  // No comprobaba propiedad antes de este cambio (bug preexistente, cerrado
  // de paso al abrir este módulo a "trainer").
  async addWorkoutsSplit(req, res) {
    const table = await tableAccess.findTableOwningSplit(req.params.idSplit);
    if (!table)
      return res.status(404).send({ message: "Micro-ciclo no encontrado" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const split = await splitService.addWorkoutsSplit(
      req.params.idSplit,
      req.params.idWorkout,
    );

    return res.send(split);
  },

  // No comprobaba propiedad antes de este cambio (bug preexistente, cerrado
  // de paso al abrir este módulo a "trainer").
  async updateSplit(req, res) {
    const split = await splitService.getSplit(req.params.id);
    if (!split) return res.sendStatus(404);

    const table = await tableAccess.findTableOwningSplit(req.params.id);
    if (!table) return res.sendStatus(404);
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    await splitService.updateSplit(req.params.id, req.body);

    return res.sendStatus(204);
  },

  // Planificador visual (Fase C) — reordena columnas dentro de una tabla.
  async reorderSplits(req, res) {
    const table = await tableSchema
      .findById(req.params.idTable)
      .select("_id userId assignedByTrainerId");
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    try {
      const splits = await splitService.reorderSplits(
        req.params.idTable,
        req.body?.splitIdsOrder,
      );
      return res.send(splits);
    } catch (e) {
      if (e.code === "INVALID_SPLIT_ORDER")
        return res.status(400).send({ message: e.message });
      if (e.code === "TABLE_NOT_FOUND")
        return res.status(404).send({ message: e.message });
      throw e;
    }
  },

  // Planificador visual (Fase C) — "Añadir semana" en blanco.
  async createBlankSplitAndAddToTable(req, res) {
    const table = await tableSchema
      .findById(req.params.idTable)
      .select("_id userId assignedByTrainerId");
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const isExempt = await isMicrocycleExempt(table);
    const fullTable = await tableSchema
      .findById(req.params.idTable)
      .select("splits");
    if (
      !featureAccessService.canAddMicrocycle(
        req.user,
        fullTable.splits.length,
        isExempt,
      )
    ) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_MICROCYCLES",
        message:
          "Límite Free alcanzado. Solo puedes tener 4 micro-ciclos por rutina.",
      });
    }

    const splits = await splitService.createBlankSplitAndAddToTable(
      req.params.idTable,
      req.body?.name,
    );
    return res.status(201).send(splits);
  },

  async deleteSplit(req, res) {
    const table = await tableSchema
      .findById(req.params.idTable)
      .select("_id userId assignedByTrainerId");
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

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

    const table = await tableSchema
      .findById(req.params.idTable)
      .select("_id userId splits assignedByTrainerId");

    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res.status(403).send({
        message: "No tienes permiso para esta rutina",
      });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const tableSplitIds = new Set(
      (table.splits || []).map((split) => (split?._id || split)?.toString()),
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
