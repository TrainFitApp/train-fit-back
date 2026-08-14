const mongoose = require("mongoose");
const WorkoutTemplate = require("./workout-template-schema");
const splitSchema = require("../splits/split-schema");
const tableSchema = require("../tables/table-schema");
const workoutSchema = require("../workouts/workout-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const setSchema = require("../sets/set-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

// Fase B — aplana blocks[].exercises[].sets (formato de prescripción de la
// plantilla) en CustomExercise/Set reales CON blockId real, y en paralelo
// materializa Workout.blocks[] (solo metadata: nombre/tipo/rondas/descansos).
// Función pura (sin acceso a BD) para poder testearla de forma aislada,
// mismo criterio que cloneWorkoutForTemplateCopy en workouts/workout-dao.js.
function materializeBlocksAsExercises(blocks) {
  const customExercisesToCreate = [];
  const setsToCreate = [];
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
      const exerciseDocId = new mongoose.Types.ObjectId();
      const setIds = (templateExercise.sets || []).map((templateSet, setIndex) => {
        const setDoc = {
          _id: new mongoose.Types.ObjectId(),
          expectedReps: templateSet.expectedReps || [],
          expectedRir: templateSet.expectedRir || [],
          drop: templateSet.drop || undefined,
          restPause: templateSet.restPause ?? undefined,
          expectedTime: templateSet.expectedTime || undefined,
          expectedDistance: templateSet.expectedDistance ?? undefined,
          order: setIndex,
        };
        setsToCreate.push(setDoc);
        return setDoc._id;
      });

      customExercisesToCreate.push({
        _id: exerciseDocId,
        exercise: templateExercise.exercise,
        notes: templateExercise.notes || undefined,
        order: exerciseOrder++,
        blockId,
        sets: setIds,
      });
    });
  });

  return { customExercisesToCreate, setsToCreate, workoutBlocksToCreate };
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

// Fase B — inverso de materializeBlocksAsExercises. Lee los Workout.blocks[]
// reales y agrupa workout.exercises[] (autopoblado) por blockId. Cualquier
// ejercicio sin blockId, o con un blockId que ya no exista en el Workout
// (huérfano — no debería pasar, pero updateWorkoutBlocks ya limpia esto al
// borrar un bloque, así que es solo defensa en profundidad), cae en UN bloque
// "straight" final — nunca se pierde contenido silenciosamente al guardar
// como plantilla. Función pura.
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
    return WorkoutTemplate.create({ trainerId, ...data });
  },

  // Populate solo en paths de lectura/respuesta al cliente (lista y builder
  // de plantillas necesitan nombre/tipo de cada ejercicio). NUNCA en
  // findOwnedByTrainer: su resultado alimenta materializeBlocksAsExercises
  // en applyToSplit, que necesita el ObjectId crudo para insertar el nuevo
  // CustomExercise.exercise tal cual — poblarlo ahí rompería esa inserción.
  async listByTrainer(trainerId) {
    return WorkoutTemplate.find({ trainerId })
      .sort({ createdAt: -1 })
      .populate("blocks.exercises.exercise");
  },

  async findOwnedByTrainer(trainerId, id) {
    return WorkoutTemplate.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, patch) {
    return WorkoutTemplate.findOneAndUpdate({ _id: id, trainerId }, patch, { new: true }).populate(
      "blocks.exercises.exercise"
    );
  },

  async delete(trainerId, id) {
    return WorkoutTemplate.deleteOne({ _id: id, trainerId });
  },

  // Crea un Workout real dentro del split indicado, con exercises/sets ya
  // materializados — reutiliza el patrón de clonado ya probado en
  // workouts/workout-dao.js en vez de reinventar el insertMany a mano.
  async applyToSplit(template, splitId, clientId) {
    const split = await splitSchema.findById(splitId);
    if (!split) {
      const err = new Error("Split no encontrado");
      err.code = "SPLIT_NOT_FOUND";
      throw err;
    }

    const owningTable = await tableSchema.findOne({ splits: splitId }).select("userId");
    if (!owningTable || !owningTable.userId || owningTable.userId.toString() !== clientId.toString()) {
      const err = new Error("El split no pertenece a este cliente");
      err.code = "SPLIT_FORBIDDEN";
      throw err;
    }

    const { customExercisesToCreate, setsToCreate, workoutBlocksToCreate } =
      materializeBlocksAsExercises(template.blocks);

    if (setsToCreate.length > 0) await setSchema.insertMany(setsToCreate);
    if (customExercisesToCreate.length > 0) {
      await customExerciseSchema.insertMany(customExercisesToCreate);
    }

    const workoutDoc = await workoutSchema.create({
      name: template.name,
      blocks: workoutBlocksToCreate,
      exercises: customExercisesToCreate.map((ce) => ce._id),
    });

    await splitSchema.updateOne({ _id: splitId }, { $push: { workouts: workoutDoc._id } });

    // Mismo shape de retorno que workoutDao.addWorkoutsToSplits (table.splits
    // completo) — el frontend ya sabe consumir esto (mesocycle.page.ts hace
    // `this.tableInUse.splits = resSplits` tras cualquier alta de workout).
    const updatedTable = await tableSchema.findById(owningTable._id);
    return updatedTable.splits;
  },

  async findWorkoutForTemplateSource(workoutId) {
    return workoutSchema.findById(workoutId);
  },

  async findWorkoutOwnerTable(workoutId) {
    const split = await splitSchema.findOne({ workouts: workoutId }).select("_id");
    if (!split) return null;
    return tableSchema.findOne({ splits: split._id }).select("userId");
  },

  // Un trainer puede guardar como plantilla su propia tabla (userId === trainerId,
  // ver "Replanteamiento MVP" en client-detail.page.ts) o la de un cliente con
  // relación activa de "training" — misma comprobación que requireActiveClient,
  // aplicada aquí porque save-as-template no lleva :clientId en la URL.
  async canTrainerAccessTable(trainerId, table) {
    if (!table || !table.userId) return false;
    if (table.userId.toString() === trainerId.toString()) return true;
    const relation = await trainerClientDao.findActiveByTrainerAndClient(
      trainerId,
      table.userId,
      "training"
    );
    return Boolean(relation);
  },
};
