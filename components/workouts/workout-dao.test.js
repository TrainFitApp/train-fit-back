const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const workoutDao = require("./workout-dao");
const workoutSchema = require("./workout-schema");
const splitSchema = require("../splits/split-schema");

afterEach(() => mock.restoreAll());

// Bug real: { _id: workoutIds } (workoutIds es un array) compara el campo
// escalar _id contra el array entero, así que deleteMany nunca encontraba
// nada (deletedCount:0, sin error) y el entrenamiento "eliminado" seguía
// vivo en Mongo. Este test fija el filtro correcto para que no vuelva a
// romperse en silencio.
test("deleteWorkouts filtra por $in, no por el array entero", async () => {
  const deleteManyCall = mock.method(workoutSchema, "deleteMany", async () => ({ deletedCount: 2 }));
  const updateManyCall = mock.method(splitSchema, "updateMany", async () => ({ modifiedCount: 1 }));

  await workoutDao.deleteWorkouts([{ _id: "a" }, { _id: "b" }]);

  assert.deepEqual(deleteManyCall.mock.calls[0].arguments[0], { _id: { $in: ["a", "b"] } });
  // También limpia la referencia en el split para no dejar un _id fantasma
  // en Split.workouts (populate rompería intentando resolver ese id).
  assert.deepEqual(updateManyCall.mock.calls[0].arguments, [
    { workouts: { $in: ["a", "b"] } },
    { $pull: { workouts: { $in: ["a", "b"] } } },
  ]);
});
