const workoutModel = require("./workout-service");
const tableSchema = require("../tables/table-schema");
const tableAccess = require("../tables/table-access");
const { sanitizeSoreness } = require("./soreness-catalog");
const { noteAuthorRole, stripForeignWorkoutNotes } = require("../tables/note-authorship");
const { withPinnedNotesSync } = require("../pinnedExerciseNotes/pinned-exercise-note-anchor-sync");

const BLOCK_TYPES = new Set(["straight", "superset", "circuit", "warmup", "finisher"]);

function toFiniteOrNull(value) {
  // Number(null) === 0 y Number("") === 0 — hay que descartar "sin valor"
  // ANTES de convertir, si no un rounds/restPause ausente se guardaría como 0
  // (mismo bug evitado en workoutTemplates/workout-template-controller.js).
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Rediseño de entrenamiento Fase B — sanitiza blocks[] antes de reemplazar
// Workout.blocks. Exportada para test. A diferencia de
// workoutTemplates/workout-template-controller.js#sanitizeBlocks, aquí NO
// hay exercises[] anidados: las exercises ya son CustomExercise reales,
// referenciadas por blockId, no contenido embebido en el bloque.
function sanitizeWorkoutBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) => ({
    _id: block?._id,
    name: (block?.name || "").toString().trim().slice(0, 100),
    type: BLOCK_TYPES.has(block?.type) ? block.type : "straight",
    order: Number.isFinite(Number(block?.order)) ? Number(block.order) : index,
    rounds: toFiniteOrNull(block?.rounds),
    restBetweenExercises: toFiniteOrNull(block?.restBetweenExercises),
    restBetweenRounds: toFiniteOrNull(block?.restBetweenRounds),
    instructions: (block?.instructions || "").toString().trim().slice(0, 500),
  }));
}

// Replanteamiento MVP (rutinas) — este módulo no comprobaba propiedad en
// NINGÚN endpoint (a diferencia de split-controller.js). Se cierra ahora al
// abrir el módulo a "trainer": mismo criterio en todos los sitios (dueño
// real, admin, o profesional con relación "training" activa con el dueño).
async function assertCanAccessTableId(req, res, idTable) {
  const table = await tableSchema.findById(idTable).select("_id userId assignedByTrainerId");
  if (!table) {
    res.status(404).send({ message: "Rutina no encontrada" });
    return null;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).send({ message: "No tienes permiso para esta rutina" });
    return null;
  }
  return table;
}

// 2026-09 — notes (entrenador) y clientNotes (cliente): cada uno escribe solo
// la suya, ver tables/note-authorship.js.
function stripForeignNotes(req, table, workout) {
  return stripForeignWorkoutNotes(workout, {
    authorRole: noteAuthorRole(req.user.id, table.userId),
    trainerManaged: Boolean(table.assignedByTrainerId),
  });
}

async function assertCanAccessWorkoutId(req, res, idWorkout) {
  const table = await tableAccess.findTableOwningWorkout(idWorkout);
  if (!table) {
    res.status(404).send({ message: "Entrenamiento no encontrado" });
    return null;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).send({ message: "No tienes permiso para este entrenamiento" });
    return null;
  }
  return table;
}

// Lo que el dueño de una rutina ASIGNADA puede escribir por modifyWorkout:
// solo el estado de su sesión (fecha, cronómetro, readiness, agujetas, sus
// notas…), nunca la estructura que pautó el entrenador (ejercicios, bloques,
// nombre, orden, descanso pautado). current-workout.page.ts manda el
// workout entero por esta ruta, así que lo demás se descarta en silencio.
const ASSIGNED_OWNER_WORKOUT_FIELDS = new Set([
  "_id",
  "date",
  "paused",
  "startedAt",
  "cronometer",
  "rest",
  "readinessPre",
  "perceivedEffortPost",
  "sorenessPre",
  "clientNotes",
]);

