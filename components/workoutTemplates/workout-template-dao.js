const mongoose = require("mongoose");
const workoutSchema = require("../workouts/workout-schema");
const splitSchema = require("../splits/split-schema");
const tableSchema = require("../tables/table-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const setSchema = require("../sets/set-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

// Unificación workoutTemplates -> workouts (2026-08) — las plantillas ya no
// viven en su propia colección; son Workout con trainerId set y sin ningún
// Split que las referencie (ver workout-schema.js). El shape "de edición"
// (blocks[].exercises[].sets[] anidado) que manda/espera el front NO es el
// shape de almacenamiento real (Workout.blocks solo metadata + Workout.exercises
// aparte con blockId) — estas dos funciones son la traducción entre ambos,
// igual que ya hacía falta antes de la unificación.
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

// Borra los CustomExercise (y, en cascada vía su propio hook, los Set) de un
// Workout-plantilla — usado antes de re-materializar blocks nuevos en update,
// y en delete. Nunca toca el propio documento Workout.
async function deleteTemplateChildren(workout) {
  if (workout.exercises && workout.exercises.length > 0) {
    await customExerciseSchema.deleteMany({ _id: { $in: workout.exercises } });
  }
}

module.exports = {
  // Funciones puras exportadas para test (workout-template-dao.test.js).
  materializeBlocksAsExercises,
  buildBlockFromWorkout,

  async create(trainerId, data) {
    const { customExercisesToCreate, setsToCreate, workoutBlocksToCreate } =
      materializeBlocksAsExercises(data.blocks);

    if (setsToCreate.length > 0) await setSchema.insertMany(setsToCreate);
    if (customExercisesToCreate.length > 0) {
      await customExerciseSchema.insertMany(customExercisesToCreate);
    }

    const created = await workoutSchema.create({
      trainerId,
      name: data.name,
      description: data.description,
      level: data.level,
      tags: data.tags,
      equipment: data.equipment,
      blocks: workoutBlocksToCreate,
      exercises: customExercisesToCreate.map((ce) => ce._id),
    });

    // create() no pasa por el middleware de autopopulate (solo corre en
    // find/findOne), así que el shape anidado de respuesta se arma en
    // memoria con los mismos objetos recién insertados — mismo criterio que
    // el resto del dao: sin round-trip innecesario a BD.
    const exercisesForResponse = customExercisesToCreate.map((ce) => ({
      ...ce,
      sets: ce.sets.map((setId) => setsToCreate.find((s) => String(s._id) === String(setId))),
    }));

    return {
      _id: created._id,
      trainerId: created.trainerId,
      name: created.name,
      description: created.description,
      level: created.level,
      tags: created.tags,
      equipment: created.equipment,
      createdAt: created.createdAt,
      blocks: buildBlockFromWorkout({ blocks: workoutBlocksToCreate, exercises: exercisesForResponse }),
    };
  },

  // Populate automático (plugin autopopulate del schema) — a diferencia del
  // create() de arriba, aquí sí conviene: es lectura pura, sin insert que
  // proteger de una population prematura.
  async listByTrainer(trainerId) {
    // populate EXPLÍCITO y no autopopulate: el plugin no actúa sobre
    // consultas .lean(), así que `exercises` llegaba como ObjectId pelado,
    // sin `blockId`. buildBlockFromWorkout los tomaba entonces por
    // huérfanos y los volcaba TODOS en su bloque de recogida final: cada
    // plantilla se listaba con sus bloques reales vacíos y uno extra con
    // todo dentro (el picker del planificador pinta ese recuento).
    const templates = await workoutSchema
      .find({ trainerId })
      .sort({ createdAt: -1 })
      .populate({ path: "exercises", populate: { path: "sets" } })
      .lean();
    return templates.map((t) => ({ ...t, blocks: buildBlockFromWorkout(t) }));
  },

  async findOwnedByTrainer(trainerId, id) {
    return workoutSchema.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, patch) {
    const existing = await workoutSchema.findOne({ _id: id, trainerId });
    if (!existing) return null;

    const setOps = {};
    ["name", "description", "level", "tags", "equipment"].forEach((key) => {
      if (patch[key] !== undefined) setOps[key] = patch[key];
    });

    if (patch.blocks !== undefined) {
      // Reemplaza el contenido: fuera los CustomExercise/Set viejos, dentro
      // los nuevos materializados del patch — mismo resultado que el
      // "sobrescribe todo el subdocumento embebido" del modelo anterior,
      // aplicado ahora a colecciones reales.
      await deleteTemplateChildren(existing);
      const { customExercisesToCreate, setsToCreate, workoutBlocksToCreate } =
        materializeBlocksAsExercises(patch.blocks);
      if (setsToCreate.length > 0) await setSchema.insertMany(setsToCreate);
      if (customExercisesToCreate.length > 0) {
        await customExerciseSchema.insertMany(customExercisesToCreate);
      }
      setOps.blocks = workoutBlocksToCreate;
      setOps.exercises = customExercisesToCreate.map((ce) => ce._id);
    }

    await workoutSchema.updateOne({ _id: id }, { $set: setOps });

    const updated = await workoutSchema.findOne({ _id: id, trainerId }).lean();
    return { ...updated, blocks: buildBlockFromWorkout(updated) };
  },

  async delete(trainerId, id) {
    const existing = await workoutSchema.findOne({ _id: id, trainerId });
    if (!existing) return { deletedCount: 0 };
    await deleteTemplateChildren(existing);
    return workoutSchema.deleteOne({ _id: id, trainerId });
  },

  // Crea un Workout real dentro del split indicado, con exercises/sets ya
  // materializados. `template` viene de findOwnedByTrainer (autopoblado), su
  // shape es el mismo Workout real -> primero se lleva a la forma anidada
  // (buildBlockFromWorkout) y se vuelve a aplanar en documentos nuevos
  // (materializeBlocksAsExercises), mismo camino que create()/update() para
  // no mantener un tercer camino de escritura distinto.
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

    const nestedBlocks = buildBlockFromWorkout(template);
    const { customExercisesToCreate, setsToCreate, workoutBlocksToCreate } =
      materializeBlocksAsExercises(nestedBlocks);

    if (setsToCreate.length > 0) await setSchema.insertMany(setsToCreate);
    if (customExercisesToCreate.length > 0) {
      await customExerciseSchema.insertMany(customExercisesToCreate);
    }

    // trainerId se omite a propósito: un workout aplicado a un split es una
    // instancia real de cliente, nunca una plantilla.
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
