const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// MVP-trainers D8/R7 (modelos-de-datos/05-cambios-modelos-existentes.md §2.2):
// copia el valor histórico único de bicepsRelaxed/bicepsContracted/calf a
// AMBOS lados (L/R) para que las gráficas bilaterales no muestren un hueco
// antes de la fecha de despliegue. Puramente aditivo: nunca toca ni borra los
// campos antiguos (siguen leyéndose donde no exista L/R), y usa $set solo
// sobre documentos donde el lado nuevo todavía no tiene ningún valor —
// nunca sobrescribe una medición bilateral real ya introducida.

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-anthropometry-lateral-backfill]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BATCH_SIZE = 500;

const FIELD_PAIRS = [
  { legacy: "bicepsRelaxed", left: "bicepsRelaxedL", right: "bicepsRelaxedR" },
  { legacy: "bicepsContracted", left: "bicepsContractedL", right: "bicepsContractedR" },
  { legacy: "calf", left: "calfL", right: "calfR" },
];

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const db = mongoose.connection.db;
  if (db.databaseName !== "pre") {
    throw new Error(`Refusing to run outside "pre" (connected to "${db.databaseName}")`);
  }

  const anthropometryCol = db.collection("anthropometries");

  const cursor = anthropometryCol.find(
    {
      $or: FIELD_PAIRS.map((pair) => ({
        [pair.legacy]: { $exists: true, $ne: null },
        [pair.left]: { $in: [null, undefined] },
        [pair.right]: { $in: [null, undefined] },
      })),
    },
    {
      projection: {
        _id: 1,
        ...Object.fromEntries(
          FIELD_PAIRS.flatMap((p) => [[p.legacy, 1], [p.left, 1], [p.right, 1]])
        ),
      },
    }
  );

  let scanned = 0;
  let updated = 0;
  const ops = [];

  for await (const doc of cursor) {
    scanned++;
    const set = {};

    for (const pair of FIELD_PAIRS) {
      const legacyValue = doc[pair.legacy];
      const hasLeft = doc[pair.left] != null;
      const hasRight = doc[pair.right] != null;
      if (legacyValue != null && !hasLeft && !hasRight) {
        set[pair.left] = legacyValue;
        set[pair.right] = legacyValue;
      }
    }

    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
    }

    if (ops.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        const r = await anthropometryCol.bulkWrite(ops, { ordered: false });
        updated += r.modifiedCount || 0;
      } else {
        updated += ops.length;
      }
      log(`batch: scanned=${scanned} updated=${updated}`);
      ops.length = 0;
    }
  }

  if (ops.length) {
    if (!DRY_RUN) {
      const r = await anthropometryCol.bulkWrite(ops, { ordered: false });
      updated += r.modifiedCount || 0;
    } else {
      updated += ops.length;
    }
  }

  await mongoose.disconnect();
  ok(`done: scanned=${scanned} updated=${updated}${DRY_RUN ? " (dry-run, no writes)" : ""}`);
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
