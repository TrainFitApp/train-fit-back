const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-weights-to-anthropometry]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BATCH_SIZE = 500;

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const db = mongoose.connection.db;

  const dietDayCol = db.collection("dietdays");
  const dietCol = db.collection("diets");
  const userCol = db.collection("users");
  const anthropometryCol = db.collection("anthropometries");

  const cursor = dietDayCol.find(
    { weight: { $exists: true } },
    { projection: { _id: 1, date: 1, weight: 1 } },
  );

  let scanned = 0;
  let created = 0;
  let cleaned = 0;
  let skipped = 0;
  let errors = 0;

  const anthropometryOps = [];
  const cleanOps = [];

  for await (const dietDay of cursor) {
    scanned++;

    try {
      if (!dietDay.date || dietDay.weight == null) {
        skipped++;
        continue;
      }

      const diet = await dietCol.findOne(
        { dietsDay: dietDay._id },
        { projection: { _id: 1 } },
      );
      if (!diet) {
        skipped++;
        continue;
      }

      const user = await userCol.findOne(
        { $or: [{ dietInUse: diet._id }, { archivedDiets: diet._id }] },
        { projection: { _id: 1 } },
      );
      if (!user) {
        skipped++;
        continue;
      }

      anthropometryOps.push({
        updateOne: {
          filter: { userId: user._id, date: dietDay.date },
          update: {
            $setOnInsert: {
              userId: user._id,
              date: dietDay.date,
              weight: dietDay.weight,
            },
          },
          upsert: true,
        },
      });

      cleanOps.push({
        updateOne: {
          filter: { _id: dietDay._id },
          update: { $unset: { weight: "" } },
        },
      });

      if (anthropometryOps.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          const r1 = await anthropometryCol.bulkWrite(anthropometryOps, {
            ordered: false,
          });
          created += (r1.upsertedCount || 0) + (r1.modifiedCount || 0);
          const r2 = await dietDayCol.bulkWrite(cleanOps, { ordered: false });
          cleaned += r2.modifiedCount || 0;
        } else {
          created += anthropometryOps.length;
          cleaned += cleanOps.length;
        }
        log(
          `batch: scanned=${scanned} anthropometryOps=${anthropometryOps.length} cleanOps=${cleanOps.length}`,
        );
        anthropometryOps.length = 0;
        cleanOps.length = 0;
      }
    } catch (err) {
      log(`error processing dietDay ${dietDay._id}: ${err.message}`);
      errors++;
    }
  }

  if (anthropometryOps.length > 0) {
    if (!DRY_RUN) {
      const r1 = await anthropometryCol.bulkWrite(anthropometryOps, {
        ordered: false,
      });
      created += (r1.upsertedCount || 0) + (r1.modifiedCount || 0);
      const r2 = await dietDayCol.bulkWrite(cleanOps, { ordered: false });
      cleaned += r2.modifiedCount || 0;
    } else {
      created += anthropometryOps.length;
      cleaned += cleanOps.length;
    }
  }

  await mongoose.disconnect();
  ok(
    `done: scanned=${scanned} anthropometryCreated=${created} weightCleaned=${cleaned} skipped=${skipped} errors=${errors}`,
  );
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
