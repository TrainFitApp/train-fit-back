const mongoose = require("mongoose");
const Workout = require("../workouts/workout-schema");
const Exercise = require("../exercises/exercise-schema");
const WorkoutTemplate = require("./workout-template-schema");
const tableSchema = require("../tables/table-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

// Plantillas sueltas de sesión del profesional (WorkoutTemplate, misma forma
// que una sesión: workout-base-schema.js). El shape "de edición"
// (blocks[].exercises[].sets[] anidado) que manda/espera el front NO es el
// de almacenamiento (blocks solo metadata + exercises con blockId, series
// dentro de cada ejercicio) — estas dos funciones traducen entre ambos.

// Lo que el editor necesita de cada ejercicio para pintarlo y pautarlo: el
// nombre, el tipo (fuerza, isométrico o cardio decide qué se prescribe), el
// material y los músculos (resumen de la sesión).
const EXERCISE_EDITOR_FIELDS = "name isCardio isIsometric equipment muscles deletedAt";

// La referencia al ejercicio del catálogo, venga poblada (documento u objeto
// del editor) o pelada (ObjectId o cadena).
function exerciseIdOf(exercise) {
  if (!exercise) return exercise;
  if (typeof exercise === "string" || exercise instanceof mongoose.Types.ObjectId) return exercise;
  return exercise._id ?? exercise;
}

function materializeBlocksAsExercises(blocks) {
  const customExercisesToCreate = [];
  const workoutBlocksToCreate = [];
  let exerciseOrder = 0;

  let blockOrder = 0;
  const sortedBlocks = [...(blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  sortedBlocks.forEach((block) => {
    // "Sin agrupar", como en el Planificador: sus ejercicios van sin bloque
    // (blockId null). Antes se creaba un bloque "Recta" para ellos y, al
    // aplicar la plantilla, el cliente los veía dentro de un bloque.
    const blockId = block.ungrouped ? null : new mongoose.Types.ObjectId();
    if (blockId) {
      workoutBlocksToCreate.push({
        _id: blockId,
        name: block.name || "",
        type: block.type || "straight",
        order: blockOrder++,
        rounds: block.rounds ?? null,
        restBetweenExercises: block.restBetweenExercises ?? null,
        restBetweenRounds: block.restBetweenRounds ?? null,
        instructions: block.instructions || "",
      });
    }

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
        restSeconds: templateSet.restSeconds ?? undefined,
        order: setIndex,
      }));

      customExercisesToCreate.push({
        _id: new mongoose.Types.ObjectId(),
        exercise: exerciseIdOf(templateExercise.exercise),
        notes: templateExercise.notes || undefined,
        order: exerciseOrder++,
        blockId,
        sets,
      });
    });
  });

  return { customExercisesToCreate, workoutBlocksToCreate };
}

// Con `exercisesById` (el editor) cada ejercicio sale con su ficha resumida;
// sin él, como id (aplicar plantilla, guardar una sesión como plantilla). Un
// ejercicio que ya no está en el catálogo sale como id: el editor lo pinta
// como eliminado y lo conserva al guardar.
function mapCustomExerciseToTemplateShape(customExercise, index, exercisesById = null) {
  const exerciseId = exerciseIdOf(customExercise.exercise);
  return {
    exercise: (exercisesById && exercisesById.get(String(exerciseId))) || exerciseId,
    order: Number.isFinite(customExercise.order) ? customExercise.order : index,
    notes: customExercise.notes || "",
    sets: (customExercise.sets || []).map((set) => ({
      expectedReps: set.expectedReps || [],
      expectedRir: set.expectedRir || [],
      drop: Boolean(set.drop),
      restPause: set.restPause ?? null,
      expectedTime: set.expectedTime || "",
      expectedDistance: set.expectedDistance ?? null,
      restSeconds: set.restSeconds ?? null,
    })),
  };
}

// Inverso de materializeBlocksAsExercises. Lee Workout.blocks[] reales y
// agrupa Workout.exercises[] (autopoblado) por blockId. Ejercicios sin
// blockId, o con blockId que ya no existe (huérfano — defensa en
// profundidad), caen en un grupo final marcado `ungrouped` (el "Sin
// agrupar" del Planificador, workout-blocks.util.ts): nunca se pierde
// contenido silenciosamente y al guardar vuelven a ir sin bloque.
function buildBlockFromWorkout(workout, exercisesById = null) {
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
      (entry, exIndex) => mapCustomExerciseToTemplateShape(entry.customExercise, exIndex, exercisesById)
    ),
  }));

  if (leftoverExercises.length > 0 || blocks.length === 0) {
    blocks.push({
      ungrouped: true,
      name: "",
      type: "straight",
      order: blocks.length,
      rounds: null,
      restBetweenExercises: null,
      restBetweenRounds: null,
      instructions: "",
      exercises: leftoverExercises.map((entry, exIndex) =>
        mapCustomExerciseToTemplateShape(entry.customExercise, exIndex, exercisesById)
      ),
    });
  }

  return blocks;
}

// La plantilla como datos de un entrenamiento nuevo (nombre, indicaciones,
// bloques y ejercicios con sus series), listos para addWorkoutsToSplits.
// Pasa por la forma anidada y se vuelve a materializar, el mismo camino que
// create()/update().
function workoutDataFromTemplate(template) {
  const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(buildBlockFromWorkout(template));
  return {
    name: template.name,
    notes: template.notes || undefined,
    blocks: workoutBlocksToCreate,
    exercises: customExercisesToCreate,
  };
}

// Plantillas guardadas (lean) en la forma del editor, con la ficha resumida
// de cada ejercicio. Una sola consulta al catálogo para todas: `.lean()` no
// activa el autopopulate del esquema, y sin esto el editor recibía solo ids
// (nombre "?" y el tipo perdido: un isométrico se reabría como fuerza).
async function toEditorShape(templates) {
  const ids = new Set();
  templates.forEach((template) =>
    (template.exercises || []).forEach((customExercise) => {
      const id = exerciseIdOf(customExercise.exercise);
      if (id) ids.add(String(id));
    })
  );

  const exercises = ids.size
    ? await Exercise.find({ _id: { $in: [...ids] } }).select(EXERCISE_EDITOR_FIELDS).lean()
    : [];
  const exercisesById = new Map(exercises.map((exercise) => [String(exercise._id), exercise]));

  return templates.map(({ exercises: storedExercises, ...template }) => ({
    ...template,
    blocks: buildBlockFromWorkout({ blocks: template.blocks, exercises: storedExercises }, exercisesById),
  }));
}

module.exports = {
  // Funciones puras exportadas para test (workout-template-dao.test.js).
  materializeBlocksAsExercises,
  buildBlockFromWorkout,
  workoutDataFromTemplate,
  exerciseIdOf,

  async create(trainerId, data) {
    const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(data.blocks);

    const created = await WorkoutTemplate.create({
      trainerId,
      name: data.name,
      notes: data.notes,
      description: data.description,
      level: data.level,
      tags: data.tags,
      equipment: data.equipment,
      blocks: workoutBlocksToCreate,
      exercises: customExercisesToCreate,
    });

    const [template] = await toEditorShape([created.toObject({ depopulate: true })]);
    return template;
  },

  // .lean(): los ejercicios y sus series vienen dentro del documento; la
  // ficha de cada Exercise la añade toEditorShape.
  async listByTrainer(trainerId) {
    const templates = await WorkoutTemplate.find({ trainerId }).sort({ createdAt: -1 }).lean();
    return toEditorShape(templates);
  },

  async findOwnedByTrainer(trainerId, id) {
    return WorkoutTemplate.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, patch) {
    const existing = await WorkoutTemplate.findOne({ _id: id, trainerId }).select("_id").lean();
    if (!existing) return null;

    const setOps = {};
    ["name", "notes", "description", "level", "tags", "equipment"].forEach((key) => {
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
    const [template] = await toEditorShape([updated]);
    return template;
  },

  async delete(trainerId, id) {
    return WorkoutTemplate.deleteOne({ _id: id, trainerId });
  },

  // La rutina sobre la que se aplica una plantilla: su dueño y sus
  // microciclos (solo los _id).
  async findTableForApply(tableId) {
    if (!mongoose.isValidObjectId(tableId)) return null;
    return tableSchema.findById(tableId).select("_id userId splits._id").lean();
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
