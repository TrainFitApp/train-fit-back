const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[migrate-users-remove-tables-array]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);
const errLog = (...args) => console.error(LOG_PREFIX, "ERROR", ...args);

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const db = mongoose.connection.db;

  // 1. Remove 'tables' array from all User documents
  log("step 1/2 — removing 'tables' field from User docs...");
  const usersResult = await db
    .collection("users")
    .updateMany(
      { tables: { $exists: true } },
      { $unset: { tables: "" } }
    );
  ok(`users: ${usersResult.modifiedCount} docs had 'tables' field removed`);

  // 2. Verify all tables have userId (backfill any missing)
  log("step 2/2 — verifying userId on tables collection...");
  const tablesResult = await db
    .collection("tables")
    .updateMany(
      { userId: { $exists: false } },
      { $set: { userId: null } }
    );
  ok(`tables: ${tablesResult.modifiedCount} docs updated with userId: null`);

  // 3. Verify counts
  const userCount = await db.collection("users").countDocuments({ tables: { $exists: true } });
  const tableCount = await db.collection("tables").countDocuments({ userId: { $exists: false } });
  log(`verification: users with tables field = ${userCount}, tables without userId = ${tableCount}`);

  log("migration complete");
  await mongoose.disconnect();
}

main().catch((err) => {
  errLog(err.message);
  process.exit(1);
});