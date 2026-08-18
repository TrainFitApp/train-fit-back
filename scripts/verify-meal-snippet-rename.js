const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-meal-snippet-rename]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-047 (MASTER_BACKLOG.md) — confirma que mealSnippetDao.rename() edita
// el nombre de un snippet propio y respeta el aislamiento por trainerId
// (un trainer no puede renombrar el snippet de otro).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const mealSnippetDao = require("../components/mealSnippets/meal-snippet-dao");
  const mealSchema = require("../components/meals/meal-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainerA: null, trainerB: null, snippet: null };

  try {
    created.trainerA = await userSchema.create({ email: `verify-rename-a-${runId}@test.local` });
    created.trainerB = await userSchema.create({ email: `verify-rename-b-${runId}@test.local` });

    created.snippet = await mealSnippetDao.create(
      created.trainerA._id.toString(),
      `Snippet original ${runId}`,
      [{ product: new mongoose.Types.ObjectId().toString(), quantity: 100 }],
      []
    );

    const renamed = await mealSnippetDao.rename(
      created.trainerA._id.toString(),
      created.snippet._id.toString(),
      "Snippet renombrado"
    );
    assert.ok(renamed, "rename() debe devolver el documento actualizado");
    assert.equal(renamed.name, "Snippet renombrado");
    ok("rename() cambia el nombre del snippet propio correctamente");

    const crossTrainerAttempt = await mealSnippetDao.rename(
      created.trainerB._id.toString(),
      created.snippet._id.toString(),
      "Intento de otro trainer"
    );
    assert.equal(crossTrainerAttempt, null, "un trainer no debe poder renombrar el snippet de otro");
    ok("rename() respeta el aislamiento por trainerId (null si no es el dueño)");

    const stillOriginalOwnerName = await mealSchema.findById(created.snippet._id).select("name");
    assert.equal(stillOriginalOwnerName.name, "Snippet renombrado", "el intento cruzado no debe haber modificado nada");
    ok("el nombre no cambió tras el intento de otro trainer");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    // deleteOne (no deleteMany) dispara el hook en cascada de meal-schema.js
    // que borra los CustomProduct/CustomRecipe del snippet.
    if (created.snippet) await mealSchema.deleteOne({ _id: created.snippet._id });
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
