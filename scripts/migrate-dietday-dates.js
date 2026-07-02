const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-dietday-dates]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

function formatDateToYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const collection = mongoose.connection.collection("dietdays");
  const cursor = collection.find({}, { projection: { _id: 1, date: 1 } });

  let scanned = 0;
  let updated = 0;
  const ops = [];
  const batchSize = 1000;

  for await (const doc of cursor) {
    scanned += 1;
    if (typeof doc.date === "string") {
      continue;
    }

    const dateStr = formatDateToYYYYMMDD(doc.date);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { date: dateStr } },
      },
    });

    if (ops.length >= batchSize) {
      if (!DRY_RUN) {
        const result = await collection.bulkWrite(ops, { ordered: false });
        updated += result.modifiedCount || 0;
      } else {
        updated += ops.length;
      }
      log(`batch: scanned=${scanned} pending=${ops.length}`);
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    if (!DRY_RUN) {
      const result = await collection.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    } else {
      updated += ops.length;
    }
  }

  await mongoose.disconnect();
  ok(`done: scanned=${scanned} updated=${updated}`);
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
