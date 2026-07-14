const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[migrate-tables-to-owntables]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);
const errLog = (...args) => console.error(LOG_PREFIX, "ERROR", ...args);

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const db = mongoose.connection.db;

  // 1. Add userId: null to all existing "tables" docs (professional templates)
  log("step 1/7 — adding userId: null to all docs in 'tables' collection...");
  const tablesResult = await db
    .collection("tables")
    .updateMany({ userId: { $exists: false } }, { $set: { userId: null } });
  ok(`tables: ${tablesResult.modifiedCount} docs updated`);

  // 2. Add urlImage: "" to all existing "owntables" docs missing it (if collection exists)
  log("step 2/7 — adding urlImage to 'owntables' docs missing it...");
  const collections = await db.listCollections({ name: "owntables" }).toArray();
  if (collections.length > 0) {
    const ownTablesResult = await db
      .collection("owntables")
      .updateMany(
        { urlImage: { $exists: false } },
        { $set: { urlImage: "" } }
      );
    ok(`owntables: ${ownTablesResult.modifiedCount} docs updated`);
  } else {
    ok("owntables collection does not exist, skipping");
  }

  // 3. Backfill userId on existing "owntables" docs from User.ownTables[]
  log("step 3/7 — backfilling userId on 'owntables' from owners...");
  const userCursor = db
    .collection("users")
    .find(
      { ownTables: { $exists: true, $ne: [] } },
      { projection: { _id: 1, ownTables: 1 } }
    );

  let backfilledCount = 0;
  for await (const user of userCursor) {
    if (!user.ownTables?.length) continue;
    const result = await db.collection("owntables").updateMany(
      { _id: { $in: user.ownTables }, userId: { $exists: false } },
      { $set: { userId: user._id } }
    );
    backfilledCount += result.modifiedCount;
  }
  ok(`owntables: ${backfilledCount} docs backfilled with userId`);

  // 4. Merge "owntables" docs into "tables" collection (if collection exists)
  log("step 4/7 — merging 'owntables' into 'tables' collection...");
  const collectionsAfterBackfill = await db.listCollections({ name: "owntables" }).toArray();
  if (collectionsAfterBackfill.length > 0) {
    const mergeResult = await db
      .collection("owntables")
      .aggregate([
        { $match: {} },
        {
          $merge: {
            into: "tables",
            whenMatched: "merge",
            whenNotMatched: "insert",
          },
        },
      ])
      .toArray();
    ok(`owntables merged into tables`);
  } else {
    ok("owntables collection does not exist, skipping merge");
  }

  // 5. Drop "owntables" collection (if exists)
  log("step 5/7 — dropping 'owntables' collection...");
  const collectionsBeforeDrop = await db.listCollections({ name: "owntables" }).toArray();
  if (collectionsBeforeDrop.length > 0) {
    await db.collection("owntables").drop();
    ok("owntables collection dropped");
  } else {
    ok("owntables collection does not exist, skipping drop");
  }

  // 6. Rename field ownTables → tables on User documents
  log("step 6/7 — renaming 'ownTables' → 'tables' on User docs...");
  const renameResult = await db
    .collection("users")
    .updateMany(
      { ownTables: { $exists: true } },
      { $rename: { ownTables: "tables" } }
    );
  ok(`users: ${renameResult.modifiedCount} docs field renamed`);

  // 7. Create index on userId
  log("step 7/7 — creating index { userId: 1 } on 'tables'...");
  await db.collection("tables").createIndex({ userId: 1 });
  ok("index { userId: 1 } created");

  log("migration complete");
  await mongoose.disconnect();
}

main().catch((err) => {
  errLog(err.message);
  process.exit(1);
});