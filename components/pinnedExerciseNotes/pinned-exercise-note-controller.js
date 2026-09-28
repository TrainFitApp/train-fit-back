const mongoose = require("mongoose");
const PinnedExerciseNoteService = require("./pinned-exercise-note-service");
const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
const tableSchema = require("../tables/table-schema");
const tableAccess = require("../tables/table-access");
const { noteAuthorRole, canWritePinnedNote } = require("../tables/note-authorship");

// Sin rejectIfAssignedTableLockedForOwner a propósito: la nota anclada es del
// cliente (como clientNotes en custom-exercise-controller.js), no toca lo que
// pautó el entrenador. Devuelve la tabla (o null tras responder el error).
async function assertCanAccessTable(req, res, tableId) {
  if (!mongoose.isValidObjectId(tableId)) {
    res.status(400).json({ success: false, message: "Invalid table id" });
    return null;
  }
  const table = await tableSchema.findById(tableId).select("_id userId").lean();
  if (!table) {
    res.status(404).json({ success: false, message: "Rutina no encontrada" });
    return null;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).json({ success: false, message: "No tienes permiso para esta rutina" });
    return null;
  }
  return table;
}

// 2026-09 — cada uno edita o borra solo la nota que ancló él. 409 con código
// para que el front diga de quién es en vez de un error genérico.
function rejectIfNotAuthor(req, res, table, existing) {
  if (canWritePinnedNote(existing, noteAuthorRole(req.user.id, table.userId))) return false;
  res.status(409).json({
    success: false,
    code: "PINNED_NOTE_NOT_AUTHOR",
    message: "Esta nota anclada la escribió otra persona",
  });
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
      const table = await assertCanAccessTable(req, res, tableId);
      if (!table) return;
      const existing = await PinnedExerciseNoteService.getByPosition(
        tableId,
        position.workoutIndex,
        position.exerciseIndex
      );
      if (rejectIfNotAuthor(req, res, table, existing)) return;

      const note = await PinnedExerciseNoteService.upsert(
        tableId,
        position.workoutIndex,
        position.exerciseIndex,
        notes.trim().slice(0, 500),
        noteAuthorRole(req.user.id, table.userId)
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
      const note = await PinnedExerciseNoteModel.findById(id).select("tableId authorRole").lean();
      if (!note) {
        return res.status(404).json({ success: false, message: "Pinned exercise note not found" });
      }
      const table = await assertCanAccessTable(req, res, note.tableId);
      if (!table) return;
      if (rejectIfNotAuthor(req, res, table, note)) return;
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
      const table = await assertCanAccessTable(req, res, tableId);
      if (!table) return;
      const existing = await PinnedExerciseNoteService.getByPosition(
        tableId,
        position.workoutIndex,
        position.exerciseIndex
      );
      if (rejectIfNotAuthor(req, res, table, existing)) return;
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
