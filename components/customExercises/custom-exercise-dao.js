const customExerciseSchema = require("./custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const setSchema = require("../sets/set-schema");
const { normalizeSetsOrder } = require("../sets/set-order-util");
const { default: mongoose } = require("mongoose");
const { findRowSiblingWorkoutIds } = require("../workouts/workout-row-dao");
const { pickRowExercise } = require("../workouts/workout-row-blocks");

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
  // DEPRECATED: reemplazados por time/expectedTime. Mantenidos temporalmente
  // (rollout en fases, hay apps viejas instaladas) — quitar junto con los
  // campos del schema en la release de limpieza posterior.
  "timeMin",
  "timeSec",
  "expectedMin",
  "expectedSec",
  "time",
  "expectedTime",
  "distance",
  "expectedDistance",
  "velocity",
  "order",
];

function plainSet(set) {
  if (!set) return {};
  const value = typeof set.toObject === "function" ? set.toObject() : { ...set };
  delete value.__v;
  delete value.displayOrder;
  return value;
}

function getSetId(set) {
  const id = set?._id ?? set;
  return id == null ? null : id.toString();
}

function isTemporarySetId(id) {
  return id != null && !Number.isNaN(Number(id));
}

function buildSetUpdate(set) {
  const updateOperation = {};
  const unsetOperation = {};

  SET_UPDATE_FIELDS.forEach((field) => {
    const value = set[field];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    if (value === null || value === undefined || isEmptyArray) {
      unsetOperation[field] = "";
    } else {
      updateOperation[field] = value;
    }
  });

  const update = {};
  if (Object.keys(updateOperation).length > 0) update.$set = updateOperation;
  if (Object.keys(unsetOperation).length > 0) update.$unset = unsetOperation;
  return update;
}

async function normalizeAndPersistCustomExerciseSets(customExerciseOrId) {
  const shouldFetch =
    typeof customExerciseOrId === "string" ||
    customExerciseOrId instanceof mongoose.Types.ObjectId;
  const customExercise = shouldFetch
    ? await customExerciseSchema.findById(customExerciseOrId)
    : customExerciseOrId;

  if (!customExercise) return customExercise;

  const normalizedSets = normalizeSetsOrder(
    (customExercise.sets || []).map(plainSet),
  );

  const bulkOps = normalizedSets
    .map((setTemp) => {
      const setId = getSetId(setTemp);
      if (!mongoose.Types.ObjectId.isValid(setId)) return null;

      const update = buildSetUpdate(setTemp);
      if (Object.keys(update).length === 0) return null;

      return {
        updateOne: {
          filter: { _id: mongoose.Types.ObjectId(setId) },
          update,
        },
      };
    })
    .filter(Boolean);

  if (bulkOps.length > 0) {
    await setSchema.bulkWrite(bulkOps);
  }

  await customExerciseSchema.findByIdAndUpdate(customExercise._id, {
    $set: { sets: normalizedSets.map((setTemp) => setTemp._id) },
  });

  return customExerciseSchema.findById(customExercise._id);
}

