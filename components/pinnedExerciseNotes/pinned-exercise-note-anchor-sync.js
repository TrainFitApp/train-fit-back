const Table = require("../tables/table-schema");
const Workout = require("../workouts/workout-schema");

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

// Dos lecturas lean (sin autopopulate: solo hacen falta ids): la tabla, con
// sus microciclos y notas embebidos, y los ejercicios de sus sesiones. Las
// refs colgantes se filtran igual que haría el populate que ve el front, para
// que los índices coincidan con los que muestra la app.
async function loadTable(tableId) {
  const table = await Table.findById(tableId).select("splits pinnedNotes").lean();
  if (!table) return null;

  const workoutIds = (table.splits || []).flatMap((split) => (split.workouts || []).map(toId));
  const workouts = await Workout.find({ _id: { $in: workoutIds } }).select("exercises._id").lean();
  const workoutById = new Map(workouts.map((w) => [toId(w._id), w]));

  const grid = (table.splits || []).map((split) =>
    (split.workouts || [])
      .map((id) => workoutById.get(toId(id)))
      .filter(Boolean)
      .map((workout) => (workout.exercises || []).map(toId)),
  );
  return { grid, notes: table.pinnedNotes || [] };
}

async function capture(tableId) {
  const loaded = await loadTable(tableId);
  if (!loaded || loaded.notes.length === 0) return null;
  return { tableId, anchors: captureAnchors(loaded.notes, loaded.grid) };
}

async function reconcile({ tableId, anchors }) {
  const loaded = await loadTable(tableId);
  if (!loaded) return;
  const { moves, deletes } = resolveAnchors(anchors, loaded.grid);
  if (!deletes.length && !moves.length) return;

  // Las notas van dentro de la tabla: se reescribe la lista entera de una vez
  // (sin el índice único de cuando eran documentos, un intercambio A<->B ya
  // no necesita dos pasadas).
  const deleted = new Set(deletes.map(toId));
  const moveById = new Map(moves.map((move) => [toId(move.noteId), move]));
  const now = new Date();
  const pinnedNotes = loaded.notes
    .filter((note) => !deleted.has(toId(note._id)))
    .map((note) => {
      const move = moveById.get(toId(note._id));
      return move
        ? { ...note, workoutIndex: move.workoutIndex, exerciseIndex: move.exerciseIndex, updatedAt: now }
        : note;
    });
  await Table.updateOne({ _id: tableId }, { $set: { pinnedNotes } });
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
