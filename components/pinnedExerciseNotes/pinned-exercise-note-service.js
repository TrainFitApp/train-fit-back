const PinnedExerciseNoteDAO = require("./pinned-exercise-note-dao");
const PinnedExerciseNoteDTO = require("./pinned-exercise-note-dto");
const { noteAuthorRole, canWritePinnedNote } = require("../tables/note-authorship");
const { conflict, notFound } = require("../util/http-error");

// Notas ancladas a una posición (microciclo, ejercicio) de una rutina. El
// acceso a la rutina lo decide el controller (tables/table-access.js); aquí,
// la autoría: cada uno edita o borra solo la nota que ancló él (409 con
// código para que la app diga de quién es).

const MAX_NOTE_LENGTH = 500;

function assertAuthor(table, existing, userId) {
  if (canWritePinnedNote(existing, noteAuthorRole(userId, table.userId))) return;
  throw conflict("Esta nota anclada la escribió otra persona", "PINNED_NOTE_NOT_AUTHOR");
}

module.exports = {
  async getByTableId(tableId) {
    return PinnedExerciseNoteDTO.fromModels(await PinnedExerciseNoteDAO.findByTableId(tableId));
  },

  async getByPosition(tableId, { workoutIndex, exerciseIndex }) {
    const note = await PinnedExerciseNoteDAO.findByPosition(tableId, workoutIndex, exerciseIndex);
    return note ? PinnedExerciseNoteDTO.fromModel(note) : null;
  },

  async upsert(table, { workoutIndex, exerciseIndex }, notes, userId) {
    assertAuthor(table, await PinnedExerciseNoteDAO.findByPosition(table._id, workoutIndex, exerciseIndex), userId);
    const note = await PinnedExerciseNoteDAO.upsert(
      table._id,
      workoutIndex,
      exerciseIndex,
      notes.trim().slice(0, MAX_NOTE_LENGTH),
      noteAuthorRole(userId, table.userId),
    );
    return PinnedExerciseNoteDTO.fromModel(note);
  },

  // La rutina de una nota, para comprobar el acceso antes de borrarla.
  async tableIdOf(noteId) {
    const note = await PinnedExerciseNoteDAO.findById(noteId);
    if (!note) throw notFound("Pinned exercise note not found");
    return note.tableId;
  },

  async deleteById(table, noteId, userId) {
    assertAuthor(table, await PinnedExerciseNoteDAO.findById(noteId), userId);
    await PinnedExerciseNoteDAO.deleteById(noteId);
  },

  async deleteByPosition(table, { workoutIndex, exerciseIndex }, userId) {
    assertAuthor(table, await PinnedExerciseNoteDAO.findByPosition(table._id, workoutIndex, exerciseIndex), userId);
    await PinnedExerciseNoteDAO.deleteByPosition(table._id, workoutIndex, exerciseIndex);
  },
};
