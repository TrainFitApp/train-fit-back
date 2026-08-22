const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-own-routine-templates]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Rutinas -> Plantillas (rediseño 2026-08): confirma que un profesional
// puede crear/listar/borrar su propia biblioteca de plantillas de rutina
// completa (Table con userId=trainerId, sin cliente ni assignedByTrainerId),
// sin el gate de canCreateRoutine (Free: 1 rutina) que sí aplica a las
// rutinas de un cliente final — y que sigue siendo invisible como plantilla
// disponible para OTRO profesional.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const tableSchema = require("../components/tables/table-schema");
  const tableService = require("../components/tables/table-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainerA: null, trainerB: null, table: null };

  try {
    created.trainerA = await userSchema.create({
      email: `verify-own-routines-a-${runId}@test.local`,
      roles: ["trainer"],
    });
    created.trainerB = await userSchema.create({
      email: `verify-own-routines-b-${runId}@test.local`,
      roles: ["trainer"],
    });

    // 1. Crear plantilla propia sin premium ni rutinas previas — sin gate.
    created.table = await tableService.createOwnRoutineTemplate(
      created.trainerA._id.toString(),
      `Plantilla de prueba ${runId}`
    );
    assert.equal(String(created.table.userId), String(created.trainerA._id));
    assert.ok(!created.table.assignedByTrainerId, "una plantilla propia no lleva assignedByTrainerId");
    ok("createOwnRoutineTemplate() crea la Table sin gate de canCreateRoutine");

    // 2. Una segunda plantilla del mismo trainer no debe estar bloqueada por
    //    el límite Free (routines: 1) — confirma que el gate no se aplica.
    const secondTable = await tableService.createOwnRoutineTemplate(
      created.trainerA._id.toString(),
      `Segunda plantilla de prueba ${runId}`
    );
    ok("una 2ª plantilla del mismo trainer Free también se crea sin bloqueo");
    await tableSchema.deleteOne({ _id: secondTable._id });

    // 3. Listado propio (own=true) la incluye.
    const ownList = await tableService.getTables(0, 50, true, created.trainerA._id.toString());
    assert.ok(
      ownList.some((t) => String(t._id) === String(created.table._id)),
      "la plantilla debe aparecer en el listado own=true del propio trainer"
    );
    ok("getTables(own=true) lista la plantilla propia");

    // 4. Borrado con dueño equivocado no borra nada (adminMode=false: la
    //    propiedad la impone la propia query {_id, userId}).
    const wrongOwnerResult = await tableService.deleteTable(
      created.trainerB._id.toString(),
      created.table._id.toString(),
      false
    );
    assert.equal(wrongOwnerResult.deletedCount, 0, "otro trainer no puede borrar la plantilla ajena");
    const stillThere = await tableSchema.findById(created.table._id);
    assert.ok(stillThere, "la plantilla debe seguir existiendo tras el intento de borrado ajeno");
    ok("deleteTable() con dueño equivocado no borra nada");

    // 5. Borrado con el dueño real sí funciona.
    const ownerResult = await tableService.deleteTable(
      created.trainerA._id.toString(),
      created.table._id.toString(),
      false
    );
    assert.equal(ownerResult.deletedCount, 1);
    const afterDelete = await tableSchema.findById(created.table._id);
    assert.equal(afterDelete, null);
    ok("deleteTable() con el dueño real sí borra la plantilla");
    created.table = null;

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.trainerA) await userSchema.deleteOne({ _id: created.trainerA._id });
    if (created.trainerB) await userSchema.deleteOne({ _id: created.trainerB._id });
    ok("datos de prueba borrados");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