function isAssignedTableOwner(req, table) {
  return Boolean(table?.assignedByTrainerId)
    && !tableAccess.isAdmin(req)
    && String(req.user?.id) === String(table.userId);
}

function pickAssignedOwnerWorkoutFields(body) {
  return Object.fromEntries(
    Object.entries(body || {}).filter(([key]) => ASSIGNED_OWNER_WORKOUT_FIELDS.has(key)),
  );
}

module.exports = {
  // Función pura exportada para test (workout-controller.test.js).
  sanitizeWorkoutBlocks,

  async getWorkouts(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const workouts = await workoutModel.getWorkouts(
      page,
      limit,
      req.params.search,
    );
    return res.send(workouts);
  },

  async getWorkoutById(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.id))) return;
    const workout = await workoutModel.getWorkoutById(req.params.id);
    return res.send(workout);
  },

  async pasteWorkout(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.body?.workoutToPaste?._id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const workout = await withPinnedNotesSync(table._id, () =>
      workoutModel.pasteWorkout(req.body.workoutClipboard, req.body.workoutToPaste),
    );
    return res.send(workout);
  },

  async duplicateWorkoutRow(req, res) {
    const table = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const splits = await withPinnedNotesSync(table._id, () =>
      workoutModel.duplicateWorkoutRow(
        req.params.idTable,
        req.params.idWorkout,
        req.body?.nameSuffix,
      ),
    );
    return res.send(splits);
  },

  async reorderWorkoutRows(req, res) {
    const table = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const splits = await withPinnedNotesSync(table._id, () =>
      workoutModel.reorderWorkoutRows(req.params.idTable, req.body?.workoutIdsOrder),
    );
    return res.send(splits);
  },

  async addWorkoutsToSplits(req, res) {
    const tableForAccess = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!tableForAccess) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, tableForAccess)) return;
    const table = await workoutModel.addWorkoutsToSplits(req.params.idTable, req.body);
    return res.send(table);
  },

  async addExerciseToWorkouts(req, res) {
    const { workoutIds, exerciseId } = req.body;
    for (const idWorkout of workoutIds || []) {
      const table = await assertCanAccessWorkoutId(req, res, idWorkout);
      if (!table) return;
      if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    }
    const result = await workoutModel.addExerciseToWorkouts(workoutIds, exerciseId);
    return res.send(result);
  },

  async getWorkoutByIdAndDate(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.id))) return;
    const workout = await workoutModel.getWorkoutByIdAndDate(
      req.params.id,
      req.body.date,
    );
    return res.send(workout);
  },

  async createWorkout(req, res) {
    const workout = await workoutModel.createWorkout({
      name: req.body.name,
      date: req.body.date,
      exercises: req.body.exercises,
      isPlannedRestDay: req.body.isPlannedRestDay,
    });
    return res.send(workout);
  },

  // Bug preexistente cerrado de paso (2026-09): este endpoint no comprobaba
  // propiedad en absoluto — cualquier usuario autenticado podía añadir un
  // ejercicio a un workout ajeno. Mismo chequeo de 3 líneas que ya usan
  // los demás endpoints de este archivo.
  async addWorkoutExercise(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.idWorkout);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const workout = await workoutModel.addWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise,
    );
    return res.send(workout);
  },

  async addWorkoutsExercises(req, res) {
    const tableForAccess = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!tableForAccess) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, tableForAccess)) return;
    const table = await workoutModel.addWorkoutsExercises(
      req.params.idTable,
      req.params.idExercise,
      req.params.workoutOrder,
    );
    return res.send(table);
  },

  // 2026-09 — SIN rejectIfAssignedTableLockedForOwner, a propósito (pero con
  // lista blanca para el dueño de una tabla asignada, 2026-10). Bug real
  // encontrado al probar: modifyWorkout escribe CUALQUIER campo que venga en
  // el body ($set literal, sin lista blanca — workout-dao.js#modifyWorkout,
  // "for (const key in workout) update.$set[key] = workout[key]"), y
  // current-workout.page.ts lo usa para guardar readinessPre/
  // perceivedEffortPost/sorenessPre/startedAt/paused — el estado de la
  // sesión EN CURSO del propio cliente. Bloquearlo le impedía puntuar cómo
  // se sentía o arrancar el cronómetro en una rutina asignada: peor que el
  // problema original. Mismo criterio que set-controller.js#updateSet — un
  // cliente con rutina asignada tiene que poder seguir entrenándola. Desde
  // 2026-10 ese cliente solo escribe ASSIGNED_OWNER_WORKOUT_FIELDS: antes
  // podía vaciar los ejercicios de un entreno asignado por esta ruta.
  async modifyWorkout(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.body?._id);
    if (!table) return;

    // Movimiento 2 Coach Pro — las agujetas viajan por aquí (junto a
    // readinessPre, en el mismo guardado que arranca la sesión), así que se
    // saneen aquí mismo. modifyWorkout escribe con $set y sin
    // runValidators, de modo que los min/max del esquema no llegarían a
    // ejecutarse: mismo motivo por el que ya existe sanitizeWorkoutBlocks.
    let body = stripForeignNotes(req, table, req.body);
    if (isAssignedTableOwner(req, table)) body = pickAssignedOwnerWorkoutFields(body);
    if (Object.prototype.hasOwnProperty.call(body, "sorenessPre")) {
      body.sorenessPre = sanitizeSoreness(body.sorenessPre);
    }

    const workout = await workoutModel.modifyWorkout(body);
    return res.send(workout);
  },

  // POST /workouts/:idWorkout/copy-to-split/:idSplit — Planificador visual
  // (Fase C). Copia un workout suelto a otra semana (o a la misma, como
  // "duplicar en el sitio"). Verifica que el split de destino pertenece a la
  // MISMA tabla que el workout origen — nunca confiar en un idSplit suelto
  // del body/params (mismo criterio que el resto de este controller).
  async copyWorkoutToSplit(req, res) {
    const sourceTable = await assertCanAccessWorkoutId(req, res, req.params.idWorkout);
    if (!sourceTable) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, sourceTable)) return;

    const targetTable = await tableAccess.findTableOwningSplit(req.params.idSplit);
    if (!targetTable) return res.status(404).send({ message: "Split de destino no encontrado" });
    if (targetTable._id.toString() !== sourceTable._id.toString()) {
      return res.status(403).send({ message: "El split de destino no pertenece a esta rutina" });
    }

    try {
      const splits = await workoutModel.copyWorkoutToSplit(req.params.idWorkout, req.params.idSplit);
      return res.status(201).send(splits);
    } catch (e) {
      if (e.code === "WORKOUT_NOT_FOUND" || e.code === "SPLIT_NOT_FOUND") {
        return res.status(404).send({ message: e.message });
      }
      throw e;
    }
  },

  // PUT /workouts/split/:idSplit/order — Planificador visual (Fase C).
  // Reordena las cards DENTRO de una sola columna (a diferencia de
  // reorderWorkoutRows, que reordena la misma fila en TODOS los splits).
  async reorderWorkoutsInSplit(req, res) {
    const table = await tableAccess.findTableOwningSplit(req.params.idSplit);
    if (!table) return res.status(404).send({ message: "Split no encontrado" });
    if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
      return res.status(403).send({ message: "No tienes permiso para esta rutina" });
    }
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;

    try {
      const splits = await withPinnedNotesSync(table._id, () =>
        workoutModel.reorderWorkoutsInSplit(req.params.idSplit, req.body?.workoutIdsOrder),
      );
      return res.send(splits);
    } catch (e) {
      if (e.code === "INVALID_WORKOUT_ORDER") return res.status(400).send({ message: e.message });
      if (e.code === "SPLIT_NOT_FOUND") return res.status(404).send({ message: e.message });
      throw e;
    }
  },

  // PUT /workouts/:idWorkout/blocks — reemplaza el array de bloques completo.
  async updateWorkoutBlocks(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.idWorkout);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const blocks = sanitizeWorkoutBlocks(req.body?.blocks);
    const workout = await workoutModel.updateWorkoutBlocks(req.params.idWorkout, blocks);
    return res.send(workout);
  },

  async finishWorkout(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.body?.workoutId))) return;
    const result = await workoutModel.finishWorkout(
      req.body.workoutId,
      req.user?.id,
      req.body.date,
    );
    if (!result?.workout) {
      return res.status(404).send({ message: "Workout not found" });
    }
    return res.send(result);
  },

  async skipWorkout(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.body?.workoutId))) return;
    const result = await workoutModel.skipWorkout(
      req.body.workoutId,
      req.user?.id,
      req.body.rest,
    );
    if (!result?.workout) {
      return res.status(404).send({ message: "Workout not found" });
    }
    return res.send(result);
  },

  async updateWorkout(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.body?.workout?._id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    // $set del workout entero: mismo reparto de notas que modifyWorkout.
    const workout = await workoutModel.updateWorkout(
      stripForeignNotes(req, table, req.body.workout),
      req.body.customExercise,
    );
    return res.send(workout);
  },

  async addDataExerciseToWorkout(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.idWorkout);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const workout = await workoutModel.addDataExerciseToWorkout(
      req.params.idWorkout,
      req.body,
    );
    return res.send(workout);
  },

  async updateWorkoutsOrder(req, res) {
    const table = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const workout = await withPinnedNotesSync(table._id, () =>
      workoutModel.updateWorkoutsOrder(req.params.idWorkout, req.params.idTable, req.body),
    );
    return res.send(workout);
  },

  async updateCustomExercises(req, res) {
    const tableForAccess = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!tableForAccess) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, tableForAccess)) return;
    const table = await workoutModel.updateCustomExercises(
      req.params.idTable,
      req.params.idWorkout,
      req.params.idCustomExercise,
      req.params.idExercise,
    );
    return res.send(table);
  },

  async updateWorkoutsName(req, res) {
    const table = await assertCanAccessTableId(req, res, req.params.idTable);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await workoutModel.updateWorkoutsName(
      req.params.idTable,
      req.params.idWorkout,
      req.body.workoutsName,
    );
    return res.sendStatus(204);
  },

  async deleteWorkouts(req, res) {
    const workouts = Array.isArray(req.body) ? req.body : [];
    const tableIds = [];
    for (const workoutTemp of workouts) {
      const table = await assertCanAccessWorkoutId(req, res, workoutTemp?._id);
      if (!table) return;
      if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
      tableIds.push(table._id);
    }
    await withPinnedNotesSync(tableIds, () => workoutModel.deleteWorkouts(req.body));
    res.sendStatus(204);
  },

  // Corrige `req.param.id` (sin "s"), typo preexistente que hacía que este
  // endpoint fallara siempre. La comprobación de propiedad que faltaba se
  // añade ahora (ver assertCanAccessWorkoutId) al abrir este módulo a "trainer".
  async deleteWorkout(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await withPinnedNotesSync(table._id, () => workoutModel.deleteWorkout(req.params.id));
    res.sendStatus(204);
  },

  async deleteWorkoutExercise(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.idWorkout);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const workout = await workoutModel.deleteWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise,
    );
    return res.send(workout);
  },

  async pasteExercises(req, res) {
    const table = await assertCanAccessTableId(req, res, req.body.tableId);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const result = await workoutModel.pasteExercises(
      req.body.tableId,
      req.body.sourceWorkoutId,
      req.body.targetWorkoutId,
      req.body.exercises,
    );
    return res.send(result);
  },

  async deleteWorkoutCustomExercises(req, res) {
    const table = await assertCanAccessWorkoutId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await withPinnedNotesSync(table._id, () =>
      workoutModel.deleteWorkoutCustomExercises(req.params.id),
    );
    res.sendStatus(204);
  },
};
