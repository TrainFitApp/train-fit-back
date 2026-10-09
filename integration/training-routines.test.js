const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Rutinas: Table → Split (microciclo) → Workout → CustomExercise → Set.
// Límites del plan, quién puede leer/editar cada nivel, la protección de lo
// que asignó un profesional, las cascadas de borrado y que lo prescrito y lo
// ejecutado no se mezclen nunca.

const ctx = h.setup();

const PREMIUM = { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() + 30 * 86400000) } };

let exerciseSeq = 0;
async function catalogExercise(name) {
  exerciseSeq += 1;
  return ctx.model("Exercise").create({ name: name || `Ejercicio ${exerciseSeq}` });
}

/**
 * Rutina completa sembrada directamente en BD (la creación por API se prueba
 * aparte): `shape` = [[nSets por ejercicio…] por workout…] por split. Los ids
 * de cada nivel se devuelven aplanados, en orden.
 */
async function seedRoutine(owner, { name = "Rutina", assignedBy = null, shape = [[[2, 2], [3]]] } = {}) {
  const splits = [];
  for (const [s, workouts] of shape.entries()) {
    const workoutDefs = [];
    for (const [w, exercises] of workouts.entries()) {
      const exerciseDefs = [];
      for (const [e, nSets] of exercises.entries()) {
        exerciseDefs.push({
          exercise: (await catalogExercise())._id,
          order: e,
          sets: Array.from({ length: nSets }, (_, i) => ({ order: i, expectedReps: [8, 10], expectedRir: [2] })),
        });
      }
      workoutDefs.push({ name: `W${s}.${w}`, order: w, exercises: exerciseDefs });
    }
    splits.push({ name: `Micro ${s + 1}`, workouts: workoutDefs });
  }
  const { table, workouts } = await ctx.seedTable({ owner, name, assignedBy, splits });
  const ids = {
    splits: table.splits.map((split) => split._id),
    workouts: workouts.map((workout) => workout._id),
    customExercises: workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise._id)),
    sets: workouts.flatMap((workout) => workout.exercises.flatMap((exercise) => exercise.sets.map((set) => set._id))),
  };
  return { table, ids };
}

// --- Crear rutinas y límites del plan --------------------------------------------

test("crear rutina propia: queda en uso, sin entreno en curso, y sale en 'mis rutinas'", async () => {
  const user = await ctx.makeClient({ fields: { workoutInUse: ctx.oid() } });
  const table = await ctx.post(user, `/tables/user/${user.id}`, { name: "Fuerza 3 días" });
  assert.equal(String(table.userId), user.id);
  const me = (await ctx.get(user, "/auth/me")).user;
  assert.equal(String(me.tableInUse), String(table._id));
  assert.equal(me.workoutInUse ?? null, null);
  const own = await ctx.get(user, "/tables?own=true");
  assert.deepEqual(own.map((t) => t.name), ["Fuerza 3 días"]);
});

test("límite free: 1 rutina; la segunda (crear, copiar o duplicar) da PREMIUM_LIMIT_ROUTINES", async () => {
  const user = await ctx.makeClient();
  const first = await ctx.post(user, `/tables/user/${user.id}`, { name: "Única" });
  for (const [method, path] of [
    ["POST", `/tables/user/${user.id}`],
    ["POST", `/tables/copy/${first._id}`],
    ["POST", `/tables/duplicate/${first._id}`],
  ]) {
    const res = await ctx.call(user, method, path, { name: "Otra", idUser: user.id });
    assert.equal(res.status, 403, path);
    assert.equal(res.body.code, "PREMIUM_LIMIT_ROUTINES");
  }
  assert.equal(await ctx.count("Table", { userId: user._id }), 1);
});

test("premium vigente: varias rutinas; premium caducado vuelve al límite free", async () => {
  const premium = await ctx.makeClient({ fields: PREMIUM });
  for (let i = 0; i < 3; i += 1) await ctx.post(premium, `/tables/user/${premium.id}`, { name: `R${i}` });
  assert.equal(await ctx.count("Table", { userId: premium._id }), 3);

  const expired = await ctx.makeClient({ fields: { premium: { entitled: true, expiresAt: new Date(Date.now() - 1000) } } });
  await ctx.post(expired, `/tables/user/${expired.id}`, { name: "Una" });
  assert.equal((await ctx.call(expired, "POST", `/tables/user/${expired.id}`, { name: "Dos" })).status, 403);
});

