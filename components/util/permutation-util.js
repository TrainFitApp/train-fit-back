// Planificador visual (Fase C) — comprobación compartida de "el array pedido
// es exactamente una permutación del array actual" (ni añade, ni quita, ni
// repite elementos). Usada tanto para reordenar columnas (splits dentro de
// una tabla) como cards (workouts dentro de un split) — misma regla, dos
// sitios, extraída para no duplicar la lógica ni sus tests.
function isSamePermutation(currentIds, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length !== currentIds.length) {
    return false;
  }
  const uniqueRequested = new Set(requestedIds);
  if (uniqueRequested.size !== requestedIds.length) return false;

  const currentSet = new Set(currentIds);
  return requestedIds.every((id) => currentSet.has(id));
}

module.exports = { isSamePermutation };
