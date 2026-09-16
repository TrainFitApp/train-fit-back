const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { default: mongoose } = require("mongoose");
const dao = require("./custom-exercise-dao");
const setSchema = require("../sets/set-schema");
const customExerciseSchema = require("./custom-exercise-schema");

afterEach(() => mock.restoreAll());

// Bug real: SET_UPDATE_FIELDS (la lista blanca de campos que sí se
// persisten al actualizar una serie) no incluía "restSeconds" — el
// descanso pautado se guardaba bien en el formulario (ManageSetComponent) y
// llegaba bien al backend, pero buildSetUpdate() lo descartaba en
// silencio, así que nunca llegaba a Mongo. Mismo backend que usa la
// edición inline del Planner para la columna "descanso".
test("updateCustomExercise persiste restSeconds al editar una serie existente", async () => {
  const setId = new mongoose.Types.ObjectId().toString();
  const exerciseId = new mongoose.Types.ObjectId().toString();

  const bulkWriteCall = mock.method(setSchema, "bulkWrite", async () => ({}));
  mock.method(customExerciseSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(customExerciseSchema, "findById", async () => ({}));

  const customExercise = {
    _id: exerciseId,
    sets: [{ _id: setId, weight: 80, restSeconds: 90 }],
  };

  await dao.updateCustomExercise(customExercise, [], [], []);

  const bulkOps = bulkWriteCall.mock.calls[0].arguments[0];
  assert.equal(bulkOps.length, 1);
  assert.equal(bulkOps[0].updateOne.update.$set.restSeconds, 90);
});

test("borra restSeconds (no lo deja huérfano) cuando el checkbox se desactiva", async () => {
  const setId = new mongoose.Types.ObjectId().toString();
  const exerciseId = new mongoose.Types.ObjectId().toString();

  const bulkWriteCall = mock.method(setSchema, "bulkWrite", async () => ({}));
  mock.method(customExerciseSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(customExerciseSchema, "findById", async () => ({}));

  // submit() en ManageSetComponent manda null explícito cuando
  // restSecondsEnabled está desactivado (ver manage-set.component.ts).
  const customExercise = {
    _id: exerciseId,
    sets: [{ _id: setId, weight: 80, restSeconds: null }],
  };

  await dao.updateCustomExercise(customExercise, [], [], []);

  const bulkOps = bulkWriteCall.mock.calls[0].arguments[0];
  assert.equal(bulkOps[0].updateOne.update.$unset.restSeconds, "");
});
