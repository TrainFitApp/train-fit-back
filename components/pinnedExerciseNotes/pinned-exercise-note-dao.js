const PinnedExerciseNote = require("./pinned-exercise-note-class");

class PinnedExerciseNoteDAO {
  async create(data) {
    return await PinnedExerciseNote.create(data);
  }

  async findByTableId(tableId) {
    return await PinnedExerciseNote.findByTableId(tableId);
  }

  async findByPosition(tableId, workoutIndex, exerciseIndex) {
    return await PinnedExerciseNote.findByPosition(tableId, workoutIndex, exerciseIndex);
  }

  async upsert(tableId, workoutIndex, exerciseIndex, notes, authorRole) {
    return await PinnedExerciseNote.upsert(tableId, workoutIndex, exerciseIndex, notes, authorRole);
  }

  async deleteById(id) {
    return await PinnedExerciseNote.deleteById(id);
  }

  async deleteByPosition(tableId, workoutIndex, exerciseIndex) {
    return await PinnedExerciseNote.deleteByPosition(tableId, workoutIndex, exerciseIndex);
  }
}

module.exports = new PinnedExerciseNoteDAO();