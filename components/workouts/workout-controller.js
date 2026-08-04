const workoutModel = require("./workout-service");
const tableSchema = require("../tables/table-schema");
const tableAccess = require("../tables/table-access");

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
    const workout = await workoutModel.modifyWorkout(req.body);
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
