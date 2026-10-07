const mongoose = require("mongoose");
const { badRequest, forbidden, notFound } = require("../util/http-error");
const Workout = require("../workouts/workout-schema");
const WorkoutTemplate = require("./workout-template-schema");
const tableSchema = require("../tables/table-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { toId, cloneExercise } = require("../workouts/workout-tree");

// Plantillas sueltas de sesión del profesional (WorkoutTemplate, misma forma
// que una sesión: workout-base-schema.js). El shape "de edición"
// (blocks[].exercises[].sets[] anidado) que manda/espera el front NO es el
// de almacenamiento (blocks solo metadata + exercises con blockId, series
// dentro de cada ejercicio) — estas dos funciones traducen entre ambos.
function materializeBlocksAsExercises(blocks) {
  const customExercisesToCreate = [];
  const workoutBlocksToCreate = [];
  let exerciseOrder = 0;

  const sortedBlocks = [...(blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  sortedBlocks.forEach((block, blockIndex) => {
    const blockId = new mongoose.Types.ObjectId();
    workoutBlocksToCreate.push({
      _id: blockId,
      name: block.name || "",
      type: block.type || "straight",
      order: blockIndex,
      rounds: block.rounds ?? null,
      restBetweenExercises: block.restBetweenExercises ?? null,
      restBetweenRounds: block.restBetweenRounds ?? null,
      instructions: block.instructions || "",
    });

    const sortedExercises = [...(block.exercises || [])].sort(
      (a, b) => (a.order || 0) - (b.order || 0)
    );

    sortedExercises.forEach((templateExercise) => {
      const sets = (templateExercise.sets || []).map((templateSet, setIndex) => ({
        _id: new mongoose.Types.ObjectId(),
        expectedReps: templateSet.expectedReps || [],
        expectedRir: templateSet.expectedRir || [],
        drop: templateSet.drop || undefined,
        restPause: templateSet.restPause ?? undefined,
        expectedTime: templateSet.expectedTime || undefined,
        expectedDistance: templateSet.expectedDistance ?? undefined,
        order: setIndex,
      }));

      customExercisesToCreate.push({
        _id: new mongoose.Types.ObjectId(),
        exercise: templateExercise.exercise,
        notes: templateExercise.notes || undefined,
        order: exerciseOrder++,
        blockId,
        sets,
      });
    });
  });

  return { customExercisesToCreate, workoutBlocksToCreate };
}

function mapCustomExerciseToTemplateShape(customExercise, index) {
  return {
    exercise: customExercise.exercise?._id || customExercise.exercise,
    order: Number.isFinite(customExercise.order) ? customExercise.order : index,
    notes: customExercise.notes || "",
    sets: (customExercise.sets || []).map((set) => ({
      expectedReps: set.expectedReps || [],
      expectedRir: set.expectedRir || [],
      drop: Boolean(set.drop),
      restPause: set.restPause ?? null,
      expectedTime: set.expectedTime || "",
      expectedDistance: set.expectedDistance ?? null,
    })),
  };
}

// Inverso de materializeBlocksAsExercises. Lee Workout.blocks[] reales y
// agrupa Workout.exercises[] (autopoblado) por blockId. Ejercicios sin
// blockId, o con blockId que ya no existe (huérfano — defensa en
// profundidad), caen en un bloque "straight" final: nunca se pierde
// contenido silenciosamente.
function buildBlockFromWorkout(workout) {
  const realBlocks = [...(workout.blocks || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );
  const realBlockIds = new Set(realBlocks.map((block) => block._id.toString()));

  const exercisesByBlockId = new Map();
  const leftoverExercises = [];

  (workout.exercises || []).forEach((customExercise, index) => {
    const blockId = customExercise.blockId ? customExercise.blockId.toString() : null;
    if (blockId && realBlockIds.has(blockId)) {
      if (!exercisesByBlockId.has(blockId)) exercisesByBlockId.set(blockId, []);
      exercisesByBlockId.get(blockId).push({ customExercise, index });
    } else {
      leftoverExercises.push({ customExercise, index });
    }
  });

  const blocks = realBlocks.map((block, order) => ({
    name: block.name || "",
    type: block.type || "straight",
    order,
    rounds: block.rounds ?? null,
    restBetweenExercises: block.restBetweenExercises ?? null,
    restBetweenRounds: block.restBetweenRounds ?? null,
    instructions: block.instructions || "",
    exercises: (exercisesByBlockId.get(block._id.toString()) || []).map(
      (entry, exIndex) => mapCustomExerciseToTemplateShape(entry.customExercise, exIndex)
    ),
  }));

  if (leftoverExercises.length > 0 || blocks.length === 0) {
    blocks.push({
      name: "",
      type: "straight",
      order: blocks.length,
      rounds: null,
      restBetweenExercises: null,
      restBetweenRounds: null,
      instructions: "",
      exercises: leftoverExercises.map((entry, exIndex) =>
        mapCustomExerciseToTemplateShape(entry.customExercise, exIndex)
      ),
    });
  }

  return blocks;
}

module.exports = {
  // Funciones puras exportadas para test (workout-template-dao.test.js).
  materializeBlocksAsExercises,
  buildBlockFromWorkout,

  async create(trainerId, data) {
    const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(data.blocks);

    const created = await WorkoutTemplate.create({
      trainerId,
      name: data.name,
      description: data.description,
      level: data.level,
      tags: data.tags,
      equipment: data.equipment,
      blocks: workoutBlocksToCreate,
      exercises: customExercisesToCreate,
    });

    return {
      _id: created._id,
      trainerId: created.trainerId,
      name: created.name,
      description: created.description,
      level: created.level,
      tags: created.tags,
      equipment: created.equipment,
      createdAt: created.createdAt,
      blocks: buildBlockFromWorkout({ blocks: workoutBlocksToCreate, exercises: customExercisesToCreate }),
    };
  },

  // .lean(): los ejercicios y sus series vienen dentro del documento; el
  // Exercise de cada uno basta como id (buildBlockFromWorkout solo lee eso).
  async listByTrainer(trainerId) {
    const templates = await WorkoutTemplate.find({ trainerId }).sort({ createdAt: -1 }).lean();
    return templates.map((t) => ({ ...t, blocks: buildBlockFromWorkout(t) }));
  },

  async findOwnedByTrainer(trainerId, id) {
    return WorkoutTemplate.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, patch) {
    const existing = await WorkoutTemplate.findOne({ _id: id, trainerId }).select("_id").lean();
    if (!existing) return null;

    const setOps = {};
    ["name", "description", "level", "tags", "equipment"].forEach((key) => {
      if (patch[key] !== undefined) setOps[key] = patch[key];
    });

    if (patch.blocks !== undefined) {
      // Reemplaza el contenido entero por el que llega materializado.
      const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(patch.blocks);
      setOps.blocks = workoutBlocksToCreate;
      setOps.exercises = customExercisesToCreate;
    }

    await WorkoutTemplate.updateOne({ _id: id }, { $set: setOps, $inc: { __v: 1 } }, { runValidators: true });

    const updated = await WorkoutTemplate.findOne({ _id: id, trainerId }).lean();
    return { ...updated, blocks: buildBlockFromWorkout(updated) };
  },

  async delete(trainerId, id) {
    return WorkoutTemplate.deleteOne({ _id: id, trainerId });
  },

  // Crea una sesión real al final del microciclo indicado con el contenido
  // de la plantilla. Se pasa por la forma anidada (buildBlockFromWorkout) y
  // se vuelve a materializar con ids nuevos, mismo camino que create()/
  // update(), para no mantener un tercer camino de escritura distinto.
  // Aplica la plantilla como una fila NUEVA al final de todos los
  // microciclos de la tabla, igual que crear un entrenamiento: los mismos
  // bloques (mismo _id) en toda la fila (workouts/workout-row-blocks.js) y
  // los ejercicios, con sus series, copiados en cada microciclo. Antes se
  // aplicaba microciclo a microciclo y cada uno estrenaba sus propios
  // bloques: borrar o editar un bloque no llegaba a los demás.
  async applyToTable(template, tableId, clientId) {
    const table = await tableSchema.findById(tableId).select("_id userId splits._id").lean();
    if (!table) {
      throw notFound("Rutina no encontrada", "TABLE_NOT_FOUND");
    }
    if (!table.userId || table.userId.toString() !== clientId.toString()) {
      throw forbidden("La rutina no pertenece a este cliente", "TABLE_FORBIDDEN");
    }
    if (!(table.splits || []).length) {
      throw badRequest("La rutina no tiene microciclos", "TABLE_WITHOUT_SPLITS");
    }

    const nestedBlocks = buildBlockFromWorkout(template);
    const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(nestedBlocks);

    const workouts = table.splits.map(() => ({
      _id: new mongoose.Types.ObjectId(),
      name: template.name,
      blocks: workoutBlocksToCreate.map((block) => ({ ...block })),
      exercises: customExercisesToCreate.map((exercise) => cloneExercise(exercise)),
    }));
    await Workout.insertMany(workouts);
    await tableSchema.bulkWrite(
      table.splits.map((split, index) => ({
        updateOne: {
          filter: { _id: table._id },
          update: { $push: { "splits.$[split].workouts": workouts[index]._id } },
          arrayFilters: [{ "split._id": split._id }],
        },
      })),
    );

    // Mismo shape de retorno que workoutDao.addWorkoutsToSplits (table.splits
    // completo).
    const updatedTable = await tableSchema.findById(table._id);
    return updatedTable.splits;
  },

  async findWorkoutForTemplateSource(workoutId) {
    return Workout.findById(workoutId);
  },

  async findWorkoutOwnerTable(workoutId) {
    return tableSchema.findOne({ "splits.workouts": workoutId }).select("userId").lean();
  },

  // Un trainer puede guardar como plantilla su propia tabla (userId === trainerId,
  // ver "Replanteamiento MVP" en client-detail.page.ts) o la de un cliente con
  // relación activa de "training" — misma comprobación que requireActiveClient,
  // aplicada aquí porque save-as-template no lleva :clientId en la URL.
  async canTrainerAccessTable(trainerId, table) {
    if (!table || !table.userId) return false;
    if (table.userId.toString() === trainerId.toString()) return true;
    return trainerClientDao.isActivePair(trainerId, table.userId, "training");
  },
};
