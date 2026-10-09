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

// Una copia (duplicar microciclo, fila o rutina, aplicar una plantilla,
// pegar, duplicar una serie) lleva la serie igual que está pautada:
// repeticiones, carga, RIR (fallo incluido), drop set, rest-pause, descanso,
// tiempo y distancia (`expected*`). Lo que no viaja es su ejecución: si se
// hizo, cuándo, su cronómetro y lo que se levantó de verdad.
const SET_EXECUTION_FIELDS = ["__v", "doned", "donedAt", "cronometer", "reps", "weight", "rir", "time", "distance", "velocity"];

function cloneSet(set) {
  const clone = plain(set);
  for (const field of SET_EXECUTION_FIELDS) delete clone[field];
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
// siempre (las series pierden su ejecución: cloneSet).
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

module.exports = {
  newId,
  toId,
  isObjectId,
  plain,
  exerciseRefOf,
  cloneSet,
  cloneExercise,
  cloneWorkout,
  reorderByIds,
};
