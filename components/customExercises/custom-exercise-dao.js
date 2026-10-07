const { default: mongoose } = require("mongoose");
const { badRequest, notFound } = require("../util/http-error");
const workoutSchema = require("../workouts/workout-schema");
const { compactSet } = require("../sets/set-schema");
const { normalizeSetsOrder } = require("../sets/set-order-util");
const { findRowSiblingWorkoutIds } = require("../workouts/workout-row-dao");
const { pickRowExercise } = require("../workouts/workout-row-blocks");
const { mutateWorkout } = require("../workouts/workout-store");
const { toId, plain, newId, isObjectId } = require("../workouts/workout-tree");

// Ejercicios de sesión embebidos en su Workout (Workout.exercises[], con las
// series dentro; 2026-10). Las operaciones que tocan la lista de series leen
// la sesión, cambian ese ejercicio y la reescriben con compare-and-swap
// (workout-store.js#mutateWorkout).

// Lo que el cliente puede escribir en una serie existente desde
// updateCustomExercise / copySetOnCustomExercise. Fuera quedan donedAt (lo
// fija el backend) y cronometer.
const SET_UPDATE_FIELDS = [
  "reps",
  "weight",
  "rir",
  "expectedRir",
  "expectedReps",
  "drop",
  "restPause",
  "restSeconds",
  "doned",
  "time",
  "expectedTime",
  "distance",
  "expectedDistance",
  "velocity",
  "order",
];

function plainSet(set) {
  const value = plain(set);
  delete value.__v;
  delete value.displayOrder;
  return value;
}

function isTemporarySetId(id) {
  return id != null && !Number.isNaN(Number(id));
}

// Aplica a una serie guardada lo que manda el cliente: null, undefined y []
// vacían el campo; el resto se escribe.
function applySetUpdate(target, source) {
  SET_UPDATE_FIELDS.forEach((field) => {
    const value = source[field];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    target[field] = value === null || value === undefined || isEmptyArray ? undefined : value;
  });
}

// Serie nueva a partir de lo que manda el cliente: id nuevo, sin donedAt.
function newSet(source, extra = {}) {
  const { _id, donedAt, ...content } = plainSet(source);
  return compactSet({ ...content, ...extra, _id: newId() });
}

// Cambia UN ejercicio de su sesión con compare-and-swap. `change` recibe el
// ejercicio en plano y lo devuelve cambiado (o null para no escribir).
async function mutateExercise(id, change) {
  if (!isObjectId(id)) return null;
  let found = false;
  const written = await mutateWorkout({ "exercises._id": id }, async (workout) => {
    const exercises = workout.exercises || [];
    const index = exercises.findIndex((exercise) => toId(exercise) === toId(id));
    if (index < 0) return null;
    found = true;
    const next = await change(exercises[index], workout);
    if (!next) return null;
    const list = [...exercises];
    list[index] = next;
    return { exercises: list };
  });
  return written && found ? written : null;
}

// El ejercicio tal cual lo recibe la app: con su Exercise poblado.
async function loadCustomExercise(id) {
  if (!isObjectId(id)) return null;
  const workout = await workoutSchema.findOne({ "exercises._id": id });
  const customExercise = workout?.exercises?.id(id);
  return customExercise ? customExercise.toObject() : null;
}

