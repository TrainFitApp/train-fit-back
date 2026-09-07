const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Feature "cantidad pautada vs. consumida" (2026-09) — CustomProduct/
// CustomRecipe ganan assignedQuantity (ver esos schemas). Para lo YA
// pautado antes de este cambio no hay forma de saber cuánto se pautó
// originalmente aparte de lo que hay ahora mismo en `quantity`: esta
// migración fija assignedQuantity = quantity para todo lo pautado
// existente, así que el delta arranca en 0 para ello (coherente: no hay
// forma de saber si el cliente ya había tocado la cantidad antes de que
// existiera este feature). Lo nuevo que se pauta a partir de ahora ya
// estampa assignedQuantity en el momento de crearse (meal-dao.js#pasteMeal),
// esta migración no le afecta (filtro assignedQuantity: null).
//
// Uso:
//   node scripts/migrate-pautado-assigned-quantity.js --dry-run
//   node scripts/migrate-pautado-assigned-quantity.js

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-pautado-assigned-quantity]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

async function migrateCollection(collectionName) {
  const collection = mongoose.connection.collection(collectionName);
  const filter = {
    assignedByTrainerId: { $ne: null },
    assignedQuantity: null,
    quantity: { $ne: null },
  };

  const cursor = collection.find(filter, {
    projection: { _id: 1, quantity: 1 },
  });

  let scanned = 0;
  const ops = [];
  const batchSize = 1000;
  let updated = 0;

  const flush = async () => {
    if (!ops.length) return;
    if (!DRY_RUN) {
      const result = await collection.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    } else {
      updated += ops.length;
    }
    ops.length = 0;
  };

  for await (const doc of cursor) {
    scanned += 1;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { assignedQuantity: doc.quantity } },
      },
    });
    if (ops.length >= batchSize) {
      await flush();
      log(`${collectionName}: scanned=${scanned}`);
    }
  }
  await flush();

  ok(`${collectionName}: scanned=${scanned} updated=${updated}`);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  await migrateCollection("customproducts");
  await migrateCollection("customrecipes");

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