test("las rutinas que asignó el entrenador no cuentan para el límite mientras la relación de entrenamiento siga activa", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  await seedRoutine(client, { name: "Asignada", assignedBy: trainer });
  await ctx.post(client, `/tables/user/${client.id}`, { name: "Mía" });

  // Al terminar la relación, la exención se pierde de inmediato.
  await ctx.endRelation(trainer, client);
  const res = await ctx.call(client, "POST", `/tables/user/${client.id}`, { name: "Otra mía" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "PREMIUM_LIMIT_ROUTINES");
});

test("crear rutina para otro usuario: 403", async () => {
  const user = await ctx.makeClient();
  const victim = await ctx.makeClient();
  assert.equal((await ctx.call(user, "POST", `/tables/user/${victim.id}`, { name: "Intrusa" })).status, 403);
  assert.equal(await ctx.count("Table", { userId: victim._id }), 0);
});

test("límite free de microciclos: 4 por rutina; premium sigue; el 5º da PREMIUM_LIMIT_MICROCYCLES", async () => {
  const user = await ctx.makeClient();
  const table = await ctx.post(user, `/tables/user/${user.id}`, { name: "Con micros" });
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await ctx.call(user, "POST", `/splits/blank/${table._id}`, { name: `M${i}` })).status, 201);
  }
  const fifth = await ctx.call(user, "POST", `/splits/blank/${table._id}`, { name: "M5" });
  assert.equal(fifth.status, 403);
  assert.equal(fifth.body.code, "PREMIUM_LIMIT_MICROCYCLES");
  assert.equal((await ctx.model("Table").findById(table._id).lean()).splits.length, 4);

  await ctx.model("User").updateOne({ _id: user._id }, { $set: PREMIUM });
  assert.equal((await ctx.call(user, "POST", `/splits/blank/${table._id}`, { name: "M5" })).status, 201);
});

test("el entrenador puede pasar de 4 microciclos en la rutina asignada a su cliente (exenta)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { table, ids } = await seedRoutine(client, { assignedBy: trainer, shape: [[[1]], [[1]], [[1]], [[1]]] });
  const fifth = await ctx.call(trainer, "PUT", "/splits/add/to/table", { idTable: table._id, idSplit: ids.splits[3], withSets: true });
  assert.equal(fifth.status, 200, JSON.stringify(fifth.body));
  assert.equal((await ctx.model("Table").findById(table._id).lean()).splits.length, 5);
});

test("microciclo en blanco solo en una rutina sin entrenamientos: las filas no se descuadran", async () => {
  const user = await ctx.makeClient();
  const { table, ids } = await seedRoutine(user, { shape: [[[1], [1]], [[1], [1]]] });

  const blank = await ctx.call(user, "POST", `/splits/blank/${table._id}`, { name: "Vacío" });
  assert.equal(blank.status, 409);
  assert.equal(blank.body.code, "SPLIT_BLANK_WITH_WORKOUTS");
  const unknownSource = await ctx.call(user, "PUT", "/splits/add/to/table", { idTable: table._id, idSplit: ctx.oid() });
  assert.equal(unknownSource.status, 409);
  assert.equal(unknownSource.body.code, "SPLIT_BLANK_WITH_WORKOUTS");
  assert.equal((await ctx.model("Table").findById(table._id).lean()).splits.length, 2);

  const copy = await ctx.call(user, "PUT", "/splits/add/to/table", { idTable: table._id, idSplit: ids.splits[1] });
  assert.equal(copy.status, 200, JSON.stringify(copy.body));
  const saved = await ctx.model("Table").findById(table._id).lean();
  assert.deepEqual(saved.splits.map((split) => split.workouts.length), [2, 2, 2], "duplicar sí: misma forma");
});

// --- Leer y permisos ----------------------------------------------------------------

test("leer rutina: dueño sí, otro usuario no, entrenador solo con relación de ENTRENAMIENTO activa", async () => {
  const owner = await ctx.makeClient();
  const stranger = await ctx.makeClient();
  const trainer = await ctx.makeTrainer();
  const nutritionist = await ctx.makeTrainer();
  const exTrainer = await ctx.makeTrainer();
  await ctx.relate(trainer, owner, { scope: "training" });
  await ctx.relate(nutritionist, owner, { scope: "nutrition" });
  await ctx.relate(exTrainer, owner, { scope: "training", status: "revoked" });
  const { table, ids } = await seedRoutine(owner);

  assert.equal((await ctx.call(owner, "GET", `/tables/${table._id}`)).status, 200);
  assert.equal((await ctx.call(trainer, "GET", `/tables/${table._id}`)).status, 200);
  assert.equal((await ctx.call(stranger, "GET", `/tables/${table._id}`)).status, 403);
  assert.equal((await ctx.call(nutritionist, "GET", `/tables/${table._id}`)).status, 403);
  assert.equal((await ctx.call(exTrainer, "GET", `/tables/${table._id}`)).status, 403);
  assert.equal((await ctx.call(owner, "GET", `/tables/${ctx.oid()}`)).status, 404);

  // Lo mismo bajando de nivel: workout, ejercicio y serie.
  const workoutId = ids.workouts[0];
  assert.equal((await ctx.call(stranger, "GET", `/workouts/${workoutId}`)).status, 403);
  assert.equal((await ctx.call(owner, "GET", `/workouts/${workoutId}`)).status, 200);
});

test("lo que cambia el entrenador en la rutina del cliente lo ve el cliente al leerla", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { table } = await seedRoutine(client, { assignedBy: trainer });
  await ctx.put(trainer, "/tables", { _id: table._id, name: "Hipertrofia (rev. coach)" });
  assert.equal((await ctx.get(client, `/tables/${table._id}`)).name, "Hipertrofia (rev. coach)");
});

test("renombrar: propia sí (y se ve en el listado); sin nombre 400; inexistente 404", async () => {
  const user = await ctx.makeClient();
  const { table } = await seedRoutine(user, { name: "Vieja" });
  await ctx.put(user, "/tables", { _id: table._id, name: "Nueva" });
  assert.deepEqual((await ctx.get(user, "/tables?own=true")).map((t) => t.name), ["Nueva"]);
  assert.equal((await ctx.call(user, "PUT", "/tables", { _id: table._id })).status, 400);
  assert.equal((await ctx.call(user, "PUT", "/tables", { _id: ctx.oid(), name: "x" })).status, 404);
});

// --- Bloques (superseries, circuitos…) ---------------------------------------------

test("bloques en rutina propia: el cliente los crea y agrupa ejercicios, en toda la fila; otro usuario no", async () => {
  const owner = await ctx.makeClient();
  const stranger = await ctx.makeClient();
  const [press, row] = [await catalogExercise("Press"), await catalogExercise("Remo")];
  const day = (name) => ({
    name,
    exercises: [press, row].map((exercise, order) => ({
      exercise: exercise._id,
      order,
      sets: [{ order: 0, expectedReps: [8] }],
    })),
  });
  const { workouts } = await ctx.seedTable({
    owner,
    splits: [
      { name: "Semana 1", workouts: [day("Torso")] },
      { name: "Semana 2", workouts: [day("Torso")] },
    ],
  });
  const [week1, week2] = workouts;

  const created = await ctx.put(owner, `/workouts/${week1._id}/blocks`, {
    blocks: [{ name: "Superserie A", type: "superset", rounds: "3" }],
  });
  const [block] = created.blocks;
  assert.equal(block.name, "Superserie A");
  assert.equal(block.rounds, 3);
  const sibling = (await ctx.model("Workout").findById(week2._id).lean()).blocks;
  assert.deepEqual(sibling.map((b) => String(b._id)), [String(block._id)], "el bloque es de la fila");

  const moved = await ctx.put(owner, `/customexercises/${week1.exercises[0]._id}/block`, { blockId: block._id });
  assert.equal(String(moved.blockId), String(block._id));
  const week2Press = (await ctx.model("Workout").findById(week2._id).lean()).exercises[0];
  assert.equal(String(week2Press.blockId), String(block._id), "el mismo ejercicio de la fila entra en el bloque");

  const foreign = await ctx.call(owner, "PUT", `/customexercises/${week1.exercises[1]._id}/block`, { blockId: ctx.oid() });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.code, "BLOCK_NOT_FOUND");

  assert.equal((await ctx.call(stranger, "PUT", `/workouts/${week1._id}/blocks`, { blocks: [] })).status, 403);
  assert.equal(
    (await ctx.call(stranger, "PUT", `/customexercises/${week1.exercises[1]._id}/block`, { blockId: block._id })).status,
    403,
  );
});

