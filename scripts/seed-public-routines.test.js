const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const {
  FAILURE,
  buildRoutineDocuments,
  checkExercises,
  planSeed,
  prescribeSets,
  rirForWeek,
  seedPublicRoutines,
} = require("./seed-public-routines");
const { EXERCISES, ROUTINES, WEEKS, DELOAD_RIR } = require("./data/public-routines");
const tableDao = require("../components/tables/table-dao");

const db = useTestDb();

const BLOCK_TYPES = new Set(["straight", "superset", "circuit", "warmup", "finisher"]);
const PURPOSES = new Set(["regular", "accumulation", "intensification", "peak", "deload", "vacation"]);
const CARDIO = new Set(["cinta", "bici_estatica", "eliptica", "remo_ergometro", "comba", "mountain_climbers", "skipping"]);
const TIME = /^\d{1,2}:[0-5]\d$/;

const [S1, S2, S3, S4] = WEEKS;

// ─── Datos ─────────────────────────────────────────────────────────────

test("las rutinas tienen nombre único y caben en el schema", () => {
  const names = ROUTINES.map((routine) => routine.name.trim().toLowerCase());
  assert.equal(new Set(names).size, names.length, "nombre de rutina repetido");
  for (const routine of ROUTINES) {
    assert.ok(routine.name.length <= 100, `"${routine.name}": nombre de más de 100 caracteres`);
    assert.ok(routine.workouts.length >= 3, `"${routine.name}": menos de 3 sesiones`);
    const sessionNames = routine.workouts.map((workout) => workout.name);
    assert.equal(new Set(sessionNames).size, sessionNames.length, `"${routine.name}": sesión repetida`);
    for (const workout of routine.workouts) {
      assert.ok(workout.name.length <= 100 && (workout.notes || "").length <= 500, `"${workout.name}": nombre o nota demasiado largos`);
    }
  }
});

test("el bloque de 4 semanas progresa y acaba en descarga", () => {
  assert.deepEqual(
    WEEKS.map((week) => week.purpose),
    ["accumulation", "accumulation", "intensification", "deload"],
  );
  for (const week of WEEKS) {
    assert.ok(PURPOSES.has(week.purpose));
    assert.ok(week.name.length <= 100 && week.objective.length <= 300, `${week.name}: texto demasiado largo`);
  }
});

test("cada ejercicio de las rutinas está bien pautado", () => {
  for (const routine of ROUTINES) {
    for (const workout of routine.workouts) {
      const blocks = new Map((workout.blocks || []).map((block) => [block.key, block]));
      assert.equal(blocks.size, (workout.blocks || []).length, `${workout.name}: clave de bloque repetida`);
      for (const block of blocks.values()) {
        assert.ok(BLOCK_TYPES.has(block.type), `${workout.name}: tipo de bloque "${block.type}"`);
        assert.ok(Number.isInteger(block.rounds) && block.rounds >= 1, `${workout.name}: "${block.key}" sin rondas`);
        assert.ok(workout.exercises.some((item) => item.block === block.key), `${workout.name}: bloque "${block.key}" vacío`);
      }

      for (const item of workout.exercises) {
        const where = `${routine.name} › ${workout.name} › ${item.ex}`;
        assert.ok(EXERCISES[item.ex], `${where}: no está en exercises.js`);
        assert.ok(!item.notes || item.notes.length <= 500, `${where}: nota de más de 500 caracteres`);
        assert.ok(Boolean(item.time) !== Boolean(item.reps), `${where}: o tiempo o repeticiones`);
        if (item.time) assert.match(item.time, TIME, `${where}: tiempo "M:SS"`);
        if (CARDIO.has(item.ex)) assert.ok(item.time, `${where}: el cardio se pauta por tiempo`);
        if (item.reps) {
          assert.ok(item.reps.length === 1 || (item.reps.length === 2 && item.reps[0] < item.reps[1]), `${where}: rango de repeticiones`);
          assert.ok(item.reps.every((reps) => Number.isInteger(reps) && reps > 0 && reps <= 50), `${where}: repeticiones`);
        }
        if (item.rir != null) assert.ok(Number.isInteger(item.rir) && item.rir >= 0 && item.rir <= DELOAD_RIR, `${where}: RIR`);
        if (item.block) {
          assert.ok(blocks.has(item.block), `${where}: bloque "${item.block}" sin definir`);
          assert.equal(item.sets, undefined, `${where}: dentro de un bloque las series son las rondas`);
          assert.equal(item.rest, undefined, `${where}: dentro de un bloque el descanso lo marca el bloque`);
        } else {
          assert.ok(Number.isInteger(item.sets) && item.sets >= 1 && item.sets <= 6, `${where}: series`);
          assert.ok(Number.isInteger(item.rest) && item.rest >= 0 && item.rest <= 600, `${where}: descanso`);
        }
      }
    }
  }
});

