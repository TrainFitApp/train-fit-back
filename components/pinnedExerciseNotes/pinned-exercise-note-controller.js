const PinnedExerciseNoteService = require("./pinned-exercise-note-service");

class PinnedExerciseNoteController {
  async getByTableId(req, res) {
    try {
      const { tableId } = req.params;
      const notes = await PinnedExerciseNoteService.getByTableId(tableId);
      res.send(notes);
    } catch (error) {
      console.error("Error getting pinned exercise notes:", error);
      res.status(500).json({ success: false, message: "Error getting pinned exercise notes" });
    }
  }

  async getByPosition(req, res) {
    try {
      const { tableId, workoutIndex, exerciseIndex } = req.params;
      const note = await PinnedExerciseNoteService.getByPosition(
        tableId,
        parseInt(workoutIndex),
        parseInt(exerciseIndex)
      );
      res.send(note);
    } catch (error) {
      console.error("Error getting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error getting pinned exercise note" });
    }
  }

  async upsert(req, res) {
    try {
      const { tableId, workoutIndex, exerciseIndex } = req.params;
      const { notes } = req.body;

      if (typeof notes !== "string") {
        return res.status(400).json({ success: false, message: "Notes must be a string" });
      }

      const note = await PinnedExerciseNoteService.upsert(
        tableId,
        parseInt(workoutIndex),
        parseInt(exerciseIndex),
        notes.trim()
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
      await PinnedExerciseNoteService.deleteById(id);
      res.send({ success: true, message: "Pinned exercise note deleted" });
    } catch (error) {
      console.error("Error deleting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error deleting pinned exercise note" });
    }
  }

  async deleteByPosition(req, res) {
    try {
      const { tableId, workoutIndex, exerciseIndex } = req.params;
      await PinnedExerciseNoteService.deleteByPosition(
        tableId,
        parseInt(workoutIndex),
        parseInt(exerciseIndex)
      );
      res.send({ success: true, message: "Pinned exercise note deleted" });
    } catch (error) {
      console.error("Error deleting pinned exercise note:", error);
      res.status(500).json({ success: false, message: "Error deleting pinned exercise note" });
    }
  }
}

module.exports = new PinnedExerciseNoteController();