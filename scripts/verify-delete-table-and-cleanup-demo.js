const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-delete-table]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-019 (MASTER_BACKLOG.md) — confirma que tableService.deleteTable()
// (ya consumido desde ClientDetailApiService#deleteTable) borra
// correctamente una Table completa. Además, limpia el dato de prueba
// "TASK-019 test — borrar" creado durante la verificación en navegador
// (ClientDetailPage no refresca su lista tras volver del Planificador —
// bug real descubierto, ver TASK-078 — así que el botón "Borrar rutina
// completa" no era alcanzable en la UI para ese dato concreto).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const tableSchema = require("../components/tables/table-schema");
  const tableService = require("../components/tables/table-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { client: null, table: null };

  try {
    // 1. Caso controlado: crear una Table de prueba y confirmar que se borra.
    created.client = await userSchema.create({
      email: `verify-delete-table-${runId}@test.local`,
    });
    created.table = await tableSchema.create({
      name: `Tabla de prueba a borrar ${runId}`,
      userId: created.client._id,
      splits: [],
    });
    ok("tabla de prueba creada", created.table._id.toString());

    await tableService.deleteTable(created.client._id.toString(), created.table._id.toString(), true);
    const afterDelete = await tableSchema.findById(created.table._id);
    assert.equal(afterDelete, null, "la tabla debe haber desaparecido tras deleteTable");
    ok("deleteTable() borra correctamente una Table completa");
    created.table = null; // ya borrada, no reintentar en el finally

    // 2. Limpieza del dato de demo real dejado en el navegador (cliente
    // "Jose Tf", visible en el botón "Borrar rutina completa" pero
    // inalcanzable por el bug de refresco de TASK-078).
    const demoClientId = "65ccf5fbcc983be50cc36abd";
    const demoTable = await tableSchema.findOne({
      userId: demoClientId,
      name: "TASK-019 test — borrar",
    });
    if (demoTable) {
      await tableService.deleteTable(demoClientId, demoTable._id.toString(), true);
      ok("dato de demo 'TASK-019 test — borrar' limpiado del cliente Jose Tf");
    } else {
      ok("no se encontró el dato de demo (ya estaba limpio)");
    }

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.client) await userSchema.deleteOne({ _id: created.client._id });
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