test("los ejercicios apuntan a ids distintos del catálogo y se usan todos", () => {
  const entries = Object.entries(EXERCISES);
  const ids = entries.map(([, entry]) => entry.exercise);
  assert.equal(new Set(ids).size, ids.length, "dos claves con el mismo ejercicio");
  for (const [key, entry] of entries) {
    assert.match(entry.exercise, /^[0-9a-f]{24}$/, `${key}: _id no válido`);
    assert.ok(entry.name, `${key}: sin nombre`);
  }
  const used = new Set(ROUTINES.flatMap((routine) => routine.workouts.flatMap((workout) => workout.exercises.map((item) => item.ex))));
  assert.deepEqual(Object.keys(EXERCISES).filter((key) => !used.has(key)), []);
});

// ─── Pauta por semana ──────────────────────────────────────────────────

const ids = () => {
  let next = 0;
  return () => `id${next++}`;
};
const pauta = (sets) => sets.map((set) => [set.expectedReps, set.expectedRir, set.restSeconds]);

test("el RIR baja cada semana sin pasar de 1 en los básicos ni de 0 en los de aislamiento", () => {
  const compound = { sets: 4, reps: [6, 8], rir: 2, rest: 150 };
  const isolation = { sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true };
  assert.deepEqual(WEEKS.map((week) => rirForWeek(compound, week)), [2, 1, 1, DELOAD_RIR]);
  assert.deepEqual(WEEKS.map((week) => rirForWeek(isolation, week)), [2, 1, 0, DELOAD_RIR]);
  assert.equal(rirForWeek({ sets: 3, reps: [30, 40] }, S2), null, "sin RIR en la semana 1, sin RIR siempre");
});

test("la semana 3 lleva al fallo solo la última serie de los de aislamiento", () => {
  const isolation = { sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true };
  assert.deepEqual(pauta(prescribeSets(isolation, S3, { newId: ids() })), [
    [[12, 15], [0], 60],
    [[12, 15], [0], 60],
    [[12, 15], [FAILURE], 60],
  ]);
  const compound = { sets: 2, reps: [5], rir: 3, rest: 180 };
  assert.deepEqual(pauta(prescribeSets(compound, S3, { newId: ids() })), [
    [[5], [1], 180],
    [[5], [1], 180],
  ]);
  assert.ok(prescribeSets(isolation, S2, { newId: ids() }).every((set) => set.expectedRir[0] !== FAILURE));
});

test("la descarga hace la mitad de series lejos del fallo", () => {
  const item = { sets: 3, reps: [10, 12], rir: 2, rest: 90, isolation: true };
  assert.deepEqual(pauta(prescribeSets(item, S4, { newId: ids() })), [
    [[10, 12], [DELOAD_RIR], 90],
    [[10, 12], [DELOAD_RIR], 90],
  ]);
  assert.equal(prescribeSets({ sets: 1, time: "15:00", rest: 0 }, S4, { newId: ids() }).length, 1);
});

test("en un bloque las series son las rondas y el descanso lo marca el bloque", () => {
  const block = { rounds: 3, restBetweenExercises: 15, restBetweenRounds: 90 };
  const item = { reps: [12], rir: 2 };
  for (const week of WEEKS) {
    assert.equal(prescribeSets(item, week, { block, newId: ids() }).length, 3, `${week.name}: las rondas no cambian`);
  }
  assert.deepEqual(prescribeSets(item, S1, { block, newId: ids() }).map((set) => set.restSeconds), [15, 15, 15]);
  assert.deepEqual(prescribeSets(item, S1, { block, isLastInBlock: true, newId: ids() }).map((set) => set.restSeconds), [90, 90, 90]);
});

test("cardio e isométricos se pautan por tiempo, sin repeticiones ni RIR", () => {
  const [set] = prescribeSets({ sets: 1, time: "0:40", rest: 45 }, S1, { newId: ids() });
  assert.deepEqual(set, { _id: "id0", order: 0, expectedTime: "0:40", restSeconds: 45 });
});

// ─── Documentos ────────────────────────────────────────────────────────

test("construye la rutina sin dueño con un microciclo por semana y filas alineadas", () => {
  for (const routine of ROUTINES) {
    const { table, workouts } = buildRoutineDocuments(routine);
    assert.equal("userId" in table, false, `${routine.name}: una rutina pública no tiene dueño`);
    assert.deepEqual(table.splits.map((split) => split.name), WEEKS.map((week) => week.name));
    assert.equal(workouts.length, WEEKS.length * routine.workouts.length);

    const byId = new Map(workouts.map((workout) => [String(workout._id), workout]));
    const rows = routine.workouts.map((_, index) => table.splits.map((split) => byId.get(String(split.workouts[index]))));
    rows.forEach((row, index) => {
      const where = `${routine.name} › ${routine.workouts[index].name}`;
      assert.ok(row.every((workout) => workout.name === routine.workouts[index].name), `${where}: la fila no está alineada`);
      const blockIds = row.map((workout) => workout.blocks.map((block) => String(block._id)).join());
      assert.equal(new Set(blockIds).size, 1, `${where}: los bloques no son los mismos en toda la fila`);
      for (const workout of row) {
        const own = new Set(workout.blocks.map((block) => String(block._id)));
        assert.ok(workout.exercises.every((item) => item.blockId === null || own.has(String(item.blockId))), `${where}: blockId huérfano`);
        assert.ok(workout.blocks.every((block) => !("key" in block)), `${where}: la clave del bloque no se guarda`);
        for (const item of workout.exercises) {
          for (const set of item.sets) {
            for (const field of ["doned", "donedAt", "reps", "rir", "weight", "cronometer", "time"]) {
              assert.equal(field in set, false, `${where}: la serie lleva "${field}"`);
            }
          }
        }
      }
    });
  }
});

test("solo usa ejercicios del catálogo que existen y no están retirados", () => {
  const catalog = {
    sentadilla: { exercise: "65ca4135c595b8b7d1509947" },
    banca: { exercise: "65ca4135c595b8b7d1509941" },
    propio: { exercise: "65ca4135c595b8b7d1509950" },
    retirado: { exercise: "65ca4135c595b8b7d1509951" },
  };
  const { available, missing, owned, retired } = checkExercises(catalog, [
    { _id: catalog.sentadilla.exercise },
    { _id: catalog.propio.exercise, userId: "u1" },
    { _id: catalog.retirado.exercise, deletedAt: new Date() },
  ]);
  assert.deepEqual([...available], ["sentadilla"]);
  assert.deepEqual(missing, ["banca"]);
  assert.deepEqual(owned, ["propio"]);
  assert.deepEqual(retired, ["retirado"]);
});

test("planifica: crea lo que falta, respeta lo que existe y bloquea lo que no tiene ejercicios", () => {
  const routine = (name, ...keys) => ({ name, workouts: [{ exercises: keys.map((ex) => ({ ex })) }] });
  const plan = planSeed({
    routines: [routine("A", "sentadilla"), routine("B", "sentadilla", "banca"), routine("C", "banca")],
    availableKeys: new Set(["sentadilla"]),
    existingNames: new Set(["C"]),
  });
  assert.deepEqual(plan.toCreate.map((item) => item.name), ["A"]);
  assert.deepEqual(plan.existing.map((item) => item.name), ["C"]);
  assert.deepEqual(plan.blocked.map(({ routine: item, missingKeys }) => [item.name, missingKeys]), [["B", ["banca"]]]);
});

// ─── Contra la base de datos ───────────────────────────────────────────

async function seedCatalog({ skip = [], owned = [] } = {}) {
  const docs = Object.entries(EXERCISES)
    .filter(([key]) => !skip.includes(key))
    .map(([key, entry]) => ({
      _id: db.oid(entry.exercise),
      name: entry.name,
      ...(owned.includes(key) ? { userId: db.oid() } : {}),
    }));
  await db.raw("exercises").insertMany(docs);
}

const publicTables = () => db.raw("tables").countDocuments({ userId: { $exists: false } });
const sessionCount = () => ROUTINES.reduce((total, routine) => total + routine.workouts.length * WEEKS.length, 0);