// --- Rutina asignada por el profesional -------------------------------------------

test("rutina asignada: el cliente NO puede cambiar su estructura (TABLE_ASSIGNED_BY_TRAINER)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { table, ids } = await seedRoutine(client, { assignedBy: trainer, shape: [[[2, 1], [1]], [[1]]] });
  const [split0, split1] = ids.splits;
  const workout = ids.workouts[0];
  const ce = ids.customExercises[0];
  const set = ids.sets[0];

  const attempts = [
    ["PUT", "/tables", { _id: table._id, name: "Mía" }],
    ["DELETE", `/tables/${table._id}`],
    ["POST", `/splits/blank/${table._id}`, { name: "Extra" }],
    ["DELETE", `/splits/${table._id}/${split1}`],
    ["PUT", `/splits/rows/order/${table._id}`, { splitIdsOrder: [split1, split0] }],
    ["PUT", "/workouts/deletes", [{ _id: workout }]],
    ["PUT", `/workouts/${workout}/blocks`, { blocks: [] }],
    ["DELETE", `/customexercises/${ce}`],
    ["PUT", `/customexercises/${ce}`, { reps: 1 }],
    ["DELETE", `/sets/${set}`],
  ];
  for (const [method, path, body] of attempts) {
    const res = await ctx.call(client, method, path, body);
    assert.equal(res.status, 403, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, "TABLE_ASSIGNED_BY_TRAINER", `${method} ${path}`);
  }
  assert.ok(await ctx.model("Table").exists({ _id: table._id }));
  assert.equal((await ctx.model("Table").findById(table._id).lean()).splits.length, 2);
  assert.ok(await ctx.findSet(set));
});

test("rutina asignada: terminada la relación de entrenamiento, el cliente ya puede renombrarla, reestructurarla, duplicarla y borrarla", async () => {
  const trainer = await ctx.makeTrainer();
  // Premium: duplicar suma una rutina y el plan Free solo admite una
  // (PREMIUM_LIMIT_ROUTINES, que es otra regla; abajo se comprueba aparte).
  const client = await ctx.makeClient({ fields: { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() + 86400000) } } });
  await ctx.relate(trainer, client, { scope: "training" });
  await ctx.relate(trainer, client, { scope: "nutrition" });
  const { table, ids } = await seedRoutine(client, { assignedBy: trainer, shape: [[[2, 1], [1]], [[1]]] });

  // Con la relación activa, bloqueada.
  const locked = await ctx.call(client, "PUT", "/tables", { _id: table._id, name: "Mía" });
  assert.equal(locked.status, 403);
  assert.equal(locked.body.code, "TABLE_ASSIGNED_BY_TRAINER");

  // Terminar solo nutrición no la libera: el candado es del entrenamiento.
  await ctx.endRelation(trainer, client, "nutrition");
  assert.equal((await ctx.call(client, "PUT", "/tables", { _id: table._id, name: "Mía" })).status, 403);

  await ctx.endRelation(trainer, client, "training");
  const renamed = await ctx.call(client, "PUT", "/tables", { _id: table._id, name: "Mía" });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal((await ctx.model("Table").findById(table._id).lean()).name, "Mía");

  // Estructura: borrar un ejercicio y una serie, cambiar la pauta.
  assert.equal((await ctx.call(client, "DELETE", `/sets/${ids.sets[1]}`)).status, 204);
  assert.equal((await ctx.call(client, "DELETE", `/customexercises/${ids.customExercises[1]}`)).status, 204);
  await ctx.put(client, "/sets", { _id: ids.sets[0], expectedReps: [5], expectedWeight: 60 });
  const set = await ctx.findSet(ids.sets[0]);
  assert.deepEqual(set.expectedReps, [5], "la pauta ya es suya");
  assert.equal(set.expectedWeight, 60);

  const copy = await ctx.call(client, "POST", `/tables/duplicate/${table._id}`, { idUser: client.id });
  assert.equal(copy.status, 200, JSON.stringify(copy.body));
  const copyDoc = await ctx.model("Table").findById(copy.body._id).lean();
  assert.equal(copyDoc.assignedByTrainerId ?? null, null, "la copia que hace el cliente es suya, no del profesional");
  assert.equal((await ctx.call(client, "PUT", "/tables", { _id: copy.body._id, name: "Copia mía" })).status, 200);

  assert.equal((await ctx.call(client, "DELETE", `/tables/${table._id}`)).status, 204);
  assert.equal(await ctx.model("Table").exists({ _id: table._id }), null);

  // En Free, duplicar la que le dejó su entrenador choca con el límite de
  // rutinas (no con el candado): es el aviso de pasarse a Premium.
  const free = await ctx.makeClient();
  await ctx.relate(trainer, free, { scope: "training" });
  const { table: freeTable } = await seedRoutine(free, { assignedBy: trainer });
  await ctx.endRelation(trainer, free, "training");
  const limited = await ctx.call(free, "POST", `/tables/duplicate/${freeTable._id}`, { idUser: free.id });
  assert.equal(limited.status, 403);
  assert.equal(limited.body.code, "PREMIUM_LIMIT_ROUTINES");
});

