const Table = require("../tables/table-schema");
const { toId, isObjectId } = require("../workouts/workout-tree");

// Notas ancladas embebidas en su rutina (Table.pinnedNotes[], 2026-10). Cada
// nota se devuelve con el `tableId` de su rutina, como cuando eran documentos
// sueltos.

function withTable(tableId, note) {
  return note ? { ...note, tableId } : null;
}

async function notesOf(tableId) {
  if (!isObjectId(tableId)) return null;
  const table = await Table.findById(tableId).select("pinnedNotes").lean();
  return table ? table.pinnedNotes || [] : null;
}

class PinnedExerciseNoteDAO {
  async findByTableId(tableId) {
    return ((await notesOf(tableId)) || []).map((note) => withTable(tableId, note));
  }

  async findByPosition(tableId, workoutIndex, exerciseIndex) {
    const note = ((await notesOf(tableId)) || []).find(
      (candidate) => candidate.workoutIndex === workoutIndex && candidate.exerciseIndex === exerciseIndex,
    );
    return withTable(tableId, note);
  }

  async findById(id) {
    if (!isObjectId(id)) return null;
    const table = await Table.findOne({ "pinnedNotes._id": id }).select("_id pinnedNotes").lean();
    const note = (table?.pinnedNotes || []).find((candidate) => toId(candidate) === toId(id));
    return withTable(table?._id, note);
  }

  // Una nota por posición: si ya hay una ahí se sobrescribe; si no, se añade.
  async upsert(tableId, workoutIndex, exerciseIndex, notes, authorRole) {
    const now = new Date();
    const updated = await Table.updateOne(
      { _id: tableId, pinnedNotes: { $elemMatch: { workoutIndex, exerciseIndex } } },
      {
        $set: {
          "pinnedNotes.$.notes": notes,
          "pinnedNotes.$.authorRole": authorRole,
          "pinnedNotes.$.updatedAt": now,
        },
      },
    );
    if (!updated.matchedCount) {
      await Table.updateOne(
        { _id: tableId, pinnedNotes: { $not: { $elemMatch: { workoutIndex, exerciseIndex } } } },
        { $push: { pinnedNotes: { workoutIndex, exerciseIndex, notes, authorRole, createdAt: now, updatedAt: now } } },
      );
    }
    return this.findByPosition(tableId, workoutIndex, exerciseIndex);
  }

  async deleteById(id) {
    if (!isObjectId(id)) return { modifiedCount: 0 };
    return Table.updateOne({ "pinnedNotes._id": id }, { $pull: { pinnedNotes: { _id: id } } });
  }

  async deleteByPosition(tableId, workoutIndex, exerciseIndex) {
    return Table.updateOne({ _id: tableId }, { $pull: { pinnedNotes: { workoutIndex, exerciseIndex } } });
  }
}

module.exports = new PinnedExerciseNoteDAO();
