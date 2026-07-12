const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[set-default-lang]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const collection = mongoose.connection.collection("users");
  const cursor = collection.find(
    { lang: { $exists: false } },
    { projection: { _id: 1, email: 1 } }
  );

  let scanned = 0;
  let updated = 0;
  const ops = [];
  const batchSize = 1000;

  for await (const doc of cursor) {
    scanned += 1;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { lang: "es" } },
      },
    });

    if (ops.length >= batchSize) {
      updated += ops.length;
      if (!DRY_RUN) {
        await collection.bulkWrite(ops);
        ok(`batch ${updated} users updated`);
      } else {
        log(`[DRY-RUN] batch ${updated} users would be updated`);
      }
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    updated += ops.length;
    if (!DRY_RUN) {
      await collection.bulkWrite(ops);
      ok(`final batch ${updated} users updated`);
    } else {
      log(`[DRY-RUN] final batch ${updated} users would be updated`);
    }
  }

  log(`done. scanned=${scanned} updated=${updated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(LOG_PREFIX, "FATAL", err);
  process.exit(1);
});