module.exports = {
  loadCustomExercise,

  async findCustomExerciseById(id) {
    return loadCustomExercise(id);
  },

  // Guarda la lista de series del ejercicio TAL CUAL la manda el cliente
  // (orden incluido): actualiza las que existen, crea las nuevas (id
  // temporal numérico, sin id o un id que no es de este ejercicio) y quita
  // las de setsToDelete. Una serie de OTRO ejercicio nunca se toca ni se
  // engancha aquí: antes se actualizaba y quedaba compartida por los dos.
  async updateCustomExercise(customExercise, setsToCreate, setsToUpdate, setsToDelete) {
    const setsToDeleteIds = new Set((setsToDelete || []).map(toId));
    const createByTempId = new Map((setsToCreate || []).map((set) => [toId(plainSet(set)), plainSet(set)]));

    const written = await mutateExercise(customExercise?._id, (saved) => {
      const savedById = new Map((saved.sets || []).map((set) => [toId(set), set]));
      const sets = (customExercise.sets || [])
        .map(plainSet)
        .filter((set) => !setsToDeleteIds.has(toId(set)))
        .map((set, index) => {
          const id = toId(set);
          const existing = id && !isTemporarySetId(id) ? savedById.get(id) : null;
          if (existing) {
            const next = { ...existing };
            applySetUpdate(next, set);
            next.order = index;
            return compactSet(next);
          }
          const draft = isTemporarySetId(id) && createByTempId.has(id) ? { ...createByTempId.get(id), ...set } : set;
          return newSet(draft, { order: index });
        });

      const next = { ...saved, sets };
      // Nota del ENTRENADOR: ausente o vacía la BORRA. No es un descuido —
      // el planificador borra una nota con `delete customExercise.notes`
      // (workout.component.ts#updateExerciseNote) y luego manda el objeto.
      if (!customExercise.notes || customExercise.notes?.trim() === "") delete next.notes;
      else next.notes = customExercise.notes;

      // Nota del CLIENTE: aquí SÍ se mira hasOwnProperty, al revés que
      // arriba: hay peticiones de versiones anteriores de la app que no la
      // traen, y cada una la borraría. Para vaciarla se manda "".
      if (Object.prototype.hasOwnProperty.call(customExercise, "clientNotes")) {
        const clientNotes = customExercise.clientNotes;
        if (!clientNotes || String(clientNotes).trim() === "") delete next.clientNotes;
        else next.clientNotes = clientNotes;
      }
      return next;
    });

    return written ? loadCustomExercise(customExercise._id) : null;
  },

  // `set` llega del cliente (sin _id o con uno temporal): se añade al final
  // y se renumera el orden de todas.
  async addSetToCustomExercise(id, set) {
    const written = await mutateExercise(id, (saved) => ({
      ...saved,
      sets: normalizeSetsOrder([...(saved.sets || []).map(plainSet), newSet(set)]),
    }));
    return written ? loadCustomExercise(id) : null;
  },

  // El cliente manda el ejercicio con la serie copiada ya colocada y SIN
  // _id; el resto de series pueden traer su orden nuevo.
  async copySetOnCustomExercise(order, customExercise) {
    const incoming = (customExercise?.sets || []).map(plainSet);
    if (!incoming.some((set) => !set._id)) {
      throw new Error("No set to copy found in custom exercise payload");
    }

    const written = await mutateExercise(customExercise?._id, (saved) => {
      const savedById = new Map((saved.sets || []).map((set) => [toId(set), set]));
      const merged = incoming
        .map((set) => {
          if (!set._id) return { ...newSet(set), order: set.order };
          const existing = savedById.get(toId(set));
          if (!existing) return null; // id ajeno a este ejercicio
          const next = { ...existing };
          applySetUpdate(next, set);
          return next;
        })
        .filter(Boolean);
      return { ...saved, sets: normalizeSetsOrder(merged).map(compactSet) };
    });

    return written ? loadCustomExercise(customExercise._id) : null;
  },

  // Asigna/quita el bloque de un ejercicio. El bloque tiene que existir en
  // Workout.blocks[] de la MISMA sesión (nunca confiar en un id suelto del
  // body). El mismo ejercicio de la misma fila en los demás microciclos entra
  // o sale del mismo bloque: los bloques son de la fila
  // (workouts/workout-row-blocks.js), y aun así solo se escribe donde el
  // bloque existe, para no dejar nunca un blockId huérfano.
  async setCustomExerciseBlock(id, blockId) {
    let originIndex = -1;
    let originExercise = null;
    let originWorkoutId = null;
    let blockMissing = false;

    const written = await mutateExercise(id, (saved, workout) => {
      if (blockId && !(workout.blocks || []).some((block) => toId(block) === toId(blockId))) {
        blockMissing = true;
        return null;
      }
      originIndex = workout.exercises.findIndex((exercise) => toId(exercise) === toId(id));
      originExercise = saved.exercise;
      originWorkoutId = workout._id;
      return { ...saved, blockId: blockId || null };
    });

    if (blockMissing) {
      throw badRequest("El bloque no existe en este entrenamiento", "BLOCK_NOT_FOUND");
    }
    if (!written) {
      throw notFound("Ejercicio no encontrado", "CUSTOM_EXERCISE_NOT_FOUND");
    }

    const rowUpdates = [];
    for (const siblingId of await findRowSiblingWorkoutIds(originWorkoutId)) {
      let updated = null;
      await mutateWorkout({ _id: siblingId }, (sibling) => {
        updated = null;
        if (blockId && !(sibling.blocks || []).some((block) => toId(block) === toId(blockId))) return null;
        const rowTarget = pickRowExercise(originIndex, originExercise, sibling.exercises || []);
        if (!rowTarget) return null;
        updated = rowTarget._id;
        return {
          exercises: sibling.exercises.map((exercise) =>
            toId(exercise) === toId(rowTarget) ? { ...exercise, blockId: blockId || null } : exercise,
          ),
        };
      });
      if (updated) rowUpdates.push({ _id: updated, blockId: blockId || null });
    }

    // rowUpdates: qué ejercicios de los demás microciclos cambiaron, para
    // repintarlos sin recargar (la app de cliente lo ignora).
    return { ...(await loadCustomExercise(id)), rowUpdates };
  },

  // Vía dedicada para la nota del CLIENTE, separada de updateCustomExercise
  // (que sí queda bloqueado en rutinas asignadas). Vaciar = cadena vacía.
  async updateClientNotes(id, clientNotes) {
    if (!isObjectId(id)) return null;
    const trimmed = (clientNotes || "").toString().trim();
    const update = trimmed
      ? { $set: { "exercises.$.clientNotes": trimmed }, $inc: { __v: 1 } }
      : { $unset: { "exercises.$.clientNotes": 1 }, $inc: { __v: 1 } };
    const result = await workoutSchema.updateOne({ "exercises._id": id }, update);
    return result.matchedCount ? loadCustomExercise(id) : null;
  },

  // Quita el ejercicio (con sus series) de su sesión.
  async deleteCustomExercise(id) {
    return this.deleteCustomExercises([id]);
  },

  async deleteCustomExercises(ids) {
    const validIds = (ids || []).filter(isObjectId).map((id) => new mongoose.Types.ObjectId(toId(id)));
    if (!validIds.length) return { deletedCount: 0 };
    const result = await workoutSchema.updateMany(
      { "exercises._id": { $in: validIds } },
      { $pull: { exercises: { _id: { $in: validIds } } }, $inc: { __v: 1 } },
    );
    return { deletedCount: result.modifiedCount ? validIds.length : 0 };
  },
};
