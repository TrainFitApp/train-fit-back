/**
 * rebuild-product-indexes.js
 * ==========================
 * Drops ALL existing indexes on the "products" collection (except _id)
 * and recreates only the minimal, non-overlapping set required by the
 * actual queries in product-dao.js and meal-dao.js (searchAllWithFilters).
 *
 * WHY THIS SCRIPT EXISTS
 * ─────────────────────────────────────────────────────────────────────
 * In PRO, "added by me" (ownFilter) product searches were returning
 * products with empty (0) nutritional info. The root cause:
 *
 *   1. The $text index was { name: "text", brand: "text" } WITHOUT
 *      userId in the compound key. When meal-dao spreads
 *      { ...match, $text: { $search: ... } } with match = { userId: X },
 *      MongoDB MUST use the text index for $text queries, but that index
 *      covers ALL products (3M+). The userId filter is applied as a
 *      post-filter on text-index results. On a huge collection, the text
 *      stage can exhaust its candidate set before finding user products,
 *      returning 0 results (and thus 0 nutrition).
 *
 *   2. Single-field indexes like nameNormalized_1 don't help queries
 *      that also filter by userId — MongoDB picks one index and the
 *      other condition becomes a filter on fetched documents.
 *
 *   FIX: We create COMPOUND indexes that prefix userId so that every
 *   search path — exact, prefix, startsWith, $text — can narrow to the
 *   user's subset first. Since MongoDB only allows ONE text index per
 *   collection, we include userId as a prefix field in that single
 *   compound text index.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────
 *   node scripts/rebuild-product-indexes.js                   # full rebuild
 *   node scripts/rebuild-product-indexes.js --skip-drop        # only ensure indexes
 *   node scripts/rebuild-product-indexes.js --skip-backfill    # skip backfill step
 *   node scripts/rebuild-product-indexes.js --skip-verify      # skip verify step
 *   node scripts/rebuild-product-indexes.js --dry-run          # only print plan
 *
 *   npm run rebuild:product-indexes
 *   npm run rebuild:product-indexes -- --skip-backfill
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { buildSearchFields } = require("../components/util/search-index");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// ─────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────
const hasFlag = (flag) => process.argv.includes(flag);
const SKIP_DROP = hasFlag("--skip-drop");
const SKIP_BACKFILL = hasFlag("--skip-backfill");
const SKIP_VERIFY = hasFlag("--skip-verify");
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[rebuild-product-indexes]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const warn = (...args) => console.warn(LOG_PREFIX, "⚠", ...args);
const ok = (...args) => console.log(LOG_PREFIX, "✓", ...args);

// ─────────────────────────────────────────────────────────────────────
// INDEX DEFINITIONS — THE SINGLE SOURCE OF TRUTH
// ─────────────────────────────────────────────────────────────────────
// Every index below maps to real queries in the codebase.
// Duplicate / overlapping legacy indexes have been eliminated.

const INDEXES = [
  // ── 1. BARCODE LOOKUP ──────────────────────────────────────────────
  // product-dao.js → getProductByCode(): { code, userId }
  // Also useful for the schema pre("deleteOne") cascade.
  {
    keys: { code: 1, userId: 1 },
    options: { name: "idx_code_userId", background: true },
    reason: "getProductByCode() — look up by barcode, first own then global",
  },

  // ── 2. USER PRODUCTS: LIST / SORT ──────────────────────────────────
  // meal-dao.js → CASE 1000 (ownFilter, no search): .find({ userId }).sort({ name:1, _id:1 })
  // Also covers CASE 1001 (own + fav) since _id is in $in and userId is equality.
  {
    keys: { userId: 1, name: 1, _id: 1 },
    options: { name: "idx_userId_name_id", background: true },
    reason: "Own-product listing with name sort (CASE 1000/1001)",
  },

  // ── 3. USER PRODUCTS: EXACT nameNormalized ─────────────────────────
  // meal-dao.js → executeProductQuery: .find({ ...match, nameNormalized: X })
  // When match = { userId: ObjectId }, this compound index serves it.
  // When match = { $or: [{ userId: X }, { userId: null }...] }, the
  // single-field nameNormalized_1 path (index #7) covers it.
  {
    keys: { userId: 1, nameNormalized: 1 },
    options: { name: "idx_userId_nameNormalized", background: true },
    reason: "Own-product exact name search (ownFilter + search)",
  },

  // ── 4. USER PRODUCTS: EXACT brandNormalized ────────────────────────
  {
    keys: { userId: 1, brandNormalized: 1 },
    options: { name: "idx_userId_brandNormalized", background: true },
    reason: "Own-product exact brand search (ownFilter + search)",
  },

  // ── 5. USER PRODUCTS: nameNormalized RANGE (startsWith) ────────────
  // meal-dao.js → .find({ ...match, nameNormalized: { $gte, $lte } })
  // The compound { userId, nameNormalized } already covers this (range
  // scan on nameNormalized after equality on userId). No extra index needed.
  // → Covered by index #3.

  // ── 6. USER PRODUCTS: PREFIX ARRAYS ────────────────────────────────
  // meal-dao.js → .find({ ...match, namePrefixes: X })
  {
    keys: { userId: 1, namePrefixes: 1 },
    options: { name: "idx_userId_namePrefixes", background: true },
    reason: "Own-product prefix name search (ownFilter + search)",
  },
  {
    keys: { userId: 1, brandPrefixes: 1 },
    options: { name: "idx_userId_brandPrefixes", background: true },
    reason: "Own-product prefix brand search (ownFilter + search)",
  },

  // ── 7. GLOBAL PRODUCTS: SINGLE-FIELD SEARCH INDEXES ────────────────
  // product-dao.js → searchProduct(): queries with { userId: null, nameNormalized/... }
  // meal-dao.js → CASE 0000 (no filters, all products): $or userId combos
  // For $or queries, MongoDB can use separate indexes per branch.
  {
    keys: { nameNormalized: 1 },
    options: { name: "idx_nameNormalized", background: true },
    reason: "Global product exact name search + CASE 0000 $or branch",
  },
  {
    keys: { brandNormalized: 1 },
    options: { name: "idx_brandNormalized", background: true },
    reason: "Global product exact brand search + CASE 0000 $or branch",
  },
  {
    keys: { namePrefixes: 1 },
    options: { name: "idx_namePrefixes", background: true },
    reason: "Global product prefix name search",
  },
  {
    keys: { brandPrefixes: 1 },
    options: { name: "idx_brandPrefixes", background: true },
    reason: "Global product prefix brand search",
  },

  // ── 8. VERIFIED + GLOBAL: SHIELD FILTER ────────────────────────────
  // meal-dao.js → CASE 0010: { verified, $or: [{userId:null},{userId:{$exists:false}}] }
  // meal-dao.js → CASE 0011: { _id: $in, verified }
  {
    keys: { verified: 1, userId: 1, name: 1 },
    options: { name: "idx_verified_userId_name", background: true },
    reason: "Verified-filter listing with name sort (CASE 0010)",
  },
  {
    keys: { verified: 1, userId: 1, nameNormalized: 1 },
    options: { name: "idx_verified_userId_nameNormalized", background: true },
    reason: "Verified-filter exact name search (CASE 0010 + search)",
  },
  {
    keys: { verified: 1, userId: 1, namePrefixes: 1 },
    options: { name: "idx_verified_userId_namePrefixes", background: true },
    reason: "Verified-filter prefix name search (CASE 0010 + search)",
  },

  // ── 9. TEXT INDEX (ONE PER COLLECTION) ─────────────────────────────
  // CRITICAL: MongoDB allows only ONE text index. We include userId as
  // a prefix so that { userId: X, $text: { $search } } can narrow the
  // text search to only that user's products instead of scanning 3M+.
  //
  // For global queries (userId: null), MongoDB still uses this index —
  // the userId equality prefix filters to userId=null first, then text.
  //
  // This is THE fix for the "own products return 0 nutrition" bug.
  {
    keys: { userId: 1, name: "text", brand: "text" },
    options: {
      name: "idx_userId_text_name_brand",
      background: true,
      weights: { name: 10, brand: 4 },
    },
    reason: "$text search — compound with userId so own-product $text queries work",
  },
];

// ─────────────────────────────────────────────────────────────────────
// STEP 1: DROP ALL EXISTING INDEXES
// ─────────────────────────────────────────────────────────────────────
async function dropAllIndexes(collection) {
  const before = await collection.indexes();
  const names = before
    .filter((idx) => idx.name !== "_id_")
    .map((idx) => idx.name);

  if (names.length === 0) {
    log("No user-defined indexes to drop.");
    return;
  }

  log(`Dropping ${names.length} indexes: ${names.join(", ")}`);

  if (!DRY_RUN) {
    await collection.dropIndexes();
  }

  ok(`Dropped ${names.length} indexes.`);
}

// ─────────────────────────────────────────────────────────────────────
// STEP 2: CREATE THE OPTIMAL INDEX SET
// ─────────────────────────────────────────────────────────────────────
async function createIndexes(collection) {
  log(`Creating ${INDEXES.length} indexes...`);

  for (const def of INDEXES) {
    const keyStr = JSON.stringify(def.keys);
    log(`  → ${def.options.name}  ${keyStr}  (${def.reason})`);

    if (!DRY_RUN) {
      try {
        await collection.createIndex(def.keys, def.options);
        ok(`Created: ${def.options.name}`);
      } catch (err) {
        warn(`Failed to create ${def.options.name}: ${err.message}`);
        throw err;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// STEP 3: BACKFILL SEARCH FIELDS (nameNormalized, etc.)
// ─────────────────────────────────────────────────────────────────────
function areStringArraysEqual(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function backfillSearchFields() {
  log("Backfilling search fields (nameNormalized, brandNormalized, namePrefixes, brandPrefixes)...");

  if (DRY_RUN) {
    log("  (dry-run — skipping backfill)");
    return;
  }

  const cursor = Product.find(
    {},
    {
      _id: 1,
      name: 1,
      brand: 1,
      nameNormalized: 1,
      brandNormalized: 1,
      namePrefixes: 1,
      brandPrefixes: 1,
    },
  )
    .lean()
    .cursor();

  const bulkOps = [];
  let scanned = 0;
  let planned = 0;
  let updated = 0;
  const BATCH_SIZE = 1000;

  for await (const doc of cursor) {
    scanned += 1;
    const next = buildSearchFields(doc);

    const needsUpdate =
      doc.nameNormalized !== next.nameNormalized ||
      doc.brandNormalized !== next.brandNormalized ||
      !areStringArraysEqual(doc.namePrefixes, next.namePrefixes) ||
      !areStringArraysEqual(doc.brandPrefixes, next.brandPrefixes);

    if (!needsUpdate) continue;
    planned += 1;

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            nameNormalized: next.nameNormalized,
            brandNormalized: next.brandNormalized,
            namePrefixes: next.namePrefixes,
            brandPrefixes: next.brandPrefixes,
          },
        },
      },
    });

    if (bulkOps.length >= BATCH_SIZE) {
      const result = await Product.bulkWrite(bulkOps, { ordered: false });
      updated += result.modifiedCount || 0;
      bulkOps.length = 0;
      log(`  backfill progress: scanned=${scanned} planned=${planned} updated=${updated}`);
    }
  }

  if (bulkOps.length > 0) {
    const result = await Product.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount || 0;
  }

  ok(`Backfill complete: scanned=${scanned} planned=${planned} updated=${updated}`);
}

// ─────────────────────────────────────────────────────────────────────
// STEP 4: VERIFY — run explain() on critical query patterns
// ─────────────────────────────────────────────────────────────────────
function collectStageNames(node, acc = new Set()) {
  if (!node || typeof node !== "object") return acc;
  if (node.stage) acc.add(node.stage);
  if (node.inputStage) collectStageNames(node.inputStage, acc);
  if (Array.isArray(node.inputStages)) {
    for (const child of node.inputStages) collectStageNames(child, acc);
  }
  if (node.queryPlan) collectStageNames(node.queryPlan, acc);
  if (node.winningPlan) collectStageNames(node.winningPlan, acc);
  if (node.shards && Array.isArray(node.shards)) {
    for (const shard of node.shards) collectStageNames(shard, acc);
  }
  return acc;
}

function collectIndexNames(node, acc = new Set()) {
  if (!node || typeof node !== "object") return acc;
  if (node.indexName) acc.add(node.indexName);
  if (node.inputStage) collectIndexNames(node.inputStage, acc);
  if (Array.isArray(node.inputStages)) {
    for (const child of node.inputStages) collectIndexNames(child, acc);
  }
  if (node.queryPlan) collectIndexNames(node.queryPlan, acc);
  if (node.winningPlan) collectIndexNames(node.winningPlan, acc);
  if (node.shards && Array.isArray(node.shards)) {
    for (const shard of node.shards) collectIndexNames(shard, acc);
  }
  return acc;
}

async function verifyIndexUsage(collection) {
  log("Verifying index usage with explain()...\n");

  if (DRY_RUN) {
    log("  (dry-run — skipping verify)");
    return;
  }

  // Use a fake ObjectId for the userId equality filter
  const fakeUserId = new mongoose.Types.ObjectId();

  const QUERIES = [
    {
      label: "Global exact nameNormalized",
      query: { userId: null, nameNormalized: "pollo" },
    },
    {
      label: "Global namePrefixes",
      query: { userId: null, namePrefixes: "poll" },
    },
    {
      label: "Global $text",
      query: { userId: null, $text: { $search: "pollo" } },
      projection: { score: { $meta: "textScore" } },
      sort: { score: { $meta: "textScore" } },
    },
    {
      label: "Own exact nameNormalized (ownFilter)",
      query: { userId: fakeUserId, nameNormalized: "pollo" },
    },
    {
      label: "Own namePrefixes (ownFilter)",
      query: { userId: fakeUserId, namePrefixes: "poll" },
    },
    {
      label: "Own $text (ownFilter) ← THE BUG FIX",
      query: { userId: fakeUserId, $text: { $search: "pollo" } },
      projection: { score: { $meta: "textScore" } },
      sort: { score: { $meta: "textScore" } },
    },
    {
      label: "Verified global listing",
      query: { verified: true, userId: null },
    },
    {
      label: "Barcode lookup (own)",
      query: { code: "8410128000000", userId: fakeUserId },
    },
    {
      label: "Barcode lookup (global)",
      query: { code: "8410128000000", userId: null },
    },
  ];

  let failures = 0;

  for (const q of QUERIES) {
    try {
      let cursor = collection.find(q.query);
      if (q.projection) cursor = cursor.project(q.projection);
      if (q.sort) cursor = cursor.sort(q.sort);
      cursor = cursor.limit(20);

      const explain = await cursor.explain("executionStats");
      const rootPlan = explain?.queryPlanner?.winningPlan || explain?.queryPlanner;
      const execution = explain?.executionStats || {};
      const stages = Array.from(collectStageNames(rootPlan));
      const indexes = Array.from(collectIndexNames(rootPlan));
      const hasCollscan = stages.includes("COLLSCAN");

      const icon = hasCollscan ? "✗" : "✓";
      console.log(`  ${icon} ${q.label}`);
      console.log(`    stages: ${stages.join(" → ") || "(unknown)"}`);
      console.log(`    indexes: ${indexes.join(", ") || "(none)"}`);
      console.log(`    docsExamined=${execution.totalDocsExamined || 0}  keysExamined=${execution.totalKeysExamined || 0}  time=${execution.executionTimeMillis || 0}ms`);
      console.log();

      if (hasCollscan) {
        failures++;
        warn(`COLLSCAN detected for: ${q.label}`);
      }
    } catch (err) {
      warn(`Could not verify "${q.label}": ${err.message}`);
    }
  }

  if (failures > 0) {
    warn(`${failures} query pattern(s) using COLLSCAN — review index design.`);
    process.exitCode = 2;
  } else {
    ok("All verified query patterns use indexes (no COLLSCAN).");
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
async function main() {
  const mongoURI = buildMongoUri();
  log(`Connecting to: ${redactMongoUri(mongoURI)}`);
  log(`Flags: skip-drop=${SKIP_DROP} skip-backfill=${SKIP_BACKFILL} skip-verify=${SKIP_VERIFY} dry-run=${DRY_RUN}`);

  if (DRY_RUN) {
    warn("DRY-RUN MODE — no changes will be made to the database.\n");
  }

  await mongoose.connect(mongoURI);
  ok("Connected to MongoDB.\n");

  const collection = Product.collection;

  // Print current state
  const currentIndexes = await collection.indexes();
  log(`Current indexes (${currentIndexes.length}):`);
  for (const idx of currentIndexes) {
    log(`  • ${idx.name}  ${JSON.stringify(idx.key)}`);
  }
  console.log();

  // Step 1: Drop
  if (!SKIP_DROP) {
    log("═══ STEP 1: DROP ALL INDEXES ═══");
    await dropAllIndexes(collection);
    console.log();
  } else {
    log("═══ STEP 1: DROP ALL INDEXES (skipped) ═══\n");
  }

  // Step 2: Create
  log("═══ STEP 2: CREATE OPTIMAL INDEXES ═══");
  await createIndexes(collection);
  console.log();

  // Step 3: Backfill
  if (!SKIP_BACKFILL) {
    log("═══ STEP 3: BACKFILL SEARCH FIELDS ═══");
    await backfillSearchFields();
    console.log();
  } else {
    log("═══ STEP 3: BACKFILL SEARCH FIELDS (skipped) ═══\n");
  }

  // Step 4: Verify
  if (!SKIP_VERIFY) {
    log("═══ STEP 4: VERIFY INDEX USAGE ═══");
    await verifyIndexUsage(collection);
    console.log();
  } else {
    log("═══ STEP 4: VERIFY INDEX USAGE (skipped) ═══\n");
  }

  // Final summary
  const finalIndexes = DRY_RUN
    ? currentIndexes
    : await collection.indexes();
  log(`Final indexes (${finalIndexes.length}):`);
  for (const idx of finalIndexes) {
    log(`  • ${idx.name}  ${JSON.stringify(idx.key)}`);
  }

  await mongoose.disconnect();
  ok("Done.");
}

main().catch(async (err) => {
  console.error(LOG_PREFIX, "FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exitCode = 1;
});
