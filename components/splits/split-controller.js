const splitService = require("./split-service");
const featureAccess = require("../billing/feature-access");
const tableAccess = require("../tables/table-access");
const mongoose = require("mongoose");

module.exports = {
  async addSplitToTable(req, res) {
    const table = await tableAccess.findTableForAccess(req.body.idTable, { withSplits: true });
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    if (!featureAccess.canAddMicrocycle(req.user, (table.splits || []).length)) {
      const limit = featureAccess.getLimits(
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

    // Solo los datos del microciclo: sus entrenos se gestionan por sus rutas
    // (un $set del cuerpo entero dejaba enganchar workouts de cualquiera).
    const patch = {};
    for (const key of ["name", "objective", "purpose"]) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
    }
    await splitService.updateSplit(req.params.id, patch);

    return res.sendStatus(204);
  },

  // Planificador visual (Fase C) — reordena columnas dentro de una tabla.
  async reorderSplits(req, res) {
    const table = await tableAccess.findTableForAccess(req.params.idTable);
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    return res.send(await splitService.reorderSplits(req.params.idTable, req.body?.splitIdsOrder));
  },

  // Planificador visual (Fase C) — "Añadir semana" en blanco.
  async createBlankSplitAndAddToTable(req, res) {
    const table = await tableAccess.findTableForAccess(req.params.idTable, { withSplits: true });
    if (!table)
      return res.status(404).send({ message: "Rutina no encontrada" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    const isExempt = await tableAccess.isMicrocycleExempt(table);
    if (!featureAccess.canAddMicrocycle(req.user, (table.splits || []).length, isExempt)) {
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
    const table = await tableAccess.findTableForAccess(req.params.idTable);
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

    const table = await tableAccess.findTableForAccess(req.params.idTable, { withSplits: true });

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
