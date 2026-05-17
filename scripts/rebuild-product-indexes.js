/**
 * rebuild-product-indexes.js
 * ==========================
 * Drops ALL existing indexes on the "products" collection (except _id)
 * and recreates only the minimal, non-overlapping set required by the
 * actual queries in product-dao.js and meal-dao.js (searchAllWithFilters).
 *
 * ROOT CAUSE OF THE PRO BUG (ownFilter + search → nutrition = 0)
 * ─────────────────────────────────────────────────────────────────────
 * When ownFilter=true + search text, meal-dao.js executeProductQuery()
 * fires 7 parallel queries. Queries 1-6 are regular .find() calls that
 * return FULL documents (including nutritional fields). Query 7 is a
 * $text search whose .find() projection { score: { $meta: "textScore" } }
 * returns ONLY _id and score (MongoDB 4.4+ treats $meta as inclusion).
 *
 * Scoring ensures queries 1-6 (score ≥ 70000) ALWAYS beat query 7
 * (score ~40000), so the full-doc version wins — IF queries 1-6 succeed.
 *
 * THE PROBLEM: In PRO (3M+ products), queries 1-6 used single-field
 * indexes (e.g. nameNormalized_1). For { userId: X, nameNormalized: Y },
 * MongoDB picks nameNormalized_1 → scans ALL "Y" matches across 3M docs
 * → post-filters by userId. On a huge collection this is a COLLSCAN-like
 * scan that either times out or returns 0 within the limit. Only query 7
 * ($text) finds the product → stripped doc → nutrition = 0.
 *
 * In PRE (small DB), the COLLSCAN finishes quickly, queries 1-6 return
 * full docs, their higher score wins, nutrition is preserved.
 *
 * FIX: Compound indexes { userId: 1, nameNormalized: 1 }, etc. so
 * queries 1-6 use IXSCAN → instant results → full doc always wins.
 *
 * NOTE ON TEXT INDEX: We keep { name: "text", brand: "text" } WITHOUT
 * userId prefix. MongoDB requires equality match on prefix fields of a
 * compound text index. CASE 0000 uses $or on userId with $text — a
 * userId prefix would cause "failed to use text index" error.
 * The text index result is always beaten by queries 1-6 anyway.
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
//
// QUERY TRACE: meal-dao.js executeProductQuery() with hasSearch=true
// ─────────────────────────────────────────────────────────────────────
// When ownFilter=true → match = { userId: ObjectId }
// 7 queries run in parallel:
//
//   Q1  exactNameDocs:      { userId: X, nameNormalized: Y }
//   Q2  startsWithNameDocs: { userId: X, nameNormalized: { $gte: Y, $lte: Y\uffff } }
//       .sort({ nameNormalized: 1, _id: 1 })
//   Q3  exactBrandDocs:     { userId: X, brandNormalized: Y }
//   Q4  startsWithBrandDocs:{ userId: X, brandNormalized: { $gte: Y, $lte: Y\uffff } }
//       .sort({ brandNormalized: 1, _id: 1 })
//   Q5  prefixNameDocs:     { userId: X, namePrefixes: Y }
//   Q6  prefixBrandDocs:    { userId: X, brandPrefixes: Y }
//   Q7  textDocs:           { userId: X, $text: { $search: Y } }
//       → projection strips fields, but Q1-Q6 score higher → full doc wins
//
// When CASE 0000 (all products) → match = { $or: [{userId:X},{userId:null},...] }
//   Q1-Q6 use the same fields but with $or → single-field indexes cover each branch
//   Q7 uses $text → text index WITHOUT userId prefix (required for $or)
//
// When CASE 0010 (verified) → match = { verified: true, $or: [{userId:null},...] }
//   Needs compound { verified, userId, ... } indexes
//
// product-dao.js searchProduct():
//   Always match = { userId: null } → single-field indexes work fine
// ─────────────────────────────────────────────────────────────────────

const INDEXES = [
  // ══════════════════════════════════════════════════════════════════════
  // GROUP A: BARCODE LOOKUP
  // ══════════════════════════════════════════════════════════════════════
  // product-dao.js → getProductByCode(): .findOne({ code, userId: X/null })
  {
    keys: { code: 1, userId: 1 },
    options: { name: "idx_code_userId", background: true },
    reason: "getProductByCode() — barcode scan, first own then global",
  },

  // ══════════════════════════════════════════════════════════════════════
  // GROUP B: OWN-PRODUCT COMPOUND INDEXES (userId prefix)
  // These are THE FIX. Without them, queries Q1-Q6 do COLLSCAN on 3M+
  // docs in PRO, timeout, and only the $text result (stripped) survives.
  // ══════════════════════════════════════════════════════════════════════

  // B1: Listing + sort (no search) — CASE 1000/1001
  // .find({ userId: X }).sort({ name: 1, _id: 1 })
  {
    keys: { userId: 1, name: 1, _id: 1 },
    options: { name: "idx_userId_name_id", background: true },
    reason: "Q: own-product listing sorted by name (CASE 1000/1001, no search)",
  },

  // B2: Q1 exact nameNormalized + Q2 startsWith nameNormalized range
  // .find({ userId: X, nameNormalized: Y }) → equality
  // .find({ userId: X, nameNormalized: { $gte, $lte } }) → range scan
  // .sort({ nameNormalized: 1, _id: 1 }) → covered by index order
  {
    keys: { userId: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_userId_nameNormalized_id", background: true },
    reason: "Q1+Q2: own exact/startsWith name search — THE CRITICAL FIX",
  },

  // B3: Q3 exact brandNormalized + Q4 startsWith brandNormalized range
  // .find({ userId: X, brandNormalized: Y })
  // .find({ userId: X, brandNormalized: { $gte, $lte } })
  // .sort({ brandNormalized: 1, _id: 1 })
  {
    keys: { userId: 1, brandNormalized: 1, _id: 1 },
    options: { name: "idx_userId_brandNormalized_id", background: true },
    reason: "Q3+Q4: own exact/startsWith brand search",
  },

  // B4: Q5 prefix name array lookup
  // .find({ userId: X, namePrefixes: Y })
  {
    keys: { userId: 1, namePrefixes: 1 },
    options: { name: "idx_userId_namePrefixes", background: true },
    reason: "Q5: own prefix name search",
  },

  // B5: Q6 prefix brand array lookup
  // .find({ userId: X, brandPrefixes: Y })
  {
    keys: { userId: 1, brandPrefixes: 1 },
    options: { name: "idx_userId_brandPrefixes", background: true },
    reason: "Q6: own prefix brand search",
  },

  // ══════════════════════════════════════════════════════════════════════
  // GROUP C: GLOBAL / $or PRODUCT INDEXES (single-field)
  // For CASE 0000 with $or on userId, MongoDB uses INDEX MERGE —
  // each $or branch picks the best single-field index.
  // Also used by product-dao.js searchProduct() (always userId: null).
  // ══════════════════════════════════════════════════════════════════════

  // C1: exact global name
  {
    keys: { nameNormalized: 1 },
    options: { name: "idx_nameNormalized", background: true },
    reason: "Global Q1: exact name search + $or branch for CASE 0000",
  },

  // C2: exact global brand
  {
    keys: { brandNormalized: 1 },
    options: { name: "idx_brandNormalized", background: true },
    reason: "Global Q3: exact brand search + $or branch for CASE 0000",
  },

  // C3: global prefix name
  {
    keys: { namePrefixes: 1 },
    options: { name: "idx_namePrefixes", background: true },
    reason: "Global Q5: prefix name search",
  },

  // C4: global prefix brand
  {
    keys: { brandPrefixes: 1 },
    options: { name: "idx_brandPrefixes", background: true },
    reason: "Global Q6: prefix brand search",
  },

  // ══════════════════════════════════════════════════════════════════════
  // GROUP D: VERIFIED + SHIELD FILTER (CASE 0010, 0011)
  // ══════════════════════════════════════════════════════════════════════

  // D1: Listing verified products sorted by name
  // .find({ verified: true, $or: [{userId:null},{userId:{$exists:false}}] })
  {
    keys: { verified: 1, userId: 1, name: 1 },
    options: { name: "idx_verified_userId_name", background: true },
    reason: "CASE 0010: verified product listing with name sort",
  },

  // D2: Verified + exact name search
  {
    keys: { verified: 1, userId: 1, nameNormalized: 1 },
    options: { name: "idx_verified_userId_nameNormalized", background: true },
    reason: "CASE 0010 + search: verified exact name",
  },

  // D3: Verified + prefix name search
  {
    keys: { verified: 1, userId: 1, namePrefixes: 1 },
    options: { name: "idx_verified_userId_namePrefixes", background: true },
    reason: "CASE 0010 + search: verified prefix name",
  },

  // ══════════════════════════════════════════════════════════════════════
  // GROUP E: TEXT INDEX (ONE PER COLLECTION)
  // ══════════════════════════════════════════════════════════════════════
  // IMPORTANT: NO userId prefix. MongoDB requires equality match on all
  // prefix fields of a compound text index. CASE 0000 uses:
  //   { $or: [{userId:X},{userId:null},{userId:{$exists:false}}], $text: ... }
  // An $or is NOT an equality match → compound text index would fail with
  // "failed to use text index to satisfy $text query".
  //
  // This is safe because Q1-Q6 always score higher (≥70000) than Q7
  // (~40000), so the $text result (which may have stripped fields due
  // to the $meta projection) NEVER wins as the final candidate.
  {
    keys: { name: "text", brand: "text" },
    options: {
      name: "idx_text_name_brand",
      background: true,
      weights: { name: 10, brand: 4 },
    },
    reason: "Q7: $text fulltext search — no userId prefix (required for $or in CASE 0000)",
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
// STEP 4: VERIFY — run explain() on ALL critical query patterns
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

  const fakeUserId = new mongoose.Types.ObjectId();
  const queryUpperBound = "pollo\uffff";

  // Every query that executeProductQuery() fires, for both ownFilter and global
  const QUERIES = [
    // ── OWN PRODUCT QUERIES (ownFilter=true, CASE 1000) ──────────────
    {
      label: "OWN Q1: exact nameNormalized",
      query: { userId: fakeUserId, nameNormalized: "pollo" },
    },
    {
      label: "OWN Q2: startsWith nameNormalized (range)",
      query: { userId: fakeUserId, nameNormalized: { $gte: "pollo", $lte: queryUpperBound } },
      sort: { nameNormalized: 1, _id: 1 },
    },
    {
      label: "OWN Q3: exact brandNormalized",
      query: { userId: fakeUserId, brandNormalized: "pollo" },
    },
    {
      label: "OWN Q4: startsWith brandNormalized (range)",
      query: { userId: fakeUserId, brandNormalized: { $gte: "pollo", $lte: queryUpperBound } },
      sort: { brandNormalized: 1, _id: 1 },
    },
    {
      label: "OWN Q5: namePrefixes",
      query: { userId: fakeUserId, namePrefixes: "poll" },
    },
    {
      label: "OWN Q6: brandPrefixes",
      query: { userId: fakeUserId, brandPrefixes: "poll" },
    },
    {
      label: "OWN Q7: $text",
      query: { userId: fakeUserId, $text: { $search: "pollo" } },
      projection: { score: { $meta: "textScore" } },
      sort: { score: { $meta: "textScore" } },
    },
    // ── OWN: no search, just listing ─────────────────────────────────
    {
      label: "OWN listing: sort by name (no search)",
      query: { userId: fakeUserId },
      sort: { name: 1, _id: 1 },
    },
    // ── GLOBAL QUERIES (product-dao.js searchProduct) ────────────────
    {
      label: "GLOBAL Q1: exact nameNormalized",
      query: { userId: null, nameNormalized: "pollo" },
    },
    {
      label: "GLOBAL Q5: namePrefixes",
      query: { userId: null, namePrefixes: "poll" },
    },
    {
      label: "GLOBAL Q7: $text",
      query: { userId: null, $text: { $search: "pollo" } },
      projection: { score: { $meta: "textScore" } },
      sort: { score: { $meta: "textScore" } },
    },
    // ── VERIFIED (CASE 0010) ─────────────────────────────────────────
    {
      label: "VERIFIED listing",
      query: { verified: true, userId: null },
      sort: { name: 1 },
    },
    {
      label: "VERIFIED + search nameNormalized",
      query: { verified: true, userId: null, nameNormalized: "pollo" },
    },
    // ── BARCODE ──────────────────────────────────────────────────────
    {
      label: "BARCODE own",
      query: { code: "8410128000000", userId: fakeUserId },
    },
    {
      label: "BARCODE global",
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