test("rutina asignada: si el cliente cambia de entrenador, la del anterior deja de estar bloqueada", async () => {
  const first = await ctx.makeTrainer();
  const second = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(first, client, { scope: "training" });
  const { table } = await seedRoutine(client, { assignedBy: first });
  await ctx.endRelation(first, client, "training");
  await ctx.relate(second, client, { scope: "training" });
  assert.equal((await ctx.call(client, "PUT", "/tables", { _id: table._id, name: "Mía" })).status, 200);
  // La del entrenador actual sí sigue bloqueada.
  const { table: current } = await seedRoutine(client, { assignedBy: second });
  assert.equal((await ctx.call(client, "PUT", "/tables", { _id: current._id, name: "Mía" })).status, 403);
});

test("rutina asignada: el cliente SÍ registra su entreno (series hechas, notas propias, sensaciones)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { ids } = await seedRoutine(client, { assignedBy: trainer });
  const set = ids.sets[0];

  await ctx.put(client, "/sets", { _id: set, reps: 9, weight: 82.5, rir: [1], doned: true });
  const stored = await ctx.findSet(set);
  assert.equal(stored.reps, 9);
  assert.equal(stored.weight, 82.5);
  assert.deepEqual(stored.expectedReps, [8, 10], "lo prescrito no se toca al registrar");
  assert.ok(stored.donedAt instanceof Date);

  await ctx.put(client, `/customexercises/${ids.customExercises[0]}/client-notes`, { clientNotes: "Molestia en hombro" });
  assert.equal((await ctx.findCustomExercise(ids.customExercises[0])).clientNotes, "Molestia en hombro");

  await ctx.put(client, "/workouts/modify/one/simple/save", { _id: ids.workouts[0], readinessPre: 4, sorenessPre: [{ muscle: "chest", level: 2 }, { muscle: "inventado", level: 9 }] });
  const workout = await ctx.model("Workout").findById(ids.workouts[0]).lean();
  assert.equal(workout.readinessPre, 4);
  assert.ok(workout.sorenessPre.every((s) => s.muscle !== "inventado"), "agujetas fuera de catálogo se descartan");
});

test("rutina asignada: el cliente no puede reescribir lo PRESCRITO de una serie", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { ids } = await seedRoutine(client, { assignedBy: trainer });
  await ctx.call(client, "PUT", "/sets", { _id: ids.sets[0], expectedReps: [20], expectedRir: [5], expectedWeight: 10, restSeconds: 5 });
  const stored = await ctx.findSet(ids.sets[0]);
  assert.deepEqual(stored.expectedReps, [8, 10]);
  assert.deepEqual(stored.expectedRir, [2]);
  assert.equal(stored.expectedWeight, undefined);
  assert.equal(stored.restSeconds, undefined);
});

test("rutina asignada: la carga pautada (expectedWeight) sobrevive a lo que levanta el cliente", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { ids } = await seedRoutine(client, { assignedBy: trainer });
  const exerciseId = ids.customExercises[0];
  const [first, second] = (await ctx.findCustomExercise(exerciseId)).sets;

  // El profesional pauta 40 kg en el Planner (la serie objetivo).
  const planned = await ctx.put(trainer, "/customexercises", {
    customExercise: {
      _id: exerciseId,
      sets: [
        { _id: first._id, expectedReps: [8, 10], expectedRir: [2], expectedWeight: 40, order: 0 },
        { _id: second._id, expectedReps: [8, 10], expectedRir: [2], expectedWeight: 40, order: 1 },
      ],
    },
  });
  assert.deepEqual(planned.sets.map((set) => set.expectedWeight), [40, 40]);
  assert.deepEqual(planned.sets.map((set) => set.weight), [undefined, undefined], "la pauta no se escribe como dato levantado");

  // El cliente apunta 42,5 kg en la primera y la marca hecha; la segunda no la hace.
  await ctx.put(client, "/sets", { ...first, expectedWeight: 40, weight: 42.5, reps: 9, doned: true });
  const done = await ctx.findSet(first._id);
  assert.equal(done.weight, 42.5, "lo levantado");
  assert.equal(done.expectedWeight, 40, "la pauta sigue intacta");
  const pending = await ctx.findSet(second._id);
  assert.equal(pending.weight, undefined, "una serie sin hacer no guarda la pauta como si fuera dato");
  assert.equal(pending.expectedWeight, 40);

  // Duplicar la fila (siguiente semana) lleva la pauta y nunca lo levantado.
  const table = await ctx.model("Table").findOne({ "splits.workouts": ids.workouts[0] }).lean();
  const duplicated = await ctx.call(trainer, "POST", `/workouts/duplicate-row/${table._id}/${ids.workouts[0]}`, {});
  assert.ok(duplicated.status < 300, JSON.stringify(duplicated.body));
  const rowIds = (await ctx.model("Table").findById(table._id).lean()).splits.flatMap((split) => split.workouts);
  const copies = await ctx.model("Workout").find({ _id: { $in: rowIds, $nin: ids.workouts } }).lean();
  assert.ok(copies.length > 0);
  for (const copy of copies) {
    const [set] = copy.exercises[0].sets;
    assert.equal(set.expectedWeight, 40);
    assert.equal(set.weight, undefined);
    assert.equal(set.doned, undefined);
  }
});

test("rutina asignada: el cliente no puede vaciar los ejercicios de un entreno vía 'modificar entreno'", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { ids } = await seedRoutine(client, { assignedBy: trainer });
  await ctx.call(client, "PUT", "/workouts/modify/one/simple/save", { _id: ids.workouts[0], exercises: [] });
  assert.equal((await ctx.model("Workout").findById(ids.workouts[0]).lean()).exercises.length, 2);
});

// --- Series: prescrito vs ejecutado ------------------------------------------------

test("serie: marcar hecha fija donedAt en el servidor; desmarcar lo limpia; vaciar un campo lo quita", async () => {
  const user = await ctx.makeClient();
  const { ids } = await seedRoutine(user);
  const set = ids.sets[0];
  await ctx.put(user, "/sets", { _id: set, doned: true, reps: 10, donedAt: "2001-01-01T00:00:00Z" });
  let stored = await ctx.findSet(set);
  assert.ok(Math.abs(new Date(stored.donedAt).getTime() - Date.now()) < 60000, "donedAt del servidor, no del cliente");
  const firstDone = stored.donedAt;

  await ctx.put(user, "/sets", { _id: set, doned: true, weight: 50 });
  stored = await ctx.findSet(set);
  assert.equal(String(stored.donedAt), String(firstDone), "re-guardar una serie hecha no mueve donedAt");

  await ctx.put(user, "/sets", { _id: set, doned: false, rir: [] });
  stored = await ctx.findSet(set);
  assert.equal(stored.donedAt, undefined);
  assert.equal(stored.rir, undefined);
  assert.deepEqual(stored.expectedRir, [2]);
});

