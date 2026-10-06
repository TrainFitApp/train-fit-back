const mongoose = require("mongoose");
const pinnedExerciseNoteService = require("./pinned-exercise-note-service");
const tableAccess = require("../tables/table-access");
const { badRequest, forbidden, notFound } = require("../util/http-error");

// Sin rejectIfAssignedTableLockedForOwner a propósito: la nota anclada es del
// cliente (como clientNotes en custom-exercise-controller.js), no toca lo que
// pautó el entrenador.
async function accessibleTable(req, tableId) {
  if (!mongoose.isValidObjectId(tableId)) throw badRequest("Invalid table id");
  const table = await tableAccess.findTableForAccess(tableId);
  if (!table) throw notFound("Rutina no encontrada");
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    throw forbidden("No tienes permiso para esta rutina");
  }
  return table;
}

function positionOf(req) {
  const workoutIndex = Number.parseInt(req.params.workoutIndex, 10);
  const exerciseIndex = Number.parseInt(req.params.exerciseIndex, 10);
  if (!Number.isInteger(workoutIndex) || workoutIndex < 0 || !Number.isInteger(exerciseIndex) || exerciseIndex < 0) {
    throw badRequest("Invalid position");
  }
  return { workoutIndex, exerciseIndex };
}

module.exports = {
  async getByTableId(req, res) {
    const table = await accessibleTable(req, req.params.tableId);
    res.send(await pinnedExerciseNoteService.getByTableId(table._id));
  },

  async getByPosition(req, res) {
    const position = positionOf(req);
    const table = await accessibleTable(req, req.params.tableId);
    res.send(await pinnedExerciseNoteService.getByPosition(table._id, position));
  },

  async upsert(req, res) {
    const { notes } = req.body;
    if (typeof notes !== "string" || !notes.trim()) throw badRequest("Notes must be a non-empty string");
    const position = positionOf(req);
    const table = await accessibleTable(req, req.params.tableId);
    res.send(await pinnedExerciseNoteService.upsert(table, position, notes, req.user.id));
  },

  async deleteById(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) throw badRequest("Invalid note id");
    const table = await accessibleTable(req, await pinnedExerciseNoteService.tableIdOf(req.params.id));
    await pinnedExerciseNoteService.deleteById(table, req.params.id, req.user.id);
    res.send({ message: "Pinned exercise note deleted" });
  },

  async deleteByPosition(req, res) {
    const position = positionOf(req);
    const table = await accessibleTable(req, req.params.tableId);
    await pinnedExerciseNoteService.deleteByPosition(table, position, req.user.id);
    res.send({ message: "Pinned exercise note deleted" });
  },
};
