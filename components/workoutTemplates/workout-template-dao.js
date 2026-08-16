const mongoose = require("mongoose");
const workoutSchema = require("../workouts/workout-schema");
const workoutDao = require("../workouts/workout-dao");
const splitDao = require("../splits/split-dao");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const setSchema = require("../sets/set-schema");
const tableSchema = require("../tables/table-schema");
const splitSchema = require("../splits/split-schema");
const userSchema = require("../users/schema");

// Campos que nunca deben sobrevivir a un clonado (ni al "guardar como
// plantilla" ni al "aplicar a cliente"): son estado de sesión/progreso de
// UN workout concreto, no tiene sentido copiarlos.
const SESSION_FIELDS = ["date", "paused", "startedAt", "cronometer"];
// Campos exclusivos de plantilla (funcionalidad 5) — se copian al guardar
// como plantilla, se eliminan al aplicar a un cliente (un workout real de
// cliente no debe llevarlos).
const TEMPLATE_FIELDS = ["trainerId", "tags", "equipment"];

function normalizeSetForClone(setTemp) {
  delete setTemp.doned;
}

// Mismo patrón que copyHierarchy()/duplicateWorkoutRow() en table-dao.js /
// workout-dao.js: clona Workout→CustomExercise→Set con _id nuevos en cada
// nivel. `stripFields` decide qué campos del Workout origen NO se copian al
// clon (ver constantes de arriba).
async function cloneWorkoutDeep(workoutId, stripFields = []) {
  const workoutDoc = await workoutSchema.findById(workoutId);
  if (!workoutDoc) {
    const error = new Error("Workout no encontrado");
    error.statusCode = 404;
    throw error;
  }

  const workoutTemp = workoutDoc.toObject();
  const customExercises = [];
  const sets = [];

  workoutTemp._id = new mongoose.Types.ObjectId();
  SESSION_FIELDS.forEach((field) => delete workoutTemp[field]);
  stripFields.forEach((field) => delete workoutTemp[field]);

  (workoutTemp.exercises || []).forEach((customExerciseTemp) => {
    customExerciseTemp._id = new mongoose.Types.ObjectId();
    customExercises.push(customExerciseTemp);
    (customExerciseTemp.sets || []).forEach((setTemp) => {
      setTemp._id = new mongoose.Types.ObjectId();
      normalizeSetForClone(setTemp);
      sets.push(setTemp);
    });
  });

  if (sets.length) await setSchema.insertMany(sets);
  if (customExercises.length) await customExerciseSchema.insertMany(customExercises);
  await workoutSchema.create(workoutTemp);

  return workoutTemp._id;
}

