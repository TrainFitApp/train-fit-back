const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Table = require("../../components/tables/table-schema");
const Workout = require("../../components/workouts/workout-schema");
const WorkoutTemplate = require("../../components/workoutTemplates/workout-template-schema");
const Exercise = require("../../components/exercises/exercise-schema");
const pinnedNoteDao = require("../../components/pinnedExerciseNotes/pinned-exercise-note-dao");
const { migrateEmbedTraining } = require("./03-embed-training");

// Datos en el formato ANTERIOR (colecciones sueltas), sembrados en crudo.
const db = useTestDb();

async function seedOldFormat() {
  const exercise = await Exercise.create({ name: "Sentadilla" });
  const [s1, s2, s3, orphanSet] = [db.oid(), db.oid(), db.oid(), db.oid()];
  await db.raw("sets").insertMany([
    { _id: s1, reps: 5, order: 0, doned: true, donedAt: new Date("2026-01-01"), __v: 0 },
    { _id: s2, reps: 6, order: 1, expectedReps: [8], __v: 0 },
    { _id: s3, reps: 7, order: 0 },
    { _id: orphanSet, reps: 1 },
  ]);
  const [ce1, ce2, orphanCe] = [db.oid(), db.oid(), db.oid()];
  await db.raw("customexercises").insertMany([
    { _id: ce1, exercise: exercise._id, order: 0, notes: "Profundo", sets: [s1, s2, db.oid()], __v: 0 },
    { _id: ce2, exercise: exercise._id, order: 1, clientNotes: "Rodilla", blockId: null, sets: [s3] },
    { _id: orphanCe, exercise: exercise._id, sets: [] },
  ]);
  const [w1, w2, template] = [db.oid(), db.oid(), db.oid()];
  await db.raw("workouts").insertMany([
    { _id: w1, name: "Pierna", exercises: [ce2, db.oid(), ce1], date: new Date("2026-01-02"), __v: 0 },
    { _id: w2, name: "Vacío", exercises: [] },
    { _id: template, name: "Plantilla", trainerId: db.oid(), exercises: [ce1] },
  ]);
  const [sp1, sp2] = [db.oid(), db.oid()];
  await db.raw("splits").insertMany([
    { _id: sp1, name: "Micro 1", purpose: "deload", objective: "Descargar", workouts: [w1], __v: 0 },
    { _id: sp2, name: "Micro 2", workouts: [w2] },
  ]);
  const table = db.oid();
  const owner = db.oid();
  await db.raw("tables").insertOne({ _id: table, name: "Rutina", userId: owner, splits: [sp2, db.oid(), sp1], __v: 0 });
  const note = db.oid();
  await db.raw("pinnedexercisenotes").insertMany([
    { _id: note, tableId: table, workoutIndex: 0, exerciseIndex: 1, notes: "Codo pegado", authorRole: "trainer", __v: 0 },
  ]);
  return { exercise, ids: { s1, s2, s3, ce1, ce2, w1, w2, template, sp1, sp2, table, note } };
}

test("dry-run cuenta lo que haría y no escribe nada", async () => {
  await db.reset();
  await seedOldFormat();
  const stats = await migrateEmbedTraining(db.mongoose.connection.db, { dryRun: true });
  assert.equal(stats.workouts, 2, "la sesión real y la plantilla (la vacía ya vale)");
  assert.equal(stats.tables, 1);
  assert.equal(stats.danglingExercises, 1);
  assert.equal(stats.danglingSets, 2, "la ref colgante cuenta una vez por sesión que la usa");
  assert.equal(stats.danglingSplits, 1);
  assert.equal(stats.orphanExercises, 1);
  assert.equal(stats.orphanSets, 1);
  const raw = await db.raw("workouts").findOne({ name: "Pierna" });
  assert.ok(raw.exercises[0]._bsontype, "sigue como referencia");
});

test("migra conservando ids, orden y contenido; la app lo lee igual; es idempotente", async () => {
  await db.reset();
  const { ids } = await seedOldFormat();
  const conn = db.mongoose.connection.db;

  const stats = await migrateEmbedTraining(conn);
  assert.equal(stats.exercises, 3);
  assert.equal(stats.splits, 2);
  assert.equal(stats.pinnedNotes, 1);

  const table = await Table.findById(ids.table);
  assert.deepEqual(table.splits.map((s) => String(s._id)), [String(ids.sp2), String(ids.sp1)]);
  assert.equal(table.splits[1].purpose, "deload");
  assert.equal(table.splits[1].objective, "Descargar");
  const pierna = table.splits[1].workouts[0];
  assert.equal(pierna.name, "Pierna");
  assert.deepEqual(pierna.exercises.map((e) => String(e._id)), [String(ids.ce2), String(ids.ce1)]);
  assert.equal(pierna.exercises[0].clientNotes, "Rodilla");
  assert.equal(pierna.exercises[1].notes, "Profundo");
  assert.equal(pierna.exercises[1].exercise.name, "Sentadilla", "el Exercise se sigue poblando");
  assert.deepEqual(pierna.exercises[1].sets.map((s) => [String(s._id), s.reps]), [
    [String(ids.s1), 5],
    [String(ids.s2), 6],
  ]);
  assert.equal(pierna.exercises[1].sets[0].doned, true);
  assert.deepEqual(pierna.exercises[1].sets[1].expectedReps, [8]);

  const notes = await pinnedNoteDao.findByTableId(ids.table);
  assert.deepEqual(notes.map((n) => [String(n._id), n.workoutIndex, n.exerciseIndex, n.notes]), [
    [String(ids.note), 0, 1, "Codo pegado"],
  ]);

  const template = await WorkoutTemplate.findById(ids.template).lean();
  assert.equal(template.exercises[0].sets.length, 2);
  assert.equal(template.level, "intermedio", "la plantilla toma su ficha por defecto");
  assert.equal(await Workout.findById(ids.template), null, "una plantilla no se lee como sesión");
  const rawSession = await db.raw("workouts").findOne({ _id: ids.w1 });
  assert.equal(rawSession.kind, "session");

  // Segunda pasada: nada que hacer.
  const again = await migrateEmbedTraining(conn);
  assert.equal(again.workouts + again.tables + again.exercises, 0);

  // Las colecciones viejas siguen hasta pedir --drop-old.
  const names = async () => (await conn.listCollections().toArray()).map((c) => c.name);
  assert.ok((await names()).includes("sets"));
  const dropped = await migrateEmbedTraining(conn, { dropOld: true });
  assert.deepEqual(dropped.dropped.sort(), ["customexercises", "pinnedexercisenotes", "sets", "splits"]);
  assert.ok(!(await names()).includes("sets"));
});