module.exports = {
  async findCustomExerciseById(id) {
    return new Promise((resolve, reject) =>
      customExerciseSchema.findById(id).exec((err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  // Para cuando cree Creación de customExercise
  // if (!customExercise._id) {
  //   customExercise.sets = await setSchema.insertMany(setsToCreate);
  //   customExercise = await customExerciseSchema.create(customExercise);

  //   return customExercise;
  // }
  async updateCustomExercise(
    customExercise,
    setsToCreate,
    setsToUpdate,
    setsToDelete,
  ) {
    try {
      const setsToDeleteIds = new Set((setsToDelete || []).map(getSetId));
      const createByTempId = new Map();
      const newIds = new Set();

      (setsToCreate || []).forEach((setCreateTemp) => {
        const createSet = plainSet(setCreateTemp);
        const tempId = getSetId(createSet);
        const newId = new mongoose.Types.ObjectId();

        createSet._id = newId;
        createByTempId.set(tempId, createSet);
        newIds.add(newId.toString());
      });

      const finalSets = (customExercise.sets || [])
        .map((setTemp) => {
          const currentSet = plainSet(setTemp);
          const currentId = getSetId(currentSet);

          if (setsToDeleteIds.has(currentId)) {
            return null;
          }

          if (isTemporarySetId(currentId) && createByTempId.has(currentId)) {
            return {
              ...createByTempId.get(currentId),
              ...currentSet,
              _id: createByTempId.get(currentId)._id,
            };
          }

          if (!currentId || isTemporarySetId(currentId)) {
            const newId = new mongoose.Types.ObjectId();
            newIds.add(newId.toString());
            return {
              ...currentSet,
              _id: newId,
            };
          }

          return currentSet;
        })
        .filter(Boolean)
        .map((setTemp, index) => ({
          ...setTemp,
          order: index,
        }));

      const bulkOps = [];

      finalSets.forEach((setTemp) => {
        const setId = getSetId(setTemp);
        const cleanSet = plainSet(setTemp);

        if (newIds.has(setId)) {
          bulkOps.push({
            insertOne: {
              document: cleanSet,
            },
          });
          return;
        }

        const update = buildSetUpdate(cleanSet);
        if (Object.keys(update).length === 0) {
          return;
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: mongoose.Types.ObjectId(setId) },
            update,
          },
        });
      });

      if (bulkOps.length > 0) {
        await setSchema.bulkWrite(bulkOps);
      }

      const persistedSetIdsToDelete = Array.from(setsToDeleteIds).filter((id) =>
        mongoose.Types.ObjectId.isValid(id),
      );

      if (persistedSetIdsToDelete.length > 0) {
        await setSchema.deleteMany({
          _id: { $in: persistedSetIdsToDelete },
        });
      }

      const setsUpdated = finalSets.map((setTemp) => setTemp._id);
      const queryUpdate = { $set: { sets: setsUpdated } };

      // Nota del ENTRENADOR. Se mantiene tal cual estaba: ausente o vacía
      // borra el campo. No es un descuido — el planificador borra una nota
      // con `delete customExercise.notes` (workout.component.ts
      // #updateExerciseNote) y luego manda el objeto, así que "ausente"
      // significa ahí "bórrala". Cambiarlo por hasOwnProperty dejaría de
      // poder borrarse ninguna nota del entrenador.
      if (!customExercise.notes || customExercise.notes?.trim() === "")
        queryUpdate.$unset = { notes: 1 };
      else queryUpdate.$set.notes = customExercise.notes;

      // Movimiento 2 Coach Pro — nota del CLIENTE, campo aparte para que
      // ninguno de los dos pise al otro.
      //
      // Aquí SÍ se mira hasOwnProperty, al revés que arriba: este campo es
      // nuevo, así que hay objetos en memoria y en peticiones de versiones
      // anteriores de la app que no lo traen. Con la regla de arriba, cada
      // uno de esos guardados borraría la nota del cliente sin que nadie lo
      // pidiera. Para vaciarla se manda la cadena vacía, que es lo que hace
      // la pantalla del cliente.
      if (Object.prototype.hasOwnProperty.call(customExercise, "clientNotes")) {
        const clientNotes = customExercise.clientNotes;
        if (!clientNotes || String(clientNotes).trim() === "") {
          queryUpdate.$unset = { ...(queryUpdate.$unset || {}), clientNotes: 1 };
        } else {
          queryUpdate.$set.clientNotes = clientNotes;
        }
      }

      await customExerciseSchema.findByIdAndUpdate(
        customExercise._id,
        queryUpdate,
        { new: true },
      );

      return await customExerciseSchema.findById(customExercise._id);
    } catch (err) {
      throw err;
    }
  },

  async addSetToCustomExercise(id, set) {
    try {
      const newSet = await setSchema.create(set);
      await customExerciseSchema.findByIdAndUpdate(id, {
        $push: { sets: newSet._id },
      });

      return normalizeAndPersistCustomExerciseSets(id);
    } catch (err) {
      throw err;
    }
  },

  async copySetOnCustomExercise(order, customExercise) {
    try {
      const newSetId = new mongoose.Types.ObjectId();
      const normalizedSets = normalizeSetsOrder(
        (customExercise.sets || []).map((setTemp) => {
          const currentSet = plainSet(setTemp);
          if (!currentSet._id) currentSet._id = newSetId;
          return currentSet;
        }),
      );

      const newSet = normalizedSets.find(
        (setTemp) => getSetId(setTemp) === newSetId.toString(),
      );
      if (!newSet) {
        throw new Error("No set to copy found in custom exercise payload");
      }

      const bulkOps = [];

      bulkOps.push({
        insertOne: {
          document: newSet,
        },
      });

      normalizedSets.forEach((sTemp) => {
        const setId = getSetId(sTemp);
        if (setId === newSetId.toString()) return;

        const update = buildSetUpdate(sTemp);
        if (Object.keys(update).length === 0) return;

        bulkOps.push({
          updateOne: {
            filter: { _id: sTemp._id },
            update,
          },
        });
      });

      const bulkOpsCE = [];

      bulkOpsCE.push({
        updateOne: {
          filter: { _id: customExercise._id },
          update: {
            $set: { sets: normalizedSets.map((sTemp) => sTemp._id) },
          },
        },
      });

      await setSchema.bulkWrite(bulkOps);
      await customExerciseSchema.bulkWrite(bulkOpsCE);

      const customExerciseDoc = await customExerciseSchema.findById(
        customExercise._id,
      );
      return customExerciseDoc;
    } catch (err) {
      throw err;
    }
  },

  // Rediseño de entrenamiento Fase B — asigna/quita el blockId de un
  // CustomExercise. Valida que el blockId exista de verdad en Workout.blocks[]
  // del entrenamiento que contiene este ejercicio (nunca confiar en un id
  // suelto del body, mismo criterio que ya aplica assertCanAccessCustomExerciseId).
  async setCustomExerciseBlock(id, blockId) {
    if (blockId) {
      const workout = await workoutSchema.findOne({ exercises: id }).select("blocks");
      if (!workout) {
        const err = new Error("Ejercicio no encontrado");
        err.code = "CUSTOM_EXERCISE_NOT_FOUND";
        throw err;
      }
      const blockExists = (workout.blocks || []).some(
        (block) => block._id.toString() === blockId.toString(),
      );
      if (!blockExists) {
        const err = new Error("El bloque no existe en este entrenamiento");
        err.code = "BLOCK_NOT_FOUND";
        throw err;
      }
    }

    const updated = await customExerciseSchema.findByIdAndUpdate(
      id,
      { $set: { blockId: blockId || null } },
      { new: true },
    );
    if (!updated) return updated;

    // 2026-09 — el mismo ejercicio de la misma fila en los demás
    // microciclos entra o sale del mismo bloque. Solo donde ese bloque
    // existe (un bloque antiguo, local, no está en los demás).
    const origin = await workoutSchema.findOne({ exercises: id }).select("exercises").lean();
    const originIndex = (origin?.exercises || []).findIndex((e) => e.toString() === id.toString());
    const siblingIds = origin ? await findRowSiblingWorkoutIds(origin._id) : [];
    const siblings = await workoutSchema
      .find({ _id: { $in: siblingIds } })
      .select("blocks exercises")
      .lean();
    const rowUpdates = [];
    for (const sibling of siblings) {
      if (blockId && !(sibling.blocks || []).some((b) => b._id.toString() === blockId.toString())) {
        continue;
      }
      const siblingExercises = await customExerciseSchema
        .find({ _id: { $in: sibling.exercises } })
        .select("exercise")
        .lean();
      const byId = new Map(siblingExercises.map((e) => [e._id.toString(), e]));
      const ordered = (sibling.exercises || []).map((e) => byId.get(e.toString())).filter(Boolean);
      const target = pickRowExercise(originIndex, updated.exercise, ordered);
      if (!target) continue;
      await customExerciseSchema.updateOne({ _id: target._id }, { $set: { blockId: blockId || null } });
      rowUpdates.push({ _id: target._id, blockId: blockId || null });
    }

    // rowUpdates: qué ejercicios de los demás microciclos cambiaron, para
    // repintarlos sin recargar (la app de cliente lo ignora).
    return { ...updated.toObject(), rowUpdates };
  },

  // 2026-09 — vía dedicada para la nota del CLIENTE, separada de
  // updateCustomExercise (que sí queda bloqueado en rutinas asignadas).
  // Mismo criterio de vaciar-con-cadena-vacía que ya usaba updateCustomExercise
  // para este mismo campo (ver comentario ahí: la pantalla del cliente manda
  // "" para vaciar la nota, no ausencia del campo).
  async updateClientNotes(id, clientNotes) {
    const trimmed = (clientNotes || "").toString().trim();
    const update = trimmed
      ? { $set: { clientNotes: trimmed } }
      : { $unset: { clientNotes: 1 } };
    return customExerciseSchema.findByIdAndUpdate(id, update, { new: true });
  },

  async deleteCustomExercise(id) {
    try {
      const customExercise = await customExerciseSchema.findById(id);

      // Obtén los IDs de los conjuntos asociados
      const setIds = customExercise.sets.map((set) => set._id);

      // Elimina los conjuntos asociados
      await setSchema.deleteMany({ _id: { $in: setIds } });

      // Elimina los CustomExercises
      const result = await customExerciseSchema.deleteOne({ _id: id });
      return result;
    } catch (err) {
      throw err;
    }
  },

  async deleteCustomExercises(ids) {
    try {
      // Busca los CustomExercises que se van a eliminar
      const customExercises = await customExerciseSchema.find({
        _id: { $in: ids },
      });

      // Obtén los IDs de los conjuntos asociados
      const setIds = customExercises.flatMap((exercise) =>
        exercise.sets.map((set) => set._id),
      );

      // Elimina los conjuntos asociados
      await setSchema.deleteMany({ _id: { $in: setIds } });

      // Elimina los CustomExercises
      const result = await customExerciseSchema.deleteMany({
        _id: { $in: ids },
      });
      return result;
    } catch (err) {
      throw err;
    }
  },
};
