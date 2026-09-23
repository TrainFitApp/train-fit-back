const PinnedExerciseNoteModel = require("./pinned-exercise-note-schema");
const Table = require("../tables/table-schema");
const Split = require("../splits/split-schema");
const Workout = require("../workouts/workout-schema");
const CustomExercise = require("../customExercises/custom-exercise-schema");

// Las notas ancladas se guardan por POSICIÓN (workoutIndex, exerciseIndex),
// compartida por todos los microciclos en esa fila. Cualquier operación que
// reordena, inserta o borra ejercicios/filas desplaza los ejercicios pero no
// las notas, que se quedaban pegadas al hueco. Aquí se resuelve por
// identidad: antes de mutar se anotan los CustomExercise que ocupan la
// posición de cada nota (uno por microciclo) y después se busca dónde han
// quedado.

const toId = (value) => (value?._id || value)?.toString();

// grid[split][workout][exercise] = id de CustomExercise.
function captureAnchors(notes, grid) {
  return notes.map((note) => {
    const ids = [];
    grid.forEach((workouts) => {
      const id = workouts[note.workoutIndex]?.[note.exerciseIndex];
      if (id) ids.push(id);
    });
    return {
      noteId: toId(note._id),
      workoutIndex: note.workoutIndex,
      exerciseIndex: note.exerciseIndex,
      ids,
    };
  });
}

// Cada microciclo "vota" la nueva posición de su ejercicio; gana la mayoría
// (reordenar una sola columna del Planificador no debe arrastrar la nota de
// toda la fila). En empate gana el primer microciclo. Sin votos, el
// ejercicio ya no existe y la nota se borra. Una nota que ya apuntaba a un
// hueco vacío (huérfana de antes de este arreglo) no se puede seguir: se
// deja como está salvo que otra nota necesite su posición.
function resolveAnchors(anchors, grid) {
  const positionById = new Map();
  grid.forEach((workouts) => {
    workouts.forEach((exercises, workoutIndex) => {
      exercises.forEach((id, exerciseIndex) => {
        positionById.set(id, { workoutIndex, exerciseIndex });
      });
    });
  });

  const posKey = (p) => `${p.workoutIndex}:${p.exerciseIndex}`;
  const deletes = [];
  const targets = [];

  anchors.forEach((anchor) => {
    if (anchor.ids.length === 0) {
      targets.push({ anchor, target: anchor, tracked: false });
      return;
    }
    const votes = new Map();
    let best = null;
    anchor.ids.forEach((id) => {
      const position = positionById.get(id);
      if (!position) return;
      const key = posKey(position);
      const count = (votes.get(key)?.count || 0) + 1;
      votes.set(key, { position, count });
      if (!best || count > best.count) best = { position, count };
    });
    if (!best) deletes.push(anchor.noteId);
    else targets.push({ anchor, target: best.position, tracked: true });
  });

  // Colisiones: prioridad a las notas seguidas que no se han movido, luego
  // al resto de seguidas, y las huérfanas ceden siempre su hueco.
  const rank = (t) =>
    !t.tracked ? 2 : posKey(t.anchor) === posKey(t.target) ? 0 : 1;
  const taken = new Set();
  const moves = [];
  [...targets]
    .sort((a, b) => rank(a) - rank(b))
    .forEach(({ anchor, target }) => {
      const key = posKey(target);
      if (taken.has(key)) {
        deletes.push(anchor.noteId);
        return;
      }
      taken.add(key);
      if (key !== posKey(anchor)) {
        moves.push({
          noteId: anchor.noteId,
          workoutIndex: target.workoutIndex,
          exerciseIndex: target.exerciseIndex,
        });
      }
    });

  return { moves, deletes };
}

// Queries lean por nivel (sin autopopulate: solo hacen falta ids). Las refs
// colgantes se filtran igual que haría el populate que ve el front, para que
// los índices coincidan con los que muestra la app.
async function loadGrid(tableId) {
  const table = await Table.findById(tableId).select("splits").lean();
  if (!table) return null;

  const splitIds = (table.splits || []).map(toId);
  const splits = await Split.find({ _id: { $in: splitIds } }).select("workouts").lean();
  const splitById = new Map(splits.map((s) => [toId(s._id), s]));

  const workoutIds = splits.flatMap((s) => (s.workouts || []).map(toId));
  const workouts = await Workout.find({ _id: { $in: workoutIds } }).select("exercises").lean();
  const workoutById = new Map(workouts.map((w) => [toId(w._id), w]));

  const exerciseIds = workouts.flatMap((w) => (w.exercises || []).map(toId));
  const existing = await CustomExercise.find({ _id: { $in: exerciseIds } }).select("_id").lean();
  const existingIds = new Set(existing.map((e) => toId(e._id)));

  return splitIds
    .map((id) => splitById.get(id))
    .filter(Boolean)
    .map((split) =>
      (split.workouts || [])
        .map((id) => workoutById.get(toId(id)))
        .filter(Boolean)
        .map((workout) => (workout.exercises || []).map(toId).filter((id) => existingIds.has(id))),
    );
}

async function capture(tableId) {
  const notes = await PinnedExerciseNoteModel.find({ tableId }).lean();
  if (notes.length === 0) return null;
  const grid = await loadGrid(tableId);
  if (!grid) return null;
  return { tableId, anchors: captureAnchors(notes, grid) };
}

async function reconcile({ tableId, anchors }) {
  const grid = await loadGrid(tableId);
  if (!grid) return;
  const { moves, deletes } = resolveAnchors(anchors, grid);

  if (deletes.length) {
    await PinnedExerciseNoteModel.deleteMany({ _id: { $in: deletes } });
  }
  if (!moves.length) return;

  // Dos pasadas por el índice único (tableId, workoutIndex, exerciseIndex):
  // un intercambio A↔B chocaría si se escribe directamente la posición final.
  await PinnedExerciseNoteModel.bulkWrite(
    moves.map((move, i) => ({
      updateOne: {
        filter: { _id: move.noteId },
        update: { $set: { workoutIndex: -1 - i, exerciseIndex: -1 - i } },
      },
    })),
  );
  await PinnedExerciseNoteModel.bulkWrite(
    moves.map((move) => ({
      updateOne: {
        filter: { _id: move.noteId },
        update: {
          $set: {
            workoutIndex: move.workoutIndex,
            exerciseIndex: move.exerciseIndex,
            updatedAt: new Date(),
          },
        },
      },
    })),
  );
}

// Envuelve una mutación de la estructura de una o varias tablas. Un fallo al
// resincronizar no debe tumbar una mutación que ya se ha escrito: se registra
// y se devuelve el resultado normal.
async function withPinnedNotesSync(tableIds, mutate) {
  const ids = [...new Set((Array.isArray(tableIds) ? tableIds : [tableIds]).map(toId).filter(Boolean))];

  let snapshots = [];
  try {
    snapshots = (await Promise.all(ids.map(capture))).filter(Boolean);
  } catch (error) {
    console.error("[pinnedNotesSync] capture failed:", error);
  }

  const result = await mutate();

  try {
    await Promise.all(snapshots.map(reconcile));
  } catch (error) {
    console.error("[pinnedNotesSync] reconcile failed:", error);
  }
  return result;
}

module.exports = { withPinnedNotesSync, captureAnchors, resolveAnchors };