test("serie: RIR -1 (fallo) y 0 (cero real) se guardan tal cual, distintos de 'sin dato'", async () => {
  const user = await ctx.makeClient();
  const { ids } = await seedRoutine(user, { shape: [[[3]]] });
  await ctx.put(user, "/sets", { _id: ids.sets[0], rir: [-1] });
  await ctx.put(user, "/sets", { _id: ids.sets[1], rir: [0] });
  assert.deepEqual((await ctx.findSet(ids.sets[0])).rir, [-1]);
  assert.deepEqual((await ctx.findSet(ids.sets[1])).rir, [0]);
  assert.deepEqual((await ctx.findSet(ids.sets[2])).rir ?? [], [], "sin dato = vacío, no 0");
});

test("serie: valores fuera de rango del schema (reps > 999, peso negativo) se rechazan también al EDITAR", async () => {
  const user = await ctx.makeClient();
  const { ids } = await seedRoutine(user);
  await ctx.call(user, "PUT", "/sets", { _id: ids.sets[0], reps: 5000, weight: -20 });
  const stored = await ctx.findSet(ids.sets[0]);
  assert.notEqual(stored.reps, 5000);
  assert.notEqual(stored.weight, -20);
});

test("borrar una serie renumera el orden de las que quedan", async () => {
  const user = await ctx.makeClient();
  const { ids } = await seedRoutine(user, { shape: [[[4]]] });
  await ctx.call(user, "DELETE", `/sets/${ids.sets[1]}`);
  const ce = await ctx.findCustomExercise(ids.customExercises[0]);
  assert.equal(ce.sets.length, 3);
  assert.deepEqual(ce.sets.map((s) => s.order), [0, 1, 2]);
});

// --- Copias y borrados -------------------------------------------------------------

test("duplicar rutina: copia profunda con ids nuevos en TODOS los niveles e independiente del original", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM });
  const { table, ids } = await seedRoutine(user, { name: "Base" });
  await ctx.put(user, "/sets", { _id: ids.sets[0], doned: true, reps: 7, weight: 60 });

  const copy = await ctx.post(user, `/tables/duplicate/${table._id}`, { idUser: user.id });
  assert.equal(copy.name, "Base copia");
  const full = await ctx.get(user, `/tables/${copy._id}`);
  const copiedSplitIds = full.splits.map((s) => String(s._id));
  const copiedWorkoutIds = full.splits.flatMap((s) => s.workouts.map((w) => String(w._id)));
  const copiedCeIds = full.splits.flatMap((s) => s.workouts.flatMap((w) => w.exercises.map((e) => String(e._id))));
  const copiedSets = full.splits.flatMap((s) => s.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets)));
  for (const [copied, original] of [
    [copiedSplitIds, ids.splits],
    [copiedWorkoutIds, ids.workouts],
    [copiedCeIds, ids.customExercises],
    [copiedSets.map((s) => String(s._id)), ids.sets],
  ]) {
    assert.equal(copied.length, original.length);
    assert.ok(copied.every((id) => !original.map(String).includes(id)), "ningún id compartido");
  }
  assert.deepEqual(copiedSets[0].expectedReps, [8, 10], "la pauta viaja");
  assert.notEqual(copiedSets[0].doned, true, "lo ejecutado no se arrastra como hecho");

  // Cambiar la copia no toca el original.
  await ctx.put(user, "/sets", { _id: copiedSets[0]._id, expectedReps: [3] });
  assert.deepEqual((await ctx.findSet(ids.sets[0])).expectedReps, [8, 10]);
});

