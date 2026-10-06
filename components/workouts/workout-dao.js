const { default: mongoose } = require("mongoose");
const tableSchema = require("../tables/table-schema");
const workoutSchema = require("./workout-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const userSchema = require("../users/user-schema");
const { compactSet, SET_FIELDS } = require("../sets/set-schema");
const { isSamePermutation } = require("../util/permutation-util");
const { diffBlocks, applyBlockDiff } = require("./workout-row-blocks");
const { findRowSiblingWorkoutIds } = require("./workout-row-dao");
const { mutateWorkout } = require("./workout-store");
const { badRequest, notFound } = require("../util/http-error");
const {
  toId,
  plain,
  newId,
  isObjectId,
  exerciseRefOf,
  cloneExercise,
  cloneWorkout,
  reorderByIds,
} = require("./workout-tree");

// Sesiones (Workout) con sus ejercicios y series EMBEBIDOS (2026-10). Las
// sesiones de una rutina cuelgan de Table.splits[].workouts (ids en orden).

// Campos de la sesión que se pueden escribir desde modifyWorkout. Quedan
// fuera `_id`, `kind`, `createdAt` y `exercises`, que se trata aparte.
const WORKOUT_WRITABLE_FIELDS = new Set([
  "name",
  "notes",
  "clientNotes",
  "date",
  "order",
  "cronometer",
  "paused",
  "startedAt",
  "rest",
  "isPlannedRestDay",
  "readinessPre",
  "perceivedEffortPost",
  "sorenessPre",
  "blocks",
]);

async function populatedSplits(tableFilter) {
  const table = await tableSchema.findOne(tableFilter);
  return table ? table.splits : [];
}

// Tabla en plano (sin poblar) con los ids de las sesiones de cada microciclo.
async function leanTable(idTable) {
  if (!isObjectId(idTable)) return null;
  return tableSchema.findById(idTable).select("splits").lean();
}

// Posición de una sesión dentro de su microciclo (la "fila").
function rowIndexOf(table, idWorkout) {
  for (const split of table?.splits || []) {
    const index = (split.workouts || []).findIndex((w) => toId(w) === toId(idWorkout));
    if (index >= 0) return index;
  }
  return -1;
}

// Inserta/reescribe la lista de sesiones de varios microciclos de una tabla
// de forma atómica por microciclo (arrayFilters por _id), sin reescribir el
// resto del documento.
async function writeSplitWorkouts(idTable, workoutsBySplitId) {
  const ops = [...workoutsBySplitId.entries()].map(([splitId, workouts]) => ({
    updateOne: {
      filter: { _id: idTable },
      update: { $set: { "splits.$[split].workouts": workouts } },
      arrayFilters: [{ "split._id": new mongoose.Types.ObjectId(splitId) }],
    },
  }));
  if (ops.length) await tableSchema.bulkWrite(ops);
}

// Series que llegan dentro de un ejercicio nuevo: cada una con su
// contenido, que se guarda con un _id nuevo y en el orden recibido.
function incomingSets(sets) {
  return (Array.isArray(sets) ? sets : [])
    .filter((entry) => entry && typeof entry === "object" && SET_FIELDS.some((field) => entry[field] !== undefined))
    .map((entry, index) => {
      const { _id, donedAt, ...rest } = plain(entry);
      return compactSet({ order: index, ...rest, _id: newId() });
    });
}

module.exports = {
  async getWorkouts(page, limit) {
    return workoutSchema.find({}).skip(page * limit).limit(limit).exec();
  },

  // La sesión con el Exercise de cada ejercicio poblado (mongoose-autopopulate
  // no actúa sobre .lean()).
  async findWithExercises(id) {
    return workoutSchema.findById(id).populate("exercises.exercise").lean();
  },

  async getWorkoutById(id) {
    return workoutSchema.findById(id);
  },

  // Sustituye los ejercicios de `workoutToPaste` por una copia de los del
  // portapapeles (series incluidas, sin su ejecución) y copia sus notas.
  async pasteWorkout(workoutClipboard, workoutToPaste) {
    await mutateWorkout({ _id: workoutToPaste?._id }, () => ({
      exercises: (workoutClipboard?.exercises || []).map((customExercise) => cloneExercise(customExercise)),
      notes: workoutClipboard?.notes,
    }));
    return workoutSchema.findById(workoutToPaste?._id);
  },

  // Duplica la fila de `idWorkout` (la misma posición en todos los
  // microciclos) justo debajo de ella.
  async duplicateWorkoutRow(idTable, idWorkout, nameSuffix = "Copy") {
    const tableDoc = await tableSchema.findById(idTable);
    if (!tableDoc) throw new Error("Table not found");

    const workoutIndex = rowIndexOf(tableDoc, idWorkout);
    if (workoutIndex < 0) throw new Error("Workout not found in table");

    const clones = [];
    const workoutsBySplitId = new Map();
    tableDoc.splits.forEach((split) => {
      const workoutToCopy = split.workouts[workoutIndex];
      if (!workoutToCopy) throw new Error("Workout row is not complete in all splits");
      const clone = cloneWorkout(workoutToCopy, { nameSuffix });
      clones.push(clone);
      const ids = split.workouts.map((w) => w._id);
      ids.splice(workoutIndex + 1, 0, clone._id);
      workoutsBySplitId.set(toId(split), ids);
    });

    if (clones.length) await workoutSchema.insertMany(clones);
    await writeSplitWorkouts(tableDoc._id, workoutsBySplitId);
    return populatedSplits({ _id: idTable });
  },

  // Reemplaza Workout.blocks[] completo (crear/editar/borrar/reordenar
  // bloques en una sola llamada). `blocks` ya viene sanitizado desde el
  // controller (sanitizeWorkoutBlocks): aquí solo se resuelven los _id.
  async updateWorkoutBlocks(workoutId, blocks) {
    const normalizedBlocks = (blocks || []).map((block) => ({
      ...block,
      _id: isObjectId(block._id) ? new mongoose.Types.ObjectId(toId(block._id)) : newId(),
    }));

    let diff = null;
    const written = await mutateWorkout({ _id: workoutId }, (workout) => {
      diff = diffBlocks(workout.blocks || [], normalizedBlocks);
      const removed = new Set(diff.removedIds);
      return {
        blocks: normalizedBlocks,
        // Un ejercicio cuyo bloque se borró vuelve a quedar "suelto": nunca
        // debe apuntar a un blockId que ya no existe en este Workout.
        exercises: (workout.exercises || []).map((exercise) =>
          exercise.blockId && removed.has(toId(exercise.blockId)) ? { ...exercise, blockId: null } : exercise,
        ),
      };
    });
    if (!written) throw notFound("Workout no encontrado", "WORKOUT_NOT_FOUND");

    // Mismo cambio en el entrenamiento de la misma fila de los demás
    // microciclos (ver workout-row-blocks.js: solo casan los bloques que
    // comparten _id; los antiguos, locales, no se propagan).
    const siblingIds = await findRowSiblingWorkoutIds(workoutId);
    for (const siblingId of siblingIds) {
      await mutateWorkout({ _id: siblingId }, (sibling) => {
        const siblingBlockIds = new Set((sibling.blocks || []).map(toId));
        const removed = new Set(diff.removedIds.filter((id) => siblingBlockIds.has(id)));
        return {
          blocks: applyBlockDiff(sibling.blocks, diff),
          exercises: (sibling.exercises || []).map((exercise) =>
            exercise.blockId && removed.has(toId(exercise.blockId)) ? { ...exercise, blockId: null } : exercise,
          ),
        };
      });
    }

    // rowWorkouts: los demás microciclos ya actualizados, para que el
    // tablero los repinte sin recargar la tabla (la app de cliente lo ignora).
    const result = (await workoutSchema.findById(workoutId)).toObject();
    result.rowWorkouts = siblingIds.length ? await workoutSchema.find({ _id: { $in: siblingIds } }) : [];
    return result;
  },

  // Copia una sesión suelta a otro microciclo (o al mismo, como "duplicar
  // en el sitio").
  async copyWorkoutToSplit(workoutId, targetSplitId) {
    const workoutDoc = await workoutSchema.findById(workoutId);
    if (!workoutDoc) throw notFound("Entrenamiento no encontrado", "WORKOUT_NOT_FOUND");

    const table = await tableSchema.findOne({ "splits._id": targetSplitId }).select("_id").lean();
    if (!table) throw notFound("Split de destino no encontrado", "SPLIT_NOT_FOUND");

    const clone = cloneWorkout(workoutDoc);
    await workoutSchema.insertMany([clone]);
    await tableSchema.updateOne(
      { _id: table._id },
      { $push: { "splits.$[split].workouts": clone._id } },
      { arrayFilters: [{ "split._id": new mongoose.Types.ObjectId(toId(targetSplitId)) }] },
    );
    return populatedSplits({ _id: table._id });
  },

  // Reordena las sesiones DENTRO de un microciclo.
  async reorderWorkoutsInSplit(idSplit, workoutIdsOrder) {
    const table = await tableSchema.findOne({ "splits._id": idSplit }).select("splits").lean();
    const split = (table?.splits || []).find((candidate) => toId(candidate) === toId(idSplit));
    if (!split) throw notFound("Split no encontrado", "SPLIT_NOT_FOUND");

    const currentIds = (split.workouts || []).map(toId);
    const requestedIds = (Array.isArray(workoutIdsOrder) ? workoutIdsOrder : []).map(toId);
    if (!isSamePermutation(currentIds, requestedIds)) {
      throw badRequest(
        "workoutIdsOrder debe ser una permutación exacta de los workouts actuales",
        "INVALID_WORKOUT_ORDER",
      );
    }

    await writeSplitWorkouts(table._id, new Map([[toId(split), requestedIds.map((id) => new mongoose.Types.ObjectId(id))]]));
    return populatedSplits({ _id: table._id });
  },

  // Reordena las FILAS: la misma permutación en todos los microciclos.
  async reorderWorkoutRows(idTable, workoutIdsOrder) {
    const table = await leanTable(idTable);
    if (!table) throw new Error("Table not found");

    if (!Array.isArray(workoutIdsOrder) || workoutIdsOrder.length !== table.splits[0]?.workouts?.length) {
      throw new Error("Invalid workout order");
    }

    const requested = workoutIdsOrder.map(toId);
    const referenceSplit = table.splits.find((split) =>
      requested.every((id) => (split.workouts || []).some((w) => toId(w) === id)),
    );
    if (!referenceSplit) throw new Error("Workout order does not match table");

    const referenceIndexes = requested.map((id) => referenceSplit.workouts.findIndex((w) => toId(w) === id));
    if (referenceIndexes.some((index) => index < 0)) throw new Error("Workout order does not match table");

    await writeSplitWorkouts(
      table._id,
      new Map(
        table.splits.map((split) => [toId(split), referenceIndexes.map((index) => split.workouts[index]).filter(Boolean)]),
      ),
    );
    return populatedSplits({ _id: idTable });
  },

  // Añade una sesión nueva (o varias) al final de cada microciclo.
  async addWorkoutsToSplits(idTable, workouts) {
    const table = await leanTable(idTable);
    if (!table) throw new Error("Table not found");

    const toCreate = [];
    const workoutsBySplitId = new Map();
    for (const split of table.splits || []) {
      const created = (Array.isArray(workouts) ? workouts : [workouts]).map((data) => ({
        _id: newId(),
        name: data?.name,
        notes: data?.notes,
        clientNotes: data?.clientNotes,
        date: data?.date,
        cronometer: data?.cronometer,
        paused: data?.paused,
        isPlannedRestDay: data?.isPlannedRestDay,
        exercises: (data?.exercises || []).filter((exercise) => exercise?.exercise).map((exercise) => cloneExercise(exercise)),
      }));
      toCreate.push(...created);
      workoutsBySplitId.set(toId(split), [...(split.workouts || []), ...created.map((w) => w._id)]);
    }

    if (toCreate.length) await workoutSchema.insertMany(toCreate);
    await writeSplitWorkouts(table._id, workoutsBySplitId);
    return populatedSplits({ _id: idTable });
  },

  async addExerciseToWorkouts(workoutIds, exerciseId) {
    if (!Array.isArray(workoutIds) || workoutIds.length === 0) return [];
    const exercise = await exerciseSchema.findById(exerciseId);

    const result = [];
    for (const workoutId of workoutIds) {
      const customExercise = { _id: newId(), exercise: exerciseId, sets: [], notes: null };
      await mutateWorkout({ _id: workoutId }, (workout) => ({
        exercises: [...(workout.exercises || []), customExercise],
      }));
      result.push({ workoutId, customExercise: { ...customExercise, blockId: null, exercise } });
    }
    return result;
  },

  async modifyWorkout(workout) {
    const $set = {};
    const $unset = {};

    for (const key of Object.keys(workout || {})) {
      if (!WORKOUT_WRITABLE_FIELDS.has(key)) continue;
      // Parse date if it comes as ISO string
      $set[key] = key === "date" && typeof workout[key] === "string" ? new Date(workout[key]) : workout[key];
    }

    const has = (key) => Object.prototype.hasOwnProperty.call(workout || {}, key);
    const isBlank = (value) => value === null || value === undefined || value?.trim?.() === "";

    // Solo se vacían cuando llegan explícitamente vacíos.
    if (has("date") && workout.date === null) {
      delete $set.date;
      $unset.date = 1;
    }
    if (has("startedAt") && workout.startedAt === null) {
      delete $set.startedAt;
      $unset.startedAt = 1;
    }
    if (has("paused") && (workout.paused === null || workout.paused === undefined || workout.paused === false)) {
      delete $set.paused;
      $unset.paused = 1;
    }
    if (has("notes") && isBlank(workout.notes)) {
      delete $set.notes;
      $unset.notes = 1;
    }
    if (has("clientNotes") && isBlank(workout.clientNotes)) {
      delete $set.clientNotes;
      $unset.clientNotes = 1;
    }

    const update = { $inc: { __v: 1 } };
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    await workoutSchema.updateOne({ _id: workout?._id }, update);

    // `exercises` del cuerpo: antes se guardaba como lista de ids. Aquí solo
    // vale para REORDENAR (misma lista de ejercicios en otro orden): el
    // contenido que trae el cliente puede estar desfasado y nunca pisa lo
    // guardado, y una lista con ejercicios de menos no borra ninguno.
    if (Array.isArray(workout?.exercises)) {
      await mutateWorkout({ _id: workout._id }, (current) => {
        const currentIds = (current.exercises || []).map(toId);
        const requestedIds = workout.exercises.map(toId);
        if (!isSamePermutation(currentIds, requestedIds)) return null;
        if (currentIds.every((id, index) => id === requestedIds[index])) return null;
        return { exercises: reorderByIds(current.exercises, requestedIds) };
      });
    }

    return workoutSchema.findById(workout?._id);
  },

  async finishWorkout(workoutId, userId, date) {
    const finishDate = date ? new Date(date) : new Date();

    const [workoutDoc, userDoc] = await Promise.all([
      workoutSchema.findByIdAndUpdate(
        workoutId,
        { $set: { date: finishDate }, $unset: { paused: 1 }, $inc: { __v: 1 } },
        { new: true },
      ),
      userSchema.findByIdAndUpdate(userId, { $unset: { workoutInUse: 1, workoutInUseAt: 1 } }, { new: true }),
    ]);

    return { workout: workoutDoc, userUpdated: !!userDoc };
  },

  async skipWorkout(workoutId, userId, rest) {
    const update = rest
      ? { $set: { rest: true }, $unset: { date: 1, paused: 1 }, $inc: { __v: 1 } }
      : { $unset: { rest: 1 }, $inc: { __v: 1 } };

    const workoutDoc = await workoutSchema.findByIdAndUpdate(workoutId, update, { new: true });

    let userUpdated = false;
    if (rest) {
      const userDoc = await userSchema.findByIdAndUpdate(userId, { $unset: { workoutInUse: 1, workoutInUseAt: 1 } }, { new: true });
      userUpdated = !!userDoc;
    }

    return { workout: workoutDoc, userUpdated };
  },

  // Añade `customExercise` (nuevo) al final de la sesión. Antes esta ruta
  // reescribía además la sesión entera con la copia que tuviera la app; la
  // única pantalla que la usa (añadir ejercicio a una fila) solo necesita
  // añadirlo, y reescribir el resto pisaba cambios hechos entretanto.
  async updateWorkout(workout, customExercise) {
    const sets = incomingSets(customExercise?.sets);
    const created = {
      _id: newId(),
      exercise: exerciseRefOf(customExercise),
      order: customExercise?.order,
      notes: customExercise?.notes || undefined,
      blockId: isObjectId(customExercise?.blockId) ? customExercise.blockId : null,
      sets,
    };
    await mutateWorkout({ _id: workout?._id }, (current) => ({
      exercises: [...(current.exercises || []), created],
    }));
    return workoutSchema.findById(workout?._id);
  },

  // Crea el Exercise si llega como objeto (alta de un ejercicio propio desde
  // la propia sesión) y añade a la sesión el ejercicio con sus series.
  async addDataExerciseToWorkout(workoutId, dataExerciseData) {
    let exerciseId;
    if (dataExerciseData?.exercise && !dataExerciseData.exercise._id && typeof dataExerciseData.exercise === "object") {
      const exerciseDoc = await exerciseSchema.create(dataExerciseData.exercise);
      exerciseId = exerciseDoc._id;
    } else {
      exerciseId = dataExerciseData?.exercise?._id || dataExerciseData?.exercise;
    }

    const sets = incomingSets(dataExerciseData?.sets);
    const created = { _id: newId(), exercise: exerciseId, sets, notes: dataExerciseData?.notes || undefined };
    await mutateWorkout({ _id: workoutId }, (current) => ({
      exercises: [...(current.exercises || []), created],
    }));
    return workoutSchema.findById(workoutId);
  },

  // Reordena los ejercicios de la fila de `idWorkout` en todos los
  // microciclos. `newOrder` son posiciones: newOrder[i] = posición antigua del
  // ejercicio que pasa a ser el i-ésimo.
  async updateWorkoutsOrder(idWorkout, idTable, newOrder) {
    const table = await leanTable(idTable);
    const indexWorkout = rowIndexOf(table, idWorkout);
    if (indexWorkout < 0 || !Array.isArray(newOrder)) return { modifiedCount: 0 };

    let modifiedCount = 0;
    for (const split of table.splits || []) {
      const rowWorkoutId = split.workouts?.[indexWorkout];
      if (!rowWorkoutId) continue;
      const written = await mutateWorkout({ _id: rowWorkoutId }, (workout) => {
        const exercises = workout.exercises || [];
        const reordered = newOrder.map((index) => exercises[index]).filter(Boolean);
        return { exercises: reordered };
      });
      if (written) modifiedCount += 1;
    }
    return { modifiedCount };
  },

  // Cambia el Exercise de un ejercicio en la misma posición (fila y orden)
  // de todos los microciclos.
  async updateCustomExercises(idTable, idWorkout, idCustomExercise, idExercise) {
    const table = await leanTable(idTable);
    const exerciseDoc = await exerciseSchema.findById(idExercise).select("_id").lean();
    const indexWorkout = rowIndexOf(table, idWorkout);

    const rowWorkoutIds = (table?.splits || []).map((split) => split.workouts?.[indexWorkout]).filter(Boolean);
    const rowWorkouts = await workoutSchema
      .find({ _id: { $in: rowWorkoutIds } })
      .select("exercises._id")
      .lean();
    let indexCustomExercise = -1;
    for (const workout of rowWorkouts) {
      const index = (workout.exercises || []).findIndex((exercise) => toId(exercise) === toId(idCustomExercise));
      if (index >= 0) indexCustomExercise = index;
    }

    if (indexWorkout >= 0 && indexCustomExercise >= 0) {
      for (const workoutId of rowWorkoutIds) {
        await mutateWorkout({ _id: workoutId }, (workout) => {
          const exercises = workout.exercises || [];
          if (!exercises[indexCustomExercise]) return null;
          return {
            exercises: exercises.map((exercise, index) =>
              index === indexCustomExercise ? { ...exercise, exercise: exerciseDoc?._id ?? null } : exercise,
            ),
          };
        });
      }
    }

    return tableSchema.findById(idTable);
  },

  async updateWorkoutsName(idTable, idWorkout, workoutsName) {
    const table = await leanTable(idTable);
    const indexWorkout = rowIndexOf(table, idWorkout);
    if (indexWorkout < 0) return;
    const ids = (table.splits || []).map((split) => split.workouts?.[indexWorkout]).filter(Boolean);
    await workoutSchema.updateMany({ _id: { $in: ids } }, { $set: { name: workoutsName }, $inc: { __v: 1 } });
  },

  // Añade a la sesión destino una copia de los ejercicios (con sus series).
  async pasteExercises(tableId, sourceWorkoutId, targetWorkoutId, exercises) {
    const clones = (exercises || []).map((customExercise) => cloneExercise(customExercise));
    await mutateWorkout({ _id: targetWorkoutId }, (workout) => ({
      exercises: [...(workout.exercises || []), ...clones],
    }));
    return { tableInUse: await tableSchema.findById(tableId) };
  },

  // Vacía la sesión de ejercicios.
  async deleteWorkoutCustomExercises(id) {
    return workoutSchema.updateOne({ _id: id }, { $set: { exercises: [] }, $inc: { __v: 1 } });
  },

  async deleteWorkout(id) {
    return this.deleteWorkouts([{ _id: id }]);
  },

  // Quita las sesiones de sus microciclos y las borra.
  async deleteWorkouts(workouts) {
    const workoutIds = (workouts || [])
      .map((workout) => toId(workout?._id ?? workout))
      .filter(isObjectId)
      .map((id) => new mongoose.Types.ObjectId(id));
    if (!workoutIds.length) return { deletedCount: 0 };

    await tableSchema.updateMany(
      { "splits.workouts": { $in: workoutIds } },
      { $pull: { "splits.$[].workouts": { $in: workoutIds } } },
    );
    return workoutSchema.deleteMany({ _id: { $in: workoutIds } });
  },
};
