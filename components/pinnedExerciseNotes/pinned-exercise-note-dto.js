class PinnedExerciseNoteDTO {
  constructor(data) {
    this._id = data._id;
    this.tableId = data.tableId;
    this.workoutIndex = data.workoutIndex;
    this.exerciseIndex = data.exerciseIndex;
    this.notes = data.notes;
    this.authorRole = data.authorRole || null;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static fromModel(model) {
    return new PinnedExerciseNoteDTO(model);
  }

  static fromModels(models) {
    return models.map((model) => PinnedExerciseNoteDTO.fromModel(model));
  }
}

module.exports = PinnedExerciseNoteDTO;