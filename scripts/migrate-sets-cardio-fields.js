const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-sets-cardio-fields]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Mantener sincronizado con formatSecondsAsTime (packages/shared-ui/src/app/shared/utils/index.ts)
function formatSecondsAsTime(totalSeconds) {
  if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const collection = mongoose.connection.collection("sets");
  const cursor = collection.find(
    {
      $or: [
        { expectedMin: { $exists: true } },
        { expectedSec: { $exists: true } },
        { timeMin: { $exists: true } },
        { timeSec: { $exists: true } },
      ],
    },
    {
      projection: {
        _id: 1,
        expectedMin: 1,
        expectedSec: 1,
        timeMin: 1,
        timeSec: 1,
      },
    },
  );

  let scanned = 0;
  let updated = 0;
  const ops = [];
  const batchSize = 1000;

  for await (const doc of cursor) {
    scanned += 1;

    const hasExpected = doc.expectedMin != null || doc.expectedSec != null;
    const hasActual = doc.timeMin != null || doc.timeSec != null;

    if (!hasExpected && !hasActual) {
      continue;
    }

    const setFields = {};
    const unsetFields = {};

    if (hasExpected) {
      const totalExpectedSeconds =
        (doc.expectedMin || 0) * 60 + (doc.expectedSec || 0);
      setFields.expectedTime = formatSecondsAsTime(totalExpectedSeconds);
      unsetFields.expectedMin = "";
      unsetFields.expectedSec = "";
    }

    if (hasActual) {
      const totalActualSeconds = (doc.timeMin || 0) * 60 + (doc.timeSec || 0);
      setFields.time = formatSecondsAsTime(totalActualSeconds);
      unsetFields.timeMin = "";
      unsetFields.timeSec = "";
    }

    const update = {};
    if (Object.keys(setFields).length > 0) update.$set = setFields;
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update,
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
