// PURO — bloques por FILA (2026-09): crear, renombrar, borrar y asignar
// ejercicios a un bloque se aplica al mismo entrenamiento de todos los
// microciclos, como el resto del Planner. Un bloque nuevo nace con el MISMO
// _id en toda la fila, y así se reconoce en los demás microciclos. Los
// bloques anteriores a esto tienen un _id distinto en cada microciclo (o
// solo existen en uno): no casan con nada fuera del suyo y siguen siendo
// locales, sin migración.

const idOf = (value) => (value && value._id ? value._id : value)?.toString() || "";

// previous: bloques guardados del entrenamiento origen; next: los que manda
// el cliente, ya con _id resuelto (los nuevos con uno recién generado).
function diffBlocks(previous, next) {
  const previousIds = new Set((previous || []).map(idOf));
  const nextIds = new Set((next || []).map(idOf));
  return {
    added: (next || []).filter((block) => !previousIds.has(idOf(block))),
    updated: (next || []).filter((block) => previousIds.has(idOf(block))),
    removedIds: [...previousIds].filter((id) => !nextIds.has(id)),
  };
}

// Bloques de otro microciclo de la fila tras aplicar el cambio del origen.
// Solo se tocan los bloques que comparten _id; los locales se quedan igual.
function applyBlockDiff(siblingBlocks, diff) {
  const removed = new Set(diff.removedIds);
  const updatedById = new Map(diff.updated.map((block) => [idOf(block), block]));
  const kept = (siblingBlocks || [])
    .filter((block) => !removed.has(idOf(block)))
    .map((block) => {
      const updated = updatedById.get(idOf(block));
      return updated ? { ...updated, _id: block._id } : block;
    });
  const keptIds = new Set(kept.map(idOf));
  return [...kept, ...diff.added.filter((block) => !keptIds.has(idOf(block)))];
}

// Mismo criterio que el resto de operaciones por fila (borrar ejercicio,
// notas fijadas): la misma posición, comprobando que sea el mismo ejercicio
// del catálogo; si no cuadra, el primero con ese ejercicio. null = ese
// microciclo no lo tiene.
function pickRowExercise(originIndex, originExerciseId, siblingExercises) {
  const list = siblingExercises || [];
  const target = idOf(originExerciseId);
  if (!target) return null;
  const atIndex = list[originIndex];
  if (atIndex && idOf(atIndex.exercise) === target) return atIndex;
  return list.find((candidate) => idOf(candidate.exercise) === target) || null;
}

module.exports = { diffBlocks, applyBlockDiff, pickRowExercise };