test("borrar rutina propia: cascada completa (micros, entrenos, ejercicios, series, notas fijadas)", async () => {
  const user = await ctx.makeClient();
  const { table, ids } = await seedRoutine(user, { shape: [[[2, 2], [1]], [[3]]] });
  await ctx.post(user, `/pinned-exercise-notes/table/${table._id}/workout/0/exercise/0`, { notes: "Codo pegado" });
  assert.equal((await ctx.model("Table").findById(table._id).lean()).pinnedNotes.length, 1);

  assert.equal((await ctx.call(user, "DELETE", `/tables/${table._id}`)).status, 204);
  assert.equal(await ctx.count("Table", { _id: table._id }), 0);
  assert.equal(await ctx.countSplits(ids.splits), 0);
  assert.equal(await ctx.count("Workout", { _id: { $in: ids.workouts } }), 0);
  assert.equal(await ctx.countCustomExercises(ids.customExercises), 0);
  assert.equal(await ctx.countSets(ids.sets), 0);
});

test("borrar la rutina EN USO la quita del perfil (sin puntero a una rutina que ya no existe)", async () => {
  const user = await ctx.makeClient();
  const table = await ctx.post(user, `/tables/user/${user.id}`, { name: "En uso" });
  assert.equal((await ctx.call(user, "DELETE", `/tables/${table._id}`)).status, 204);
  assert.equal((await ctx.get(user, "/auth/me")).user.tableInUse ?? null, null);
});

test("borrar un microciclo arrastra sus entrenos y deja el resto", async () => {
  const user = await ctx.makeClient();
  const { table, ids } = await seedRoutine(user, { shape: [[[1]], [[2]]] });
  const res = await ctx.call(user, "DELETE", `/splits/${table._id}/${ids.splits[0]}`);
  assert.equal(res.status, 204);
  const stored = await ctx.model("Table").findById(table._id).lean();
  assert.deepEqual(stored.splits.map((split) => String(split._id)), [String(ids.splits[1])]);
  assert.equal(await ctx.countSplits([ids.splits[0]]), 0);
  assert.equal(await ctx.count("Workout", { _id: ids.workouts[0] }), 0);
  assert.equal(await ctx.countSets([ids.sets[0]]), 0);
  assert.ok(await ctx.model("Workout").exists({ _id: ids.workouts[1] }));
});

test("borrar varios microciclos: rechaza ids que no son de esa rutina", async () => {
  const user = await ctx.makeClient();
  const { table, ids } = await seedRoutine(user, { shape: [[[1]], [[1]]] });
  const other = await seedRoutine(await ctx.makeClient());
  const bad = await ctx.call(user, "DELETE", `/splits/${table._id}`, { splitIds: [ids.splits[0], other.ids.splits[0]] });
  assert.equal(bad.status, 400);
  assert.equal((await ctx.call(user, "DELETE", `/splits/${table._id}`, { splitIds: [] })).status, 400);
  assert.equal((await ctx.call(user, "DELETE", "/splits/no-es-id", { splitIds: [ids.splits[0]] })).status, 400);
  assert.ok(await ctx.findSplit(other.ids.splits[0]));
});

test("editar un microciclo (nombre/objetivo) desde el Planificador funciona y lo ve el cliente", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const { ids } = await seedRoutine(client, { assignedBy: trainer });
  const res = await ctx.call(trainer, "PUT", `/splits/${ids.splits[0]}`, { name: "Bloque de fuerza", objective: "Fuerza" });
  assert.equal(res.status, 204, JSON.stringify(res.body));
  assert.equal((await ctx.findSplit(ids.splits[0])).name, "Bloque de fuerza");
  // Y el cliente sigue sin poder hacerlo en su rutina asignada.
  assert.equal((await ctx.call(client, "PUT", `/splits/${ids.splits[0]}`, { name: "Mío" })).status, 403);
});

test("reordenar microciclos: el orden nuevo persiste; un orden incompleto da 400", async () => {
  const user = await ctx.makeClient();
  const { table, ids } = await seedRoutine(user, { shape: [[[1]], [[1]], [[1]]] });
  const [a, b, c] = ids.splits.map(String);
  await ctx.put(user, `/splits/rows/order/${table._id}`, { splitIdsOrder: [c, a, b] });
  assert.deepEqual((await ctx.model("Table").findById(table._id).lean()).splits.map((split) => String(split._id)), [c, a, b]);
  assert.equal((await ctx.call(user, "PUT", `/splits/rows/order/${table._id}`, { splitIdsOrder: [a, b] })).status, 400);
});
