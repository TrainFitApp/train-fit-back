class PinnedExerciseNote {
  constructor(data) {
    this._id = data._id;
    this.tableId = data.tableId;
    this.workoutIndex = data.workoutIndex;
    this.exerciseIndex = data.exerciseIndex;
    this.notes = data.notes;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async create(data) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    const note = new PinnedExerciseNoteModel(data);
    return await note.save();
  }

  static async findByTableId(tableId) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    return await PinnedExerciseNoteModel.find({ tableId }).lean();
  }

  static async findByPosition(tableId, workoutIndex, exerciseIndex) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    return await PinnedExerciseNoteModel.findOne({ tableId, workoutIndex, exerciseIndex }).lean();
  }

  static async upsert(tableId, workoutIndex, exerciseIndex, notes) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    return await PinnedExerciseNoteModel.findOneAndUpdate(
      { tableId, workoutIndex, exerciseIndex },
      { tableId, workoutIndex, exerciseIndex, notes },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  }

  static async deleteById(id) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    return await PinnedExerciseNoteModel.findByIdAndDelete(id);
  }

  static async deleteByPosition(tableId, workoutIndex, exerciseIndex) {
    const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
    return await PinnedExerciseNoteModel.findOneAndDelete({ tableId, workoutIndex, exerciseIndex });
  }
}

module.exports = PinnedExerciseNote;