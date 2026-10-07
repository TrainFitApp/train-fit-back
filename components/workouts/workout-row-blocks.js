// PURO — bloques por FILA.
//
// Invariante del modelo: todos los entrenamientos de una fila (la misma
// posición en todos los microciclos de una tabla) tienen EXACTAMENTE los
// mismos bloques, con el mismo _id y los mismos datos; y cada ejercicio solo
// apunta (blockId) a un bloque de su propio entrenamiento, o a ninguno.
//
// Lo mantienen las escrituras (workout-dao.js): guardar los bloques escribe
// la misma lista en toda la fila, y las altas de una fila nueva (plantilla,
// crear en todos los microciclos) usan los mismos _id en todos. Los datos
// anteriores a la regla los deja así scripts/migrations/22-workout-row-blocks.js
// con unifyRowBlocks.

const idOf = (value) => (value && value._id ? value._id : value)?.toString() || "";

/** Los ejercicios, sin blockId que no sea de `blocks`. */
function keepValidBlockIds(exercises, blocks) {
  const blockIds = new Set((blocks || []).map(idOf));
  return (exercises || []).map((exercise) =>
    exercise.blockId && !blockIds.has(idOf(exercise.blockId)) ? { ...exercise, blockId: null } : exercise,
  );
}

/**
 * Bloques para una fila NUEVA: _id nuevos (`newId`), los mismos para todos
 * los entrenamientos de la fila. `remapExercises` traduce el blockId de los
 * ejercicios de origen al bloque nuevo (o a ninguno si no era de `blocks`).
 */
function rekeyBlocks(blocks, newId) {
  const idMap = new Map();
  const rekeyed = (blocks || []).map((block, order) => {
    const _id = newId();
    idMap.set(idOf(block), _id);
    return { ...block, _id, order: Number.isFinite(block?.order) ? block.order : order };
  });
  const remapExercises = (exercises) =>
    (exercises || []).map((exercise) => ({
      ...exercise,
      blockId: exercise.blockId && idMap.has(idOf(exercise.blockId)) ? idMap.get(idOf(exercise.blockId)) : null,
    }));
  return { blocks: rekeyed, remapExercises };
}

// Misma regla que el resto de operaciones por fila (borrar ejercicio, notas
// fijadas): la misma posición, comprobando que sea el mismo ejercicio del
// catálogo; si no cuadra, el primero con ese ejercicio. null = ese
// microciclo no lo tiene.
function pickRowExercise(originIndex, originExerciseId, siblingExercises) {
  const list = siblingExercises || [];
  const target = idOf(originExerciseId);
  if (!target) return null;
  const atIndex = list[originIndex];
  if (atIndex && idOf(atIndex.exercise) === target) return atIndex;
  return list.find((candidate) => idOf(candidate.exercise) === target) || null;
}

const normalizedName = (name) => String(name || "").trim().toLowerCase();

const BLOCK_FIELDS = ["name", "type", "order", "rounds", "restBetweenExercises", "restBetweenRounds", "instructions"];
const blocksSignature = (blocks) =>
  JSON.stringify(
    [...(blocks || [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((block) => [idOf(block), ...BLOCK_FIELDS.map((field) => block[field] ?? null)]),
  );
const blockIdsSignature = (exercises) =>
  JSON.stringify((exercises || []).map((exercise) => (exercise.blockId ? idOf(exercise.blockId) : null)));

/**
 * Deja una fila cumpliendo el invariante. `row`: sus entrenamientos en orden
 * de microciclo, cada uno { _id, blocks, exercises }. Devuelve, en el mismo
 * orden, { _id, blocks, exercises, changed }.
 *
 * - Un bloque se reconoce en otro microciclo por su _id o, si no lo comparte
 *   (datos antiguos: cada microciclo creaba el suyo), por tipo + nombre (y
 *   el número de aparición si el mismo tipo y nombre se repite).
 * - Cada bloque se queda con el _id y los datos de su primera aparición en
 *   la fila; el orden, el de la fila (0..n-1).
 * - Un bloque que falta en un microciclo se crea allí, y se le asignan los
 *   ejercicios equivalentes de la fila (pickRowExercise) que no estén ya en
 *   otro bloque.
 * - Ningún ejercicio queda apuntando a un bloque que no existe.
 */
function unifyRowBlocks(row) {
  const canonical = [];
  const byId = new Map();
  const byKey = new Map();
  const localToCanonical = row.map(() => new Map());

  row.forEach((workout, workoutIndex) => {
    const local = localToCanonical[workoutIndex];
    const used = new Set();
    const occurrences = new Map();
    const blocks = [...(workout.blocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const block of blocks) {
      const base = `${block.type || "straight"}|${normalizedName(block.name)}`;
      const occurrence = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, occurrence);
      const key = `${base}#${occurrence}`;

      let entry = byId.get(idOf(block)) || byKey.get(key) || null;
      if (entry && used.has(entry)) entry = null;
      if (!entry) {
        entry = { block, sourceIndex: workoutIndex, members: [] };
        canonical.push(entry);
        if (!byKey.has(key)) byKey.set(key, entry);
      }
      used.add(entry);
      byId.set(idOf(block), entry);
      local.set(idOf(block), entry);
    }
  });

  for (const entry of canonical) {
    (row[entry.sourceIndex].exercises || []).forEach((exercise, index) => {
      if (exercise.blockId && idOf(exercise.blockId) === idOf(entry.block)) {
        entry.members.push({ index, exercise: exercise.exercise });
      }
    });
  }

  const rowBlocks = canonical.map((entry, order) => ({ ...entry.block, order }));

  return row.map((workout, workoutIndex) => {
    const local = localToCanonical[workoutIndex];
    let exercises = (workout.exercises || []).map((exercise) => {
      const entry = exercise.blockId ? local.get(idOf(exercise.blockId)) : null;
      const current = exercise.blockId ? idOf(exercise.blockId) : "";
      const next = entry ? idOf(entry.block) : "";
      return current === next ? exercise : { ...exercise, blockId: entry ? entry.block._id : null };
    });

    const present = new Set(local.values());
    for (const entry of canonical) {
      if (present.has(entry)) continue;
      for (const member of entry.members) {
        const target = pickRowExercise(member.index, member.exercise, exercises);
        if (!target || target.blockId) continue;
        exercises = exercises.map((exercise) => (exercise === target ? { ...exercise, blockId: entry.block._id } : exercise));
      }
    }

    const changed =
      blocksSignature(workout.blocks) !== blocksSignature(rowBlocks) ||
      blockIdsSignature(workout.exercises) !== blockIdsSignature(exercises);
    return { _id: workout._id, blocks: rowBlocks.map((block) => ({ ...block })), exercises, changed };
  });
}

module.exports = { keepValidBlockIds, rekeyBlocks, pickRowExercise, unifyRowBlocks };
