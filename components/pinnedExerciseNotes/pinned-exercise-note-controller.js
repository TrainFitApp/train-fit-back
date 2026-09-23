const mongoose = require("mongoose");
const PinnedExerciseNoteService = require("./pinned-exercise-note-service");
const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
const tableSchema = require("../tables/table-schema");
const tableAccess = require("../tables/table-access");

// Sin rejectIfAssignedTableLockedForOwner a propósito: la nota anclada es del
// cliente (como clientNotes en custom-exercise-controller.js), no toca lo que
// pautó el entrenador.
async function assertCanAccessTable(req, res, tableId) {
  if (!mongoose.isValidObjectId(tableId)) {
    res.status(400).json({ success: false, message: "Invalid table id" });
    return false;
  }
  const table = await tableSchema.findById(tableId).select("_id userId").lean();
  if (!table) {
    res.status(404).json({ success: false, message: "Rutina no encontrada" });
    return false;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).json({ success: false, message: "No tienes permiso para esta rutina" });
    return false;
  }
  return true;
}

function parsePosition(req, res) {
  const workoutIndex = Number.parseInt(req.params.workoutIndex, 10);
  const exerciseIndex = Number.parseInt(req.params.exerciseIndex, 10);
  if (!Number.isInteger(workoutIndex) || workoutIndex < 0 || !Number.isInteger(exerciseIndex) || exerciseIndex < 0) {
    res.status(400).json({ success: false, message: "Invalid position" });
    return null;
  }
  return { workoutIndex, exerciseIndex };
}

class PinnedExerciseNoteController {
  async getByTableId(req, res) {
    try {
      const { tableId } = req.params;
      if (!(await assertCanAccessTable(req, res, tableId))) return;
      const notes = await PinnedExerciseNoteService.getByTableId(tableId);
      res.send(notes);
    } catch (error) {
      console.error("Error getting pinned exercise notes:", error);
      res.status(500).json({ success: false, message: "Error getting pinned exercise notes" });
    }
  }

  async getByPosition(req, res) {
    try {
      const { tableId } = req.params;
      const position = parsePosition(req, res);
      if (!position) return;
      if (!(await assertCanAccessTable(req, res, tableId))) return;
      const note = await PinnedExerciseNoteService.getByPosition(
        tableId,
        position.workoutIndex,
        position.exerciseIndex
      );
      res.send(note);
    } catch (error) {
      console.error("Error getting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error getting pinned exercise note" });
    }
  }

  async upsert(req, res) {
    try {
      const { tableId } = req.params;
      const { notes } = req.body;

      if (typeof notes !== "string" || !notes.trim()) {
        return res.status(400).json({ success: false, message: "Notes must be a non-empty string" });
      }
      const position = parsePosition(req, res);
      if (!position) return;
      if (!(await assertCanAccessTable(req, res, tableId))) return;

      const note = await PinnedExerciseNoteService.upsert(
        tableId,
        position.workoutIndex,
        position.exerciseIndex,
        notes.trim().slice(0, 500)
      );
      res.send(note);
    } catch (error) {
      console.error("Error upserting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error saving pinned exercise note" });
    }
  }

  async deleteById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid note id" });
      }
      const note = await PinnedExerciseNoteModel.findById(id).select("tableId").lean();
      if (!note) {
        return res.status(404).json({ success: false, message: "Pinned exercise note not found" });
      }
      if (!(await assertCanAccessTable(req, res, note.tableId))) return;
      await PinnedExerciseNoteService.deleteById(id);
      res.send({ success: true, message: "Pinned exercise note deleted" });
    } catch (error) {
      console.error("Error deleting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error deleting pinned exercise note" });
    }
  }

  async deleteByPosition(req, res) {
    try {
      const { tableId } = req.params;
      const position = parsePosition(req, res);
      if (!position) return;
      if (!(await assertCanAccessTable(req, res, tableId))) return;
      await PinnedExerciseNoteService.deleteByPosition(
        tableId,
        position.workoutIndex,
        position.exerciseIndex
      );
      res.send({ success: true, message: "Pinned exercise note deleted" });
    } catch (error) {
      console.error("Error deleting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error deleting pinned exercise note" });
    }
  }
}

module.exports = new PinnedExerciseNoteController();
