const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../workouts/workout-schema");
const WorkoutTemplate = require("./workout-template-schema");
const DietTemplate = require("../dietTemplates/diet-template-schema");
const DietPhase = require("../dietPhases/diet-phase-schema");
const workoutTemplateDao = require("./workout-template-dao");

// Colecciones con varios papeles (docs/analisis-modelo-datos.md §3.3): cada
// papel es su propio modelo, con solo sus campos y solo sus documentos.
const db = useTestDb();

test("sesión y plantilla comparten colección pero cada modelo ve solo lo suyo", async () => {
  await db.reset();
  const session = await Workout.create({ name: "Pierna" });
  const stored = await db.raw("workouts").findOne({ _id: session._id });
  assert.equal(stored.kind, "session");
  for (const field of ["trainerId", "description", "level", "tags", "equipment"]) {
    assert.equal(stored[field], undefined, `${field} no se estampa en la sesión`);
  }

  const trainerId = db.oid();
  const created = await workoutTemplateDao.create(trainerId, { name: "Torso", blocks: [] });
  assert.deepEqual([created.description, created.level, created.tags, created.equipment], ["", "intermedio", [], []]);
  assert.equal((await db.raw("workouts").findOne({ _id: created._id })).kind, "template");

  assert.deepEqual((await Workout.find({}).lean()).map((w) => w.name), ["Pierna"]);
  assert.equal(await Workout.countDocuments({}), 1);
  assert.equal(await Workout.findById(created._id), null, "una plantilla no se lee como sesión ni por _id");
  assert.equal(await WorkoutTemplate.findById(session._id), null);
  assert.deepEqual((await workoutTemplateDao.listByTrainer(trainerId)).map((t) => t.name), ["Torso"]);
});

test("dieta: la plantilla de biblioteca no guarda nada de fase; la fase exige cliente, inicio y contenido desde su inicio", async () => {
  await db.reset();
  const trainerId = db.oid();
  const template = await DietTemplate.create({ trainerId, name: "Base", clientId: db.oid(), startDate: "2026-10-05" });
  const stored = await db.raw("diettemplates").findOne({ _id: template._id });
  assert.equal(stored.clientId, undefined, "una plantilla no es de ningún cliente");
  assert.equal(stored.startDate, undefined);

  await assert.rejects(DietPhase.create({ trainerId, name: "Sin cliente", startDate: "2026-10-05", contents: [{ startDate: "2026-10-05" }] }), /clientId/);
  await assert.rejects(DietPhase.create({ trainerId, clientId: db.oid(), name: "Vacía", startDate: "2026-10-05" }), /contenido/);
  await assert.rejects(
    DietPhase.create({ trainerId, clientId: db.oid(), name: "Desfasada", startDate: "2026-10-05", contents: [{ startDate: "2026-10-12" }] }),
    /empieza con ella/,
  );
  const phase = await DietPhase.create({ trainerId, clientId: db.oid(), name: "Ok", startDate: "2026-10-05", contents: [{ startDate: "2026-10-05" }] });
  assert.equal(phase.endDate, null);
});
