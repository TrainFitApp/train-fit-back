const PinnedExerciseNoteDAO = require("./pinned-exercise-note-dao");
const PinnedExerciseNoteDTO = require("./pinned-exercise-note-dto");

class PinnedExerciseNoteService {
  async getByTableId(tableId) {
    const notes = await PinnedExerciseNoteDAO.findByTableId(tableId);
    return PinnedExerciseNoteDTO.fromModels(notes);
  }

  async getByPosition(tableId, workoutIndex, exerciseIndex) {
    const note = await PinnedExerciseNoteDAO.findByPosition(tableId, workoutIndex, exerciseIndex);
    return note ? PinnedExerciseNoteDTO.fromModel(note) : null;
  }

  async upsert(tableId, workoutIndex, exerciseIndex, notes, authorRole) {
    const note = await PinnedExerciseNoteDAO.upsert(tableId, workoutIndex, exerciseIndex, notes, authorRole);
    return PinnedExerciseNoteDTO.fromModel(note);
  }

  async deleteById(id) {
    return await PinnedExerciseNoteDAO.deleteById(id);
  }

  async deleteByPosition(tableId, workoutIndex, exerciseIndex) {
    return await PinnedExerciseNoteDAO.deleteByPosition(tableId, workoutIndex, exerciseIndex);
  }
}

module.exports = new PinnedExerciseNoteService();