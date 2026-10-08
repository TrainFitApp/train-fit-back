const test = require("node:test");
const assert = require("node:assert/strict");
const { materializeBlocksAsExercises, buildBlockFromWorkout } = require("./workout-template-dao");

// Fase A — materializeBlocksAsExercises es el corazón de "aplicar plantilla":
// aplana blocks[].exercises[].sets (prescripción) en CustomExercise/Set reales
// listos para insertMany. Una regresión aquí crea un Workout roto (exercises
// sin sets, o en el orden equivocado) para el cliente real.
test("materializeBlocksAsExercises", async (t) => {
  await t.test("aplana ejercicios de varios bloques en orden secuencial", () => {
    const blocks = [
      { order: 1, exercises: [{ exercise: "ex-b", order: 0, sets: [] }] },
      { order: 0, exercises: [{ exercise: "ex-a", order: 0, sets: [] }] },
    ];
    const { customExercisesToCreate } = materializeBlocksAsExercises(blocks);
    assert.equal(customExercisesToCreate.length, 2);
    // bloque order:0 (ex-a) va primero, aunque apareciera después en el array de entrada
    assert.equal(customExercisesToCreate[0].exercise, "ex-a");
    assert.equal(customExercisesToCreate[0].order, 0);
    assert.equal(customExercisesToCreate[1].exercise, "ex-b");
    assert.equal(customExercisesToCreate[1].order, 1);
  });

  await t.test("respeta el order interno de exercises dentro de un bloque", () => {
    const blocks = [
      {
        order: 0,
        exercises: [
          { exercise: "second", order: 1, sets: [] },
          { exercise: "first", order: 0, sets: [] },
        ],
      },
    ];
    const { customExercisesToCreate } = materializeBlocksAsExercises(blocks);
    assert.equal(customExercisesToCreate[0].exercise, "first");
    assert.equal(customExercisesToCreate[1].exercise, "second");
  });

  await t.test("cada set de la plantilla queda embebido en su ejercicio, con su _id y su orden", () => {
    const blocks = [
      {
        order: 0,
        exercises: [
          {
            exercise: "ex-a",
            order: 0,
            sets: [
              { expectedReps: [8, 8], expectedRir: [2] },
              { expectedReps: [6] },
            ],
          },
        ],
      },
    ];
    const { customExercisesToCreate } = materializeBlocksAsExercises(blocks);
    const sets = customExercisesToCreate[0].sets;
    assert.equal(sets.length, 2);
    assert.ok(sets.every((set) => set._id));
    assert.deepEqual(sets.map((set) => set.order), [0, 1]);
    assert.deepEqual(sets[0].expectedReps, [8, 8]);
    assert.deepEqual(sets[1].expectedReps, [6]);
  });

  await t.test("sin bloques -> arrays vacíos, no lanza", () => {
    const result = materializeBlocksAsExercises([]);
    assert.deepEqual(result.customExercisesToCreate, []);
    assert.deepEqual(result.workoutBlocksToCreate, []);
    assert.deepEqual(materializeBlocksAsExercises(undefined).customExercisesToCreate, []);
  });

  // Fase B — cada bloque de la plantilla se materializa como un
  // Workout.blocks[] real, y cada CustomExercise queda vinculado a SU bloque
  // real vía blockId (no aplanado a un único bloque falso).
  await t.test("materializa un Workout.blocks[] real por cada bloque de la plantilla", () => {
    const blocks = [
      { order: 0, name: "Calentamiento", type: "warmup", exercises: [{ exercise: "ex-a", order: 0, sets: [] }] },
      { order: 1, name: "Bloque principal", type: "superset", rounds: 3, exercises: [{ exercise: "ex-b", order: 0, sets: [] }] },
    ];
    const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises(blocks);

    assert.equal(workoutBlocksToCreate.length, 2);
    assert.equal(workoutBlocksToCreate[0].name, "Calentamiento");
    assert.equal(workoutBlocksToCreate[0].type, "warmup");
    assert.equal(workoutBlocksToCreate[1].name, "Bloque principal");
    assert.equal(workoutBlocksToCreate[1].rounds, 3);

    assert.deepEqual(customExercisesToCreate[0].blockId, workoutBlocksToCreate[0]._id);
    assert.deepEqual(customExercisesToCreate[1].blockId, workoutBlocksToCreate[1]._id);
  });
});

// buildBlockFromWorkout es el inverso — usado por "guardar como plantilla".
// Debe ser fiel round-trip: aplicar la plantilla resultante debe producir el
// mismo contenido que tenía el Workout original.
test("buildBlockFromWorkout", async (t) => {
  await t.test("envuelve las exercises del workout en un único bloque straight", () => {
    const workout = {
      exercises: [
        { exercise: { _id: "ex-1" }, order: 0, notes: "nota", sets: [{ expectedReps: [10] }] },
      ],
    };
    const blocks = buildBlockFromWorkout(workout);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "straight");
    assert.equal(blocks[0].exercises.length, 1);
    assert.equal(blocks[0].exercises[0].exercise, "ex-1");
    assert.equal(blocks[0].exercises[0].notes, "nota");
    assert.deepEqual(blocks[0].exercises[0].sets[0].expectedReps, [10]);
  });

  await t.test("exercise sin populate (ya es un ObjectId) también funciona", () => {
    const workout = { exercises: [{ exercise: "ex-raw", order: 0, sets: [] }] };
    const blocks = buildBlockFromWorkout(workout);
    assert.equal(blocks[0].exercises[0].exercise, "ex-raw");
  });

  await t.test("workout sin exercises -> un bloque vacío, no lanza", () => {
    const blocks = buildBlockFromWorkout({ exercises: [] });
    assert.deepEqual(blocks[0].exercises, []);
  });

  // Fase B — con Workout.blocks[] reales, agrupa por blockId en vez de
  // aplanar todo a un único bloque. Round-trip real con materializeBlocksAsExercises.
  await t.test("agrupa exercises por blockId respetando los bloques reales del workout", () => {
    const blockAId = "block-a";
    const blockBId = "block-b";
    const workout = {
      blocks: [
        { _id: blockBId, name: "B", type: "superset", order: 1 },
        { _id: blockAId, name: "A", type: "warmup", order: 0 },
      ],
      exercises: [
        { exercise: { _id: "ex-1" }, order: 0, blockId: blockBId, sets: [] },
        { exercise: { _id: "ex-2" }, order: 1, blockId: blockAId, sets: [] },
      ],
    };

    const blocks = buildBlockFromWorkout(workout);
    assert.equal(blocks.length, 2);
    // Los bloques van en su propio order (A primero), no en el orden de exercises[]
    assert.equal(blocks[0].name, "A");
    assert.equal(blocks[0].exercises[0].exercise, "ex-2");
    assert.equal(blocks[1].name, "B");
    assert.equal(blocks[1].exercises[0].exercise, "ex-1");
  });

  await t.test("exercises sin blockId (o con blockId huérfano) caen en un bloque final, sin perderse", () => {
    const workout = {
      blocks: [{ _id: "block-a", name: "A", type: "straight", order: 0 }],
      exercises: [
        { exercise: { _id: "ex-grouped" }, order: 0, blockId: "block-a", sets: [] },
        { exercise: { _id: "ex-loose" }, order: 1, blockId: null, sets: [] },
        { exercise: { _id: "ex-orphan" }, order: 2, blockId: "block-borrado", sets: [] },
      ],
    };

    const blocks = buildBlockFromWorkout(workout);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].exercises.length, 1);
    const leftoverBlock = blocks[1];
    const leftoverExerciseIds = leftoverBlock.exercises.map((e) => e.exercise);
    assert.deepEqual(leftoverExerciseIds, ["ex-loose", "ex-orphan"]);
  });
});

// Los tests de arriba construyen el workout a mano, con los ejercicios YA
// poblados — que es justo lo que ocultó un fallo real: listByTrainer
// consultaba con .lean(), donde mongoose-autopopulate no actúa, así que la
// función recibía referencias peladas, sin `blockId`. Este test fija esa
// frontera: si alguien vuelve a quitar el populate explícito del dao, aquí
// se ve QUÉ pasa. (Ids como cadena, igual que el resto del fichero: lo que
// importa es que sean escalares sin blockId, no que sean ObjectId.)
test("buildBlockFromWorkout con ejercicios sin poblar", async (t) => {
  await t.test("una referencia pelada no tiene blockId y cae en el bloque de recogida", () => {
    const workout = {
      blocks: [{ _id: "bloque-1", name: "Principal", type: "straight", order: 0 }],
      exercises: ["ref-1", "ref-2"],
    };

    const blocks = buildBlockFromWorkout(workout);

    // El bloque real se queda VACÍO y aparece uno extra con todo dentro:
    // exactamente el síntoma que enseñaba el picker del planificador.
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].name, "Principal");
    assert.equal(blocks[0].exercises.length, 0);
    assert.equal(blocks[1].name, "");
    assert.equal(blocks[1].exercises.length, 2);
  });

  await t.test("con los mismos ejercicios poblados, el reparto es el correcto", () => {
    const workout = {
      blocks: [{ _id: "bloque-1", name: "Principal", type: "straight", order: 0 }],
      exercises: [
        { blockId: "bloque-1", exercise: "ex-1", order: 0, sets: [] },
        { blockId: "bloque-1", exercise: "ex-2", order: 1, sets: [] },
      ],
    };

    const blocks = buildBlockFromWorkout(workout);

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].exercises.length, 2);
  });
});

// El editor de plantillas recibe cada ejercicio con su ficha (nombre, tipo,
// músculos). Antes llegaba solo el id: nombre "?" y un isométrico o un
// cardio se reabrían como fuerza, perdiendo el tiempo al guardar.
test("buildBlockFromWorkout con fichas de ejercicio (editor)", async (t) => {
  const { exerciseIdOf } = require("./workout-template-dao");
  const plank = { _id: "ex-plank", name: "Plancha", isIsometric: true, muscles: [] };
  const exercisesById = new Map([["ex-plank", plank]]);
  const workout = {
    blocks: [{ _id: "b1", type: "straight", order: 0 }],
    exercises: [
      { blockId: "b1", exercise: "ex-plank", order: 0, sets: [{ expectedTime: "30s", restSeconds: 60 }] },
      { blockId: "b1", exercise: "ex-borrado", order: 1, sets: [] },
    ],
  };

  await t.test("cada ejercicio sale con su ficha; el que no está en el catálogo, como id", () => {
    const [block] = buildBlockFromWorkout(workout, exercisesById);
    assert.equal(block.exercises[0].exercise, plank);
    assert.equal(block.exercises[1].exercise, "ex-borrado");
  });

  await t.test("sin fichas, como siempre: solo ids", () => {
    const [block] = buildBlockFromWorkout(workout);
    assert.equal(block.exercises[0].exercise, "ex-plank");
  });

  await t.test("el descanso entre series viaja en los dos sentidos", () => {
    const [block] = buildBlockFromWorkout(workout, exercisesById);
    assert.equal(block.exercises[0].sets[0].restSeconds, 60);
    const { customExercisesToCreate } = materializeBlocksAsExercises([block]);
    assert.equal(customExercisesToCreate[0].sets[0].restSeconds, 60);
  });

  await t.test("al guardar, una ficha poblada se vuelve a su id", () => {
    const [block] = buildBlockFromWorkout(workout, exercisesById);
    const { customExercisesToCreate } = materializeBlocksAsExercises([block]);
    assert.equal(customExercisesToCreate[0].exercise, "ex-plank");
    assert.equal(exerciseIdOf({ _id: "x", name: "y" }), "x");
    assert.equal(exerciseIdOf("x"), "x");
    assert.equal(exerciseIdOf(null), null);
  });
});

test("workoutDataFromTemplate lleva las indicaciones de la sesión", () => {
  const { workoutDataFromTemplate } = require("./workout-template-dao");
  const template = { name: "Empuje", notes: "Técnica antes que carga", blocks: [], exercises: [] };
  assert.equal(workoutDataFromTemplate(template).notes, "Técnica antes que carga");
  assert.equal(workoutDataFromTemplate({ ...template, notes: "" }).notes, undefined);
});

// "Sin agrupar", como en el Planificador: los ejercicios sueltos de una
// plantilla siguen sueltos al guardarla y al aplicarla (antes acababan en un
// bloque "Recta" sin nombre que el cliente veía como bloque).
test("grupo sin agrupar", async (t) => {
  await t.test("los ejercicios sin bloque vuelven marcados como sin agrupar", () => {
    const workout = {
      blocks: [{ _id: "b1", name: "Superserie", type: "superset", order: 0 }],
      exercises: [
        { blockId: "b1", exercise: "ex-1", order: 0, sets: [] },
        { blockId: null, exercise: "ex-2", order: 1, sets: [] },
      ],
    };
    const blocks = buildBlockFromWorkout(workout);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].ungrouped, undefined);
    assert.equal(blocks[1].ungrouped, true);
  });

  await t.test("al materializar no crean bloque: blockId null", () => {
    const { customExercisesToCreate, workoutBlocksToCreate } = materializeBlocksAsExercises([
      { order: 0, name: "Superserie", type: "superset", exercises: [{ exercise: "ex-1", sets: [] }] },
      { order: 1, ungrouped: true, exercises: [{ exercise: "ex-2", sets: [] }] },
    ]);
    assert.equal(workoutBlocksToCreate.length, 1);
    assert.equal(workoutBlocksToCreate[0].order, 0);
    assert.ok(customExercisesToCreate[0].blockId);
    assert.equal(customExercisesToCreate[1].blockId, null);
  });
});
