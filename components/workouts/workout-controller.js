const workoutModel = require("./workout-service");
const tableSchema = require("../tables/table-schema");
const tableAccess = require("../tables/table-access");
const { sanitizeSoreness } = require("./soreness-catalog");

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
  const table = await tableSchema.findById(idTable).select("_id userId");
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
    if (!(await assertCanAccessWorkoutId(req, res, req.body?.workoutToPaste?._id))) return;
    const workout = await workoutModel.pasteWorkout(
      req.body.workoutClipboard,
      req.body.workoutToPaste,
    );
    return res.send(workout);
  },

  async duplicateWorkoutRow(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const splits = await workoutModel.duplicateWorkoutRow(
      req.params.idTable,
      req.params.idWorkout,
      req.body?.nameSuffix,
    );
    return res.send(splits);
  },

  async reorderWorkoutRows(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const splits = await workoutModel.reorderWorkoutRows(
      req.params.idTable,
      req.body?.workoutIdsOrder,
    );
    return res.send(splits);
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

  async addWorkoutsToSplits(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const table = await workoutModel.addWorkoutsToSplits(req.params.idTable, req.body);
    return res.send(table);
  },

  async addExerciseToWorkouts(req, res) {
    const { workoutIds, exerciseId } = req.body;
    for (const idWorkout of workoutIds || []) {
      if (!(await assertCanAccessWorkoutId(req, res, idWorkout))) return;
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

  async addWorkoutExercise(req, res) {
    const workout = await workoutModel.addWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise,
    );
    return res.send(workout);
  },

  async addWorkoutsExercises(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const table = await workoutModel.addWorkoutsExercises(
      req.params.idTable,
      req.params.idExercise,
      req.params.workoutOrder,
    );
    return res.send(table);
  },

  async modifyWorkout(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.body?._id))) return;

    // Movimiento 2 Coach Pro — las agujetas viajan por aquí (junto a
    // readinessPre, en el mismo guardado que arranca la sesión), así que se
    // saneen aquí mismo. modifyWorkout escribe con $set y sin
    // runValidators, de modo que los min/max del esquema no llegarían a
    // ejecutarse: mismo motivo por el que ya existe sanitizeWorkoutBlocks.
    const body = { ...req.body };
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

    try {
      const splits = await workoutModel.reorderWorkoutsInSplit(
        req.params.idSplit,
        req.body?.workoutIdsOrder,
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
    if (!(await assertCanAccessWorkoutId(req, res, req.params.idWorkout))) return;
    const blocks = sanitizeWorkoutBlocks(req.body?.blocks);
    const workout = await workoutModel.updateWorkoutBlocks(req.params.idWorkout, blocks);
    return res.send(workout);
  },

  async finishWorkout(req, res) {
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
    if (!(await assertCanAccessWorkoutId(req, res, req.body?.workout?._id))) return;
    const workout = await workoutModel.updateWorkout(
      req.body.workout,
      req.body.customExercise,
    );
    return res.send(workout);
  },

  async addDataExerciseToWorkout(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.idWorkout))) return;
    const workout = await workoutModel.addDataExerciseToWorkout(
      req.params.idWorkout,
      req.body,
    );
    return res.send(workout);
  },

  async updateWorkoutsOrder(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const workout = await workoutModel.updateWorkoutsOrder(
      req.params.idWorkout,
      req.params.idTable,
      req.body,
    );
    return res.send(workout);
  },

  async updateCustomExercises(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    const table = await workoutModel.updateCustomExercises(
      req.params.idTable,
      req.params.idWorkout,
      req.params.idCustomExercise,
      req.params.idExercise,
    );
    return res.send(table);
  },

  async updateWorkoutsName(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.params.idTable))) return;
    await workoutModel.updateWorkoutsName(
      req.params.idTable,
      req.params.idWorkout,
      req.body.workoutsName,
    );
    return res.sendStatus(204);
  },

  async deleteWorkouts(req, res) {
    const workouts = Array.isArray(req.body) ? req.body : [];
    for (const workoutTemp of workouts) {
      if (!(await assertCanAccessWorkoutId(req, res, workoutTemp?._id))) return;
    }
    await workoutModel.deleteWorkouts(req.body);
    res.sendStatus(204);
  },

  // Corrige `req.param.id` (sin "s"), typo preexistente que hacía que este
  // endpoint fallara siempre. La comprobación de propiedad que faltaba se
  // añade ahora (ver assertCanAccessWorkoutId) al abrir este módulo a "trainer".
  async deleteWorkout(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.id))) return;
    await workoutModel.deleteWorkout(req.params.id);
    res.sendStatus(204);
  },

  async deleteWorkoutExercise(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.idWorkout))) return;
    const workout = await workoutModel.deleteWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise,
    );
    return res.send(workout);
  },

  async pasteExercises(req, res) {
    if (!(await assertCanAccessTableId(req, res, req.body.tableId))) return;
    const result = await workoutModel.pasteExercises(
      req.body.tableId,
      req.body.sourceWorkoutId,
      req.body.targetWorkoutId,
      req.body.exercises,
    );
    return res.send(result);
  },

  async deleteWorkoutCustomExercises(req, res) {
    if (!(await assertCanAccessWorkoutId(req, res, req.params.id))) return;
    await workoutModel.deleteWorkoutCustomExercises(req.params.id);
    res.sendStatus(204);
  },
};
