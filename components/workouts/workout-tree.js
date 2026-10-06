const mongoose = require("mongoose");
const { compactSet } = require("../sets/set-schema");
const { normalizeSetsOrder } = require("../sets/set-order-util");
const { clearWorkoutExecutionState } = require("./workout-copy-util");

// Utilidades del árbol de entrenamiento embebido (2026-10):
//
//   Table.splits[]            microciclos, en orden, con ids de sus sesiones
//   Workout.exercises[]       ejercicios de la sesión
//   Workout.exercises[].sets  series de cada ejercicio
//
// Copiar, localizar y reordenar se hace aquí una sola vez; los DAO de tablas,
// microciclos, sesiones, ejercicios y series lo reutilizan.

const newId = () => new mongoose.Types.ObjectId();

function toId(value) {
  const raw = value?._id ?? value;
  return raw == null ? null : raw.toString();
}

function isObjectId(value) {
  const id = toId(value);
  return Boolean(id) && mongoose.isValidObjectId(id) && /^[0-9a-fA-F]{24}$/.test(id);
}

function plain(value) {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
}

// Referencia al Exercise de un ejercicio de sesión, venga poblado o no.
function exerciseRefOf(customExercise) {
  const ref = customExercise?.exercise;
  return ref?._id ?? ref ?? undefined;
}

// Técnica (drop/restPause/FALLO) y "hecha" son de ESA serie concreta, no algo
// que deba heredar una copia (duplicar microciclo, fila, sesión o rutina).
function normalizeSetForCopy(set) {
  delete set.doned;
  delete set.drop;
  delete set.restPause;
  if (Array.isArray(set.expectedRir) && set.expectedRir.includes(-1)) {
    set.expectedRir = [];
  }
}

function cloneSet(set) {
  const clone = plain(set);
  delete clone.__v;
  normalizeSetForCopy(clone);
  return compactSet({ ...clone, _id: newId() });
}

function cloneExercise(customExercise, { withSets = true } = {}) {
  const source = plain(customExercise);
  const sets = withSets ? normalizeSetsOrder((customExercise?.sets || []).map(plain)) : [];
  return {
    _id: newId(),
    exercise: exerciseRefOf(customExercise),
    order: source.order,
    notes: source.notes,
    clientNotes: source.clientNotes,
    blockId: source.blockId ?? null,
    sets: sets.map(cloneSet),
  };
}

// Copia de una sesión para otro microciclo o rutina: id nuevo, ejercicios y
// series nuevos y sin estado de ejecución (ver workout-copy-util.js). Los
// bloques conservan su _id: así se reconocen en la misma fila de los demás
// microciclos (workout-row-blocks.js). `keepExecutionState`: copiar o
// duplicar una rutina entera conserva el estado de cada sesión, como hizo
// siempre (solo las series pierden su "hecha" y su técnica).
function cloneWorkout(workout, { nameSuffix, withSets = true, keepExecutionState = false } = {}) {
  const clone = plain(workout);
  delete clone.__v;
  if (!keepExecutionState) clearWorkoutExecutionState(clone);
  clone._id = newId();
  if (nameSuffix) clone.name = `${clone.name || ""} ${nameSuffix}`.trim();
  clone.exercises = (workout?.exercises || []).map((customExercise) =>
    cloneExercise(customExercise, { withSets }),
  );
  return clone;
}

// Reordena/filtra `current` según la lista de ids que manda el cliente. Antes
// de embeber, los arrays de referencias que llegaban en el cuerpo
// (`exercises`, `sets`, `workouts`) se guardaban como lista de ids: aquí se
// conserva ese mismo significado (orden y pertenencia), nunca el contenido
// que traiga el cliente, que puede estar desfasado. Un id que no es de
// `current` se ignora.
function reorderByIds(current, requested) {
  const byId = new Map((current || []).map((item) => [toId(item), item]));
  const used = new Set();
  const result = [];
  for (const entry of Array.isArray(requested) ? requested : []) {
    const id = toId(entry);
    if (!id || used.has(id) || !byId.has(id)) continue;
    used.add(id);
    result.push(byId.get(id));
  }
  return result;
}

// Ids de las sesiones de una tabla (lean o documento), en el orden de sus
// microciclos.
function workoutIdsOfTable(table) {
  return (table?.splits || []).flatMap((split) => (split.workouts || []).map(toId)).filter(Boolean);
}

module.exports = {
  newId,
  toId,
  isObjectId,
  plain,
  exerciseRefOf,
  normalizeSetForCopy,
  cloneSet,
  cloneExercise,
  cloneWorkout,
  reorderByIds,
  workoutIdsOfTable,
};
