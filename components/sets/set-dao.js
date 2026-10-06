const Workout = require("../workouts/workout-schema");
const { SET_FIELDS } = require("./set-schema");
const { normalizeSetsOrder } = require("./set-order-util");
const { toId, plain, isObjectId } = require("../workouts/workout-tree");
const { mutateWorkout } = require("../workouts/workout-store");

// Series embebidas en su sesión (Workout.exercises[].sets[], 2026-10). Una
// serie se localiza por su _id con el índice `exercises.sets._id`; se escribe
// con arrayFilters, así que cada cambio toca solo esa serie y es atómico.

const SET_PATH = "exercises.$[exercise].sets.$[set]";

function setFilters(setId) {
  return [{ "exercise.sets._id": setId }, { "set._id": setId }];
}

function findSetIn(workout, setId) {
  const id = toId(setId);
  for (const customExercise of workout?.exercises || []) {
    const set = (customExercise.sets || []).find((candidate) => toId(candidate) === id);
    if (set) return { customExercise, set };
  }
  return null;
}

// Lo que el cliente manda de una serie, como $set/$unset: null, undefined y
// [] vacían el campo. `_id` no se toca y `donedAt` nunca se acepta del
// cliente (deriva de reloj entre dispositivo y servidor).
function buildSetPatch(set) {
  const $set = {};
  const $unset = {};
  for (const key of Object.keys(set || {})) {
    if (key === "_id" || key === "donedAt" || !SET_FIELDS.includes(key)) continue;
    const value = set[key];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    if (value === null || value === undefined || isEmptyArray) $unset[key] = "";
    else $set[key] = value;
  }
  return { $set, $unset };
}

module.exports = {
  async updateSet(set) {
    const { $set, $unset } = buildSetPatch(set);

    // donedAt: solo se fija en la transición real false->true (comprobando
    // el valor actual en BD: el frontend manda `doned` en cada guardado, no
    // solo cuando cambia). Al desmarcar una serie se limpia.
    if ($set.doned === true) {
      const workout = await Workout.findOne({ "exercises.sets._id": set._id }).select("exercises.sets._id exercises.sets.doned").lean();
      if (!findSetIn(workout, set._id)?.set?.doned) $set.donedAt = new Date();
    } else if ($set.doned === false) {
      $unset.donedAt = "";
    }

    // $inc de la versión: las escrituras que reescriben la lista de series
    // (workout-store.js) tienen que notar este cambio.
    const update = { $inc: { __v: 1 } };
    if (Object.keys($set).length) {
      update.$set = Object.fromEntries(Object.entries($set).map(([key, value]) => [`${SET_PATH}.${key}`, value]));
    }
    if (Object.keys($unset).length) {
      update.$unset = Object.fromEntries(Object.keys($unset).map((key) => [`${SET_PATH}.${key}`, ""]));
    }

    let workout;
    if (update.$set || update.$unset) {
      // runValidators: los min/max del schema valen también al editar (un
      // ValidationError acaba en 400 en errorHandler).
      workout = await Workout.findOneAndUpdate({ "exercises.sets._id": set._id }, update, {
        arrayFilters: setFilters(set._id),
        new: true,
        runValidators: true,
      }).lean();
    } else {
      workout = await Workout.findOne({ "exercises.sets._id": set._id }).lean();
    }
    return findSetIn(workout, set._id)?.set || null;
  },

  // Quita la serie de su ejercicio y renumera el orden de las que quedan.
  async deleteSet(id) {
    if (!isObjectId(id)) return { deletedCount: 0 };
    let deleted = false;
    await mutateWorkout({ "exercises.sets._id": id }, (workout) => {
      deleted = false;
      const exercises = (workout.exercises || []).map((customExercise) => {
        if (!(customExercise.sets || []).some((set) => toId(set) === toId(id))) return customExercise;
        deleted = true;
        const remaining = customExercise.sets.filter((set) => toId(set) !== toId(id)).map(plain);
        return { ...customExercise, sets: normalizeSetsOrder(remaining) };
      });
      return deleted ? { exercises } : null;
    });
    return { deletedCount: deleted ? 1 : 0 };
  },

  findSetIn,
};
