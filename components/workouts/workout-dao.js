const { default: mongoose } = require("mongoose");
const tableSchema = require("../tables/table-schema");
const workoutSchema = require("./workout-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const userSchema = require("../users/user-schema");
const { compactSet, SET_FIELDS } = require("../sets/set-schema");
const { isSamePermutation } = require("../util/permutation-util");
const { keepValidBlockIds, rekeyBlocks } = require("./workout-row-blocks");
const { findRowSiblingWorkoutIds } = require("./workout-row-dao");
const { mutateWorkout } = require("./workout-store");
const { notFound } = require("../util/http-error");
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
// fuera `_id`, `kind`, `createdAt`, `exercises`, que se trata aparte, y
// `blocks`: son de la fila y solo los escribe updateWorkoutBlocks.
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

// [2, 0, 1]: cada índice de 0 a n-1 exactamente una vez.
function isPermutation(order) {
  if (!Array.isArray(order)) return false;
  const seen = new Set(order);
  return seen.size === order.length && order.every((index) => Number.isInteger(index) && index >= 0 && index < order.length);
}

// El Exercise de cada ejercicio, en orden: identifica la "misma fila" en
// otro microciclo (los CustomExercise tienen _id distinto en cada uno).
function exerciseRefsOf(exercises) {
  return (exercises || []).map((customExercise) => String(toId(customExercise?.exercise) || ""));
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

  // Las sesiones de UN microciclo, igual de pobladas (carga semanal del
  // planificador). La tabla en .lean(): `workouts` llega como ids.
  async findSplitWorkoutsWithExercises(splitId) {
    if (!isObjectId(splitId)) return [];
    const table = await tableSchema.findOne({ "splits._id": splitId }).select("splits._id splits.workouts").lean();
    const split = (table?.splits || []).find((item) => String(item._id) === String(splitId));
    const ids = (split?.workouts || []).map(toId).filter(Boolean);
    if (!ids.length) return [];
    return workoutSchema.find({ _id: { $in: ids } }).populate("exercises.exercise").lean();
  },

  async getWorkoutById(id) {
    return workoutSchema.findById(id);
  },

  // Sustituye los ejercicios de `workoutToPaste` por una copia de los del
  // portapapeles (series incluidas, sin su ejecución) y copia sus notas.
  // Los bloques del destino no cambian (son de su fila): un ejercicio pegado
  // solo conserva su bloque si el destino lo tiene.
  async pasteWorkout(workoutClipboard, workoutToPaste) {
    await mutateWorkout({ _id: workoutToPaste?._id }, (workout) => ({
      exercises: keepValidBlockIds(
        (workoutClipboard?.exercises || []).map((customExercise) => cloneExercise(customExercise)),
        workout.blocks,
      ),
      notes: workoutClipboard?.notes,
    }));
    return workoutSchema.findById(workoutToPaste?._id);
  },

  // Duplica la fila de `idWorkout` (la misma posición en todos los
  // microciclos) justo debajo de ella. La fila nueva estrena sus bloques:
  // _id nuevos, los mismos en todos sus microciclos (workout-row-blocks.js).
  async duplicateWorkoutRow(idTable, idWorkout, nameSuffix = "Copy") {
    const tableDoc = await tableSchema.findById(idTable);
    if (!tableDoc) throw new Error("Table not found");

    const workoutIndex = rowIndexOf(tableDoc, idWorkout);
    if (workoutIndex < 0) throw new Error("Workout not found in table");

    const clones = [];
    const workoutsBySplitId = new Map();
    let rowBlocks = null;
    tableDoc.splits.forEach((split) => {
      const workoutToCopy = split.workouts[workoutIndex];
      if (!workoutToCopy) throw new Error("Workout row is not complete in all splits");
      const clone = cloneWorkout(workoutToCopy, { nameSuffix });
      rowBlocks ??= rekeyBlocks(clone.blocks, newId);
      clone.blocks = rowBlocks.blocks.map((block) => ({ ...block }));
      clone.exercises = rowBlocks.remapExercises(clone.exercises);
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
  // bloques en una sola llamada) en TODA la fila: los bloques son de la fila
  // (workout-row-blocks.js), así que la misma lista se escribe en el
  // entrenamiento de esa posición de cada microciclo. `blocks` ya viene
  // sanitizado desde el controller (sanitizeWorkoutBlocks); los nuevos nacen
  // aquí con un _id que comparte toda la fila. Un ejercicio cuyo bloque
  // desaparece queda suelto en cada microciclo.
  async updateWorkoutBlocks(workoutId, blocks) {
    const rowBlocks = (blocks || []).map((block) => ({
      ...block,
      _id: isObjectId(block._id) ? new mongoose.Types.ObjectId(toId(block._id)) : newId(),
    }));
    const withRowBlocks = (workout) => ({
      blocks: rowBlocks,
      exercises: keepValidBlockIds(workout.exercises, rowBlocks),
    });

    const written = await mutateWorkout({ _id: workoutId }, withRowBlocks);
    if (!written) throw notFound("Workout no encontrado", "WORKOUT_NOT_FOUND");

    const siblingIds = await findRowSiblingWorkoutIds(workoutId);
    for (const siblingId of siblingIds) {
      await mutateWorkout({ _id: siblingId }, withRowBlocks);
    }

    // rowWorkouts: los demás microciclos ya actualizados, para que el
    // tablero los repinte sin recargar la tabla (la app de cliente lo ignora).
    const result = (await workoutSchema.findById(workoutId)).toObject();
    result.rowWorkouts = siblingIds.length ? await workoutSchema.find({ _id: { $in: siblingIds } }) : [];
    return result;
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

    // Una fila nueva por cada entrenamiento recibido: sus bloques, con _id
    // nuevos COMPARTIDOS por toda la fila (workout-row-blocks.js), se calculan
    // una sola vez; cada microciclo recibe su copia de los ejercicios.
    const rows = (Array.isArray(workouts) ? workouts : [workouts]).map((data) => {
      const { blocks, remapExercises } = rekeyBlocks(data?.blocks, newId);
      const exercises = remapExercises((data?.exercises || []).filter((exercise) => exercise?.exercise));
      return { data, blocks, exercises };
    });

    const toCreate = [];
    const workoutsBySplitId = new Map();
    for (const split of table.splits || []) {
      const created = rows.map(({ data, blocks, exercises }) => ({
        _id: newId(),
        name: data?.name,
        notes: data?.notes,
        clientNotes: data?.clientNotes,
        date: data?.date,
        cronometer: data?.cronometer,
        paused: data?.paused,
        isPlannedRestDay: data?.isPlannedRestDay,
        blocks: blocks.map((block) => ({ ...block })),
        exercises: exercises.map((exercise) => cloneExercise(exercise)),
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

    // Solo si la sesión en curso era ESTA (como ya hace el front): saltar
    // otro día no debe cortar el entrenamiento que el cliente tiene abierto.
    let userUpdated = false;
    if (rest && userId) {
      const userDoc = await userSchema.findOneAndUpdate(
        { _id: userId, workoutInUse: workoutId },
        { $unset: { workoutInUse: 1, workoutInUseAt: 1 } },
        { new: true },
      );
      userUpdated = !!userDoc;
    }

    return { workout: workoutDoc, userUpdated };
  },

  // Añade `customExercise` (nuevo) al final de la sesión. Antes esta ruta
  // reescribía además la sesión entera con la copia que tuviera la app; la
  // única pantalla que la usa (añadir ejercicio a una fila) solo necesita
  // añadirlo, y reescribir el resto pisaba cambios hechos entretanto. Su
  // blockId solo se guarda si el bloque es de esa sesión.
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
      exercises: [...(current.exercises || []), ...keepValidBlockIds([created], current.blocks)],
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

  // Reordena los ejercicios de una sesión y de la misma fila en los demás
  // microciclos. `newOrder[posición] = índice original`, y tiene que ser una
  // permutación completa. Solo se tocan las hermanas con los mismos
  // ejercicios en el mismo orden que tenía el origen (aplicar la permutación
  // a otra lista perdería o desordenaría ejercicios); el resto se queda como
  // estaba. rowWorkouts: las hermanas ya reordenadas, para repintarlas sin
  // recargar.
  async updateWorkoutsOrder(idWorkout, idTable, newOrder) {
    const table = await leanTable(idTable);
    const indexWorkout = rowIndexOf(table, idWorkout);
    if (indexWorkout < 0 || !isPermutation(newOrder)) return { modifiedCount: 0, rowWorkouts: [] };

    const origin = await workoutSchema.findById(idWorkout).select("exercises.exercise").lean();
    const originRefs = exerciseRefsOf(origin?.exercises);
    if (originRefs.length !== newOrder.length) return { modifiedCount: 0, rowWorkouts: [] };

    let modifiedCount = 0;
    const touchedSiblings = [];
    for (const split of table.splits || []) {
      const rowWorkoutId = split.workouts?.[indexWorkout];
      if (!rowWorkoutId) continue;
      const isOrigin = toId(rowWorkoutId) === toId(idWorkout);
      // mutateWorkout devuelve el documento también cuando no escribe nada.
      let reordered = false;
      await mutateWorkout({ _id: rowWorkoutId }, (workout) => {
        reordered = false;
        const exercises = workout.exercises || [];
        if (exercises.length !== newOrder.length) return null;
        if (!isOrigin && exerciseRefsOf(exercises).join() !== originRefs.join()) return null;
        reordered = true;
        return { exercises: newOrder.map((index) => exercises[index]) };
      });
      if (!reordered) continue;
      modifiedCount += 1;
      if (!isOrigin) touchedSiblings.push(rowWorkoutId);
    }
    const rowWorkouts = touchedSiblings.length
      ? await workoutSchema.find({ _id: { $in: touchedSiblings } })
      : [];
    return { modifiedCount, rowWorkouts };
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
  // Se pega también en la misma fila de los demás microciclos, como añadir
  // un ejercicio o editar bloques (findRowSiblingWorkoutIds), salvo en la
  // sesión de origen: copiar de M1 a M2 en el mismo día no debe duplicar M1.
  // Cada destino recibe sus propios clones (ids nuevos); un ejercicio solo
  // conserva su bloque si el destino lo tiene (misma fila: siempre).
  async pasteExercises(tableId, sourceWorkoutId, targetWorkoutId, exercises) {
    const siblingIds = await findRowSiblingWorkoutIds(targetWorkoutId);
    const destinations = [targetWorkoutId, ...siblingIds.filter((id) => toId(id) !== toId(sourceWorkoutId))];
    for (const destinationId of destinations) {
      await mutateWorkout({ _id: destinationId }, (workout) => {
        const clones = keepValidBlockIds((exercises || []).map((customExercise) => cloneExercise(customExercise)), workout.blocks);
        return { exercises: [...(workout.exercises || []), ...clones] };
      });
    }
    return { tableInUse: await tableSchema.findById(tableId) };
  },

  // Vacía la sesión de ejercicios.
  async deleteWorkoutCustomExercises(id) {
    return workoutSchema.updateOne({ _id: id }, { $set: { exercises: [] }, $inc: { __v: 1 } });
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