module.exports = {
  cloneWorkoutDeep,
  TEMPLATE_FIELDS,

  // Recorre las Tables del cliente buscando en qué Split aparece este
  // Workout — Workout no tiene back-reference a Split/Table (ver
  // components/customExercises/custom-exercise-schema.js, mismo patrón), así
  // que la única forma de comprobar propiedad es buscarlo por valor.
  async findWorkoutOwnedByClient(clientId, workoutId) {
    const tables = await tableSchema.find({ userId: clientId });
    for (const table of tables) {
      for (const split of table.splits || []) {
        const found = (split.workouts || []).some(
          (w) => String(w._id) === String(workoutId)
        );
        if (found) return true;
      }
    }
    return false;
  },

  async createTemplate(data) {
    return workoutSchema.create(data);
  },

  async findById(id) {
    return workoutSchema.findById(id);
  },

  async findTemplatesByTrainer(trainerId, search) {
    const query = { trainerId };
    if (search) query.name = { $regex: search, $options: "i" };
    return workoutSchema.find(query).sort({ _id: -1 }).lean();
  },

  // Cascada real ya existente: Workout.deleteOne → CustomExercise.deleteMany
  // → Set.deleteMany (hooks en cada schema).
  async deleteTemplate(id) {
    return workoutSchema.deleteOne({ _id: id });
  },

  async getClientActiveTable(clientId) {
    const client = await userSchema.findById(clientId);
    if (!client || !client.tableInUse) return null;
    return tableSchema.findById(client.tableInUse);
  },

  // Mismo patrón que addWorkoutsToSplits() en workout-dao.js: una fila nueva
  // se añade replicada — un Workout por split, todos al final del array —
  // porque hoy no hay ningún id compartido entre "la misma fila" en distintas
  // semanas, solo la posición en el array (ver funcionalidad 5, addendum).
  async appendWorkoutRowToAllSplits(splitIds, newWorkoutIds) {
    await Promise.all(
      splitIds.map((splitId, i) =>
        splitSchema.findByIdAndUpdate(splitId, {
          $push: { workouts: newWorkoutIds[i] },
        })
      )
    );
  },

  async markTableAssignedByTrainer(tableId, trainerId) {
    return tableSchema.findByIdAndUpdate(tableId, {
      $set: { assignedByTrainerId: trainerId },
    });
  },

  // --- Builder: crear/editar la rutina de un cliente ---
  // (funcionalidad 5, "desde cero" — ver docs/trainfit-trainers/06-estado-actual.md)

  async findTableOwnedByClient(clientId, tableId) {
    return tableSchema.findOne({ _id: tableId, userId: clientId });
  },

  async createTableForClient(clientId, trainerId, name) {
    const table = await tableSchema.create({
      name,
      userId: clientId,
      assignedByTrainerId: trainerId,
      splits: [],
    });
    await userSchema.findByIdAndUpdate(clientId, {
      $set: { tableInUse: table._id },
      $unset: { workoutInUse: "" },
    });
    return table;
  },

  // Si la tabla ya tiene splits, la nueva semana clona su estructura (mismos
  // días/ejercicios, sets vacíos) — mismo comportamiento que addSplit() en
  // components/splits/split-dao.js (reutilizado tal cual), para que las
  // semanas se mantengan alineadas por índice (ver duplicateWorkoutRow /
  // reorderWorkoutRows en workout-dao.js). Si es la primera semana, se crea
  // vacía.
  async addSplitToTable(tableId, name) {
    const table = await tableSchema.findById(tableId);
    if (!table) {
      const error = new Error("Tabla no encontrada");
      error.statusCode = 404;
      throw error;
    }

    if (!table.splits.length) {
      const split = await splitSchema.create({ name, workouts: [] });
      await tableSchema.findByIdAndUpdate(tableId, { $push: { splits: split._id } });
      return tableSchema.findById(tableId);
    }

    const templateSplit = table.splits[0].toObject();
    templateSplit.name = name;
    await splitDao.addSplit(tableId, templateSplit);
    return tableSchema.findById(tableId);
  },

  // Reutiliza tal cual addWorkoutsToSplits()/reorderWorkoutRows()/
  // updateWorkoutsName() de components/workouts/workout-dao.js — son fiables
  // (verificado leyendo el código antes de reutilizar). NO se reutiliza
  // deleteWorkouts() de ese mismo archivo: su filtro `{_id: workoutIds}`
  // (sin `$in`) no borra nada, es un bug real preexistente — se implementa
  // deleteWorkoutRow aquí en su lugar, con el filtro correcto.
  async addWorkoutRow(tableId, name) {
    return workoutDao.addWorkoutsToSplits(tableId, [{ name }]);
  },

  async renameWorkoutRow(tableId, workoutId, name) {
    return workoutDao.updateWorkoutsName(tableId, workoutId, name);
  },

  async reorderWorkoutRows(tableId, workoutIdsOrder) {
    return workoutDao.reorderWorkoutRows(tableId, workoutIdsOrder);
  },

  async deleteWorkoutRow(tableId, workoutId) {
    const table = await tableSchema.findById(tableId);
    if (!table) {
      const error = new Error("Tabla no encontrada");
      error.statusCode = 404;
      throw error;
    }

    let indexWorkout = -1;
    for (const split of table.splits) {
      const idx = split.workouts.findIndex((w) => String(w._id) === String(workoutId));
      if (idx !== -1) {
        indexWorkout = idx;
        break;
      }
    }
    if (indexWorkout === -1) {
      const error = new Error("Ese día no existe en esta tabla");
      error.statusCode = 404;
      throw error;
    }

    const idsToDelete = table.splits
      .map((split) => split.workouts[indexWorkout]?._id)
      .filter(Boolean);

    await Promise.all(
      table.splits.map((split) =>
        splitSchema.findByIdAndUpdate(split._id, {
          $pull: { workouts: { $in: idsToDelete } },
        })
      )
    );
    // Filtro correcto ($in) — dispara bien la cascada Workout→CustomExercise→Set.
    await workoutSchema.deleteMany({ _id: { $in: idsToDelete } });
  },

  // --- Builder: ejercicios y series dentro de UN workout concreto ---
  // Deliberadamente NO replicado entre splits (a diferencia de las filas):
  // las únicas funciones existentes para esto (addWorkoutsExercises,
  // deleteWorkoutExercise en workout-dao.js) están rotas/muertas (ver
  // addendum de la funcionalidad 5) — en vez de heredar ese bug, se edita el
  // contenido semana a semana, workout por workout.

  async findWorkoutIdInAnyContext(workoutId) {
    return workoutSchema.findById(workoutId);
  },

  async addExerciseToWorkout(workoutId, { exerciseId, notes }) {
    const customExercise = await customExerciseSchema.create({
      exercise: exerciseId,
      notes,
      sets: [],
    });
    await workoutSchema.findByIdAndUpdate(workoutId, {
      $push: { exercises: customExercise._id },
    });
    return customExercise;
  },

  // Cascada real ya existente: CustomExercise.deleteOne → Set.deleteMany.
  async deleteExerciseFromWorkout(workoutId, customExerciseId) {
    await workoutSchema.findByIdAndUpdate(workoutId, {
      $pull: { exercises: customExerciseId },
    });
    await customExerciseSchema.deleteOne({ _id: customExerciseId });
  },

  async workoutHasExercise(workoutId, customExerciseId) {
    const workout = await workoutSchema.findById(workoutId).lean();
    if (!workout) return false;
    return (workout.exercises || []).some((e) => String(e) === String(customExerciseId) || String(e._id) === String(customExerciseId));
  },

  async addSetToExercise(customExerciseId, setFields) {
    const set = await setSchema.create(setFields);
    await customExerciseSchema.findByIdAndUpdate(customExerciseId, {
      $push: { sets: set._id },
    });
    return set;
  },

  async exerciseHasSet(customExerciseId, setId) {
    const customExercise = await customExerciseSchema.findById(customExerciseId).lean();
    if (!customExercise) return false;
    return (customExercise.sets || []).some((s) => String(s) === String(setId) || String(s._id) === String(setId));
  },

  async updateSet(setId, fields) {
    return setSchema.findByIdAndUpdate(setId, { $set: fields }, { new: true });
  },

  async deleteSetFromExercise(customExerciseId, setId) {
    await customExerciseSchema.findByIdAndUpdate(customExerciseId, {
      $pull: { sets: setId },
    });
    await setSchema.deleteOne({ _id: setId });
  },

  // --- Builder: plantilla desde cero ---

  async createTemplateFromScratch(trainerId, { name, tags, equipment }) {
    const data = { trainerId, name, exercises: [] };
    if (tags?.length) data.tags = tags;
    if (equipment?.length) data.equipment = equipment;
    return workoutSchema.create(data);
  },

  async updateTemplateMetadata(templateId, { name, tags, equipment }) {
    const set = {};
    const unset = {};
    if (name) set.name = name;
    if (tags !== undefined) (tags?.length ? (set.tags = tags) : (unset.tags = ""));
    if (equipment !== undefined) (equipment?.length ? (set.equipment = equipment) : (unset.equipment = ""));

    const ops = {};
    if (Object.keys(set).length) ops.$set = set;
    if (Object.keys(unset).length) ops.$unset = unset;
    if (!Object.keys(ops).length) return workoutSchema.findById(templateId);

    return workoutSchema.findByIdAndUpdate(templateId, ops, { new: true });
  },
};
