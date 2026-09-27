const test = require("node:test");
const assert = require("node:assert/strict");
const { stripExecutionForTemplate } = require("./table-template-copy");

function buildTable() {
  return {
    name: "Rutina cliente",
    assignedByTrainerId: "trainer1",
    splits: [
      {
        purpose: "normal",
        workouts: [
          {
            name: "Empuje",
            notes: "calienta bien los hombros",
            clientNotes: "me dolió el hombro",
            date: new Date("2026-09-01"),
            rest: true,
            startedAt: new Date("2026-09-01"),
            readinessPre: 4,
            sorenessPre: [{ muscle: "Pecho", level: 2 }],
            isPlannedRestDay: false,
            blocks: [{ name: "A", type: "superset" }],
            exercises: [
              {
                notes: "codos pegados",
                clientNotes: "cargué poco",
                blockId: "block1",
                sets: [
                  {
                    weight: 60,
                    reps: 9,
                    rir: [2],
                    expectedReps: [8, 12],
                    expectedRir: [1, 2],
                    restSeconds: 90,
                    doned: true,
                    donedAt: new Date("2026-09-01"),
                    time: "30s",
                    distance: 2,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test("quita la ejecución y lo del cliente, deja la pauta", () => {
  const table = stripExecutionForTemplate(buildTable());
  const workout = table.splits[0].workouts[0];
  const exercise = workout.exercises[0];
  const set = exercise.sets[0];

  assert.equal(table.assignedByTrainerId, undefined);
  for (const field of ["clientNotes", "date", "rest", "startedAt", "readinessPre", "sorenessPre"]) {
    assert.equal(workout[field], undefined, field);
  }
  assert.equal(exercise.clientNotes, undefined);
  for (const field of ["reps", "rir", "donedAt", "time", "distance"]) {
    assert.equal(set[field], undefined, field);
  }

  assert.equal(table.name, "Rutina cliente");
  assert.equal(table.splits[0].purpose, "normal");
  assert.equal(workout.name, "Empuje");
  assert.equal(workout.notes, "calienta bien los hombros");
  assert.equal(workout.isPlannedRestDay, false);
  assert.deepEqual(workout.blocks, [{ name: "A", type: "superset" }]);
  assert.equal(exercise.notes, "codos pegados");
  assert.equal(exercise.blockId, "block1");
  assert.equal(set.weight, 60);
  assert.deepEqual(set.expectedReps, [8, 12]);
  assert.deepEqual(set.expectedRir, [1, 2]);
  assert.equal(set.restSeconds, 90);
});

test("tolera tablas sin microciclos, workouts ni series", () => {
  assert.deepEqual(stripExecutionForTemplate({ name: "Vacía" }), { name: "Vacía" });
  const table = stripExecutionForTemplate({ splits: [{ workouts: [{ exercises: [{}] }] }] });
  assert.deepEqual(table.splits[0].workouts[0].exercises[0], {});
});