test("siembra todas las rutinas públicas con sus sesiones", async () => {
  await db.reset();
  await seedCatalog();

  const stats = await seedPublicRoutines();
  assert.deepEqual(stats, {
    routines: ROUTINES.length,
    created: ROUTINES.length,
    toCreate: ROUTINES.length,
    existing: 0,
    blocked: 0,
    missingExercises: 0,
  });
  assert.equal(await publicTables(), ROUTINES.length);
  assert.equal(await db.raw("workouts").countDocuments({ kind: "session" }), sessionCount());

  const listed = await tableDao.getTables(0, 50, false, db.oid(), true);
  assert.deepEqual(listed.map((table) => table.name).sort(), ROUTINES.map((routine) => routine.name).sort(), "salen como rutinas públicas");

  const saved = await db.raw("tables").findOne({ name: "Torso / Pierna · 4 días · Intermedio" });
  assert.equal(saved.assignedByTrainerId, null);
  assert.deepEqual(saved.splits.map((split) => split.purpose), WEEKS.map((week) => week.purpose));
  const firstSession = await db.raw("workouts").findOne({ _id: saved.splits[0].workouts[0] });
  assert.equal(firstSession.name, "Torso A · Fuerza");
  assert.equal(String(firstSession.exercises[0].exercise), EXERCISES.press_banca.exercise);
  assert.deepEqual(firstSession.exercises[0].sets.map((set) => set.expectedReps), [[6, 8], [6, 8], [6, 8], [6, 8]]);
});

test("un profesional puede asignarla a un cliente con toda la pauta", async () => {
  await db.reset();
  await seedCatalog();
  await seedPublicRoutines();
  const source = await db.raw("tables").findOne({ name: "Fuerza 5×5 · 3 días" });
  const clientId = db.oid();
  const trainerId = db.oid();

  const copy = await tableDao.copyTableForClient(clientId, source._id, trainerId);
  assert.equal(String(copy.userId), String(clientId));
  assert.equal(copy.splits.length, WEEKS.length);
  const deload = await db.raw("workouts").findOne({ _id: copy.splits[3].workouts[0]._id });
  assert.deepEqual(deload.exercises[0].sets.map((set) => set.expectedRir), [[DELOAD_RIR], [DELOAD_RIR], [DELOAD_RIR]]);
});

test("es idempotente: una segunda pasada no crea ni toca nada", async () => {
  await db.reset();
  await seedCatalog();
  await seedPublicRoutines();
  const before = await db.raw("tables").findOne({ name: "Fuerza 5×5 · 3 días" });

  const stats = await seedPublicRoutines();
  assert.equal(stats.created, 0);
  assert.equal(stats.existing, ROUTINES.length);
  assert.equal(await publicTables(), ROUTINES.length);
  assert.equal(await db.raw("workouts").countDocuments({}), sessionCount());
  assert.deepEqual(await db.raw("tables").findOne({ name: "Fuerza 5×5 · 3 días" }), before);
});

test("una rutina de un usuario con el mismo nombre no cuenta como existente", async () => {
  await db.reset();
  await seedCatalog();
  await db.raw("tables").insertOne({ name: "Fuerza 5×5 · 3 días", userId: db.oid(), splits: [] });

  const stats = await seedPublicRoutines();
  assert.equal(stats.created, ROUTINES.length);
  assert.equal(await db.raw("tables").countDocuments({ name: "Fuerza 5×5 · 3 días" }), 2);
});

test("--dry-run informa sin escribir", async () => {
  await db.reset();
  await seedCatalog();

  const stats = await seedPublicRoutines({ dryRun: true });
  assert.equal(stats.toCreate, ROUTINES.length);
  assert.equal(stats.created, 0);
  assert.equal(await db.raw("tables").countDocuments({}), 0);
  assert.equal(await db.raw("workouts").countDocuments({}), 0);
});

test("sin un ejercicio del catálogo, solo se quedan fuera las rutinas que lo usan", async () => {
  await db.reset();
  await seedCatalog({ skip: ["peso_muerto"], owned: ["comba"] });
  const lines = [];

  const stats = await seedPublicRoutines({ log: (line) => lines.push(line) });
  const uses = (key) => (routine) => routine.workouts.some((workout) => workout.exercises.some((item) => item.ex === key));
  const blocked = ROUTINES.filter((routine) => uses("peso_muerto")(routine) || uses("comba")(routine));
  assert.ok(blocked.length > 0);
  assert.equal(stats.blocked, blocked.length);
  assert.equal(stats.missingExercises, 2);
  assert.equal(await publicTables(), ROUTINES.length - blocked.length);
  assert.ok(lines.some((line) => line.includes('falta el ejercicio "peso_muerto"')));
  assert.ok(lines.some((line) => line.includes('"comba"') && line.includes("es de un usuario")));
});

test("no escribe nada si la base sigue en el modelo viejo", async () => {
  await db.reset();
  await seedCatalog();
  await db.raw("tables").insertOne({ name: "Vieja", splits: [db.oid()] });

  await assert.rejects(seedPublicRoutines(), /npm run migrate\./);
  assert.equal(await db.raw("tables").countDocuments({}), 1);
  assert.equal(await db.raw("workouts").countDocuments({}), 0);
});
