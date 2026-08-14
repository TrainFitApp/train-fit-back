const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-available-templates]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-009 (MASTER_BACKLOG.md) — script aislado y autolimpiante contra la BD
// real: confirma que tableService.getTables(page, limit, false, idUser)
// devuelve tanto las tablas propias del entrenador como las públicas, tras
// el fix de idUser perdido en table-service.js. Antes del fix, este mismo
// escenario devolvía solo las públicas (o ninguna, si no había públicas en
// la página consultada) — la tabla propia nunca aparecía.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const tableSchema = require("../components/tables/table-schema");
  const tableService = require("../components/tables/table-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    ownTable: null,
    publicTable: null,
    otherUserTable: null,
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-avail-templates-trainer-${runId}@test.local`,
    });
    ok("trainer de prueba creado", created.trainer._id);

    created.ownTable = await tableSchema.create({
      name: `Tabla propia de prueba ${runId}`,
      userId: created.trainer._id,
      splits: [],
    });
    created.publicTable = await tableSchema.create({
      name: `Tabla pública de prueba ${runId}`,
      splits: [],
      // sin userId — pública/de sistema
    });
    const otherUser = await userSchema.create({
      email: `verify-avail-templates-other-${runId}@test.local`,
    });
    created.otherUserTable = await tableSchema.create({
      name: `Tabla de otro usuario ${runId}`,
      userId: otherUser._id,
      splits: [],
    });
    created.otherUser = otherUser;
    ok("tablas de prueba creadas (propia, pública, de otro usuario)");

    // Mismo call exacto que getAvailableTemplates en trainer-client-data-controller.js
    const templates = await tableService.getTables(0, 50, false, created.trainer._id.toString());
    const ids = templates.map((t) => t._id.toString());

    assert.ok(
      ids.includes(created.ownTable._id.toString()),
      "la tabla propia del entrenador DEBE aparecer entre las plantillas disponibles (este era el bug — idUser se perdía)"
    );
    assert.ok(
      ids.includes(created.publicTable._id.toString()),
      "la tabla pública debe seguir apareciendo"
    );
    assert.ok(
      !ids.includes(created.otherUserTable._id.toString()),
      "la tabla de OTRO usuario (ni propia ni pública) NO debe aparecer"
    );
    ok("getTables(own=false, idUser=trainer) devuelve propias + públicas, nunca ajenas");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.ownTable) await tableSchema.deleteOne({ _id: created.ownTable._id });
    if (created.publicTable) await tableSchema.deleteOne({ _id: created.publicTable._id });
    if (created.otherUserTable) await tableSchema.deleteOne({ _id: created.otherUserTable._id });
    if (created.otherUser) await userSchema.deleteOne({ _id: created.otherUser._id });
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
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
