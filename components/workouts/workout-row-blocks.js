// PURO — bloques por FILA.
//
// Invariante del modelo: todos los entrenamientos de una fila (la misma
// posición en todos los microciclos de una tabla) tienen EXACTAMENTE los
// mismos bloques, con el mismo _id y los mismos datos; y cada ejercicio solo
// apunta (blockId) a un bloque de su propio entrenamiento, o a ninguno.
//
// Lo mantienen las escrituras (workout-dao.js): guardar los bloques escribe
// la misma lista en toda la fila; las altas de una fila nueva (crear en todos
// los microciclos, aplicar una plantilla, duplicar la fila) estrenan _id
// compartidos por toda la fila; duplicar un microciclo conserva los _id (la
// copia se queda en las mismas filas); y nada guarda un blockId que no sea
// de la propia sesión. scripts/migrations/22-workout-row-blocks.js deja así
// los datos guardados antes de la regla.

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

module.exports = { keepValidBlockIds, rekeyBlocks, pickRowExercise };
