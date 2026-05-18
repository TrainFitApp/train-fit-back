const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const Recipe = require("../components/recipes/recipe-schema");
const { buildSearchFields } = require("../components/util/search-index");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");
const SKIP_BACKFILL = hasFlag("--skip-backfill");

const LOG_PREFIX = "[rebuild-search-indexes]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const PRODUCT_INDEXES = [
  {
    keys: { code: 1, userId: 1 },
    options: { name: "idx_products_code_userId", background: true },
  },
  {
    keys: { userId: 1, name: 1, _id: 1 },
    options: { name: "idx_products_userId_name_id", background: true },
  },
  {
    keys: { userId: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_products_userId_nameNormalized_id", background: true },
  },
  {
    keys: { userId: 1, brandNormalized: 1, _id: 1 },
    options: { name: "idx_products_userId_brandNormalized_id", background: true },
  },
  {
    keys: { userId: 1, namePrefixes: 1 },
    options: { name: "idx_products_userId_namePrefixes", background: true },
  },
  {
    keys: { userId: 1, brandPrefixes: 1 },
    options: { name: "idx_products_userId_brandPrefixes", background: true },
  },
  {
    keys: { nameNormalized: 1 },
    options: { name: "idx_products_nameNormalized", background: true },
  },
  {
    keys: { brandNormalized: 1 },
    options: { name: "idx_products_brandNormalized", background: true },
  },
  {
    keys: { namePrefixes: 1 },
    options: { name: "idx_products_namePrefixes", background: true },
  },
  {
    keys: { brandPrefixes: 1 },
    options: { name: "idx_products_brandPrefixes", background: true },
  },
  {
    keys: { verified: 1, userId: 1, name: 1, _id: 1 },
    options: { name: "idx_products_verified_userId_name_id", background: true },
  },
  {
    keys: { verified: 1, userId: 1, nameNormalized: 1, _id: 1 },
    options: {
      name: "idx_products_verified_userId_nameNormalized_id",
      background: true,
    },
  },
  {
    keys: { verified: 1, userId: 1, brandNormalized: 1, _id: 1 },
    options: {
      name: "idx_products_verified_userId_brandNormalized_id",
      background: true,
    },
  },
  {
    keys: { verified: 1, userId: 1, namePrefixes: 1 },
    options: {
      name: "idx_products_verified_userId_namePrefixes",
      background: true,
    },
  },
  {
    keys: { verified: 1, userId: 1, brandPrefixes: 1 },
    options: {
      name: "idx_products_verified_userId_brandPrefixes",
      background: true,
    },
  },
  {
    keys: { name: "text", brand: "text" },
    options: {
      name: "idx_products_text_name_brand",
      background: true,
      weights: { name: 10, brand: 4 },
    },
  },
];

const RECIPE_INDEXES = [
  {
    keys: { userId: 1, name: 1, _id: 1 },
    options: { name: "idx_recipes_userId_name_id", background: true },
  },
  {
    keys: { verified: 1, name: 1, _id: 1 },
    options: { name: "idx_recipes_verified_name_id", background: true },
  },
  {
    keys: { userId: 1, verified: 1, name: 1, _id: 1 },
    options: { name: "idx_recipes_userId_verified_name_id", background: true },
  },
  {
    keys: { userId: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_recipes_userId_nameNormalized_id", background: true },
  },
  {
    keys: { userId: 1, namePrefixes: 1 },
    options: { name: "idx_recipes_userId_namePrefixes", background: true },
  },
  {
    keys: { verified: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_recipes_verified_nameNormalized_id", background: true },
  },
  {
    keys: { verified: 1, namePrefixes: 1 },
    options: { name: "idx_recipes_verified_namePrefixes", background: true },
  },
  {
    keys: { userId: 1, verified: 1, nameNormalized: 1, _id: 1 },
    options: {
      name: "idx_recipes_userId_verified_nameNormalized_id",
      background: true,
    },
  },
  {
    keys: { userId: 1, verified: 1, namePrefixes: 1 },
    options: {
      name: "idx_recipes_userId_verified_namePrefixes",
      background: true,
    },
  },
  {
    keys: { name: "text" },
    options: {
      name: "idx_recipes_text_name",
      background: true,
      weights: { name: 10 },
    },
  },
];

async function dropUserIndexes(collection, label) {
  const indexes = await collection.indexes();
  const names = indexes.filter((idx) => idx.name !== "_id_").map((idx) => idx.name);

  if (!names.length) {
    log(`${label}: no extra indexes to drop.`);
    return;
  }

  log(`${label}: dropping ${names.length} indexes -> ${names.join(", ")}`);
  if (!DRY_RUN) {
    await collection.dropIndexes();
  }
  ok(`${label}: indexes dropped`);
}

async function createIndexes(collection, label, definitions) {
  log(`${label}: creating ${definitions.length} indexes`);
  for (const def of definitions) {
    log(`${label}: create ${def.options.name} ${JSON.stringify(def.keys)}`);
    if (!DRY_RUN) {
      await collection.createIndex(def.keys, def.options);
    }
  }
  ok(`${label}: indexes created`);
}

function areStringArraysEqual(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function backfillProducts() {
  log("products: backfilling search fields");
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

  const ops = [];
  const batchSize = 1000;
  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const next = buildSearchFields(doc);
    const changed =
      doc.nameNormalized !== next.nameNormalized ||
      doc.brandNormalized !== next.brandNormalized ||
      !areStringArraysEqual(doc.namePrefixes, next.namePrefixes) ||
      !areStringArraysEqual(doc.brandPrefixes, next.brandPrefixes);

    if (!changed) continue;

    ops.push({
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

    if (ops.length >= batchSize) {
      if (!DRY_RUN) {
        const result = await Product.bulkWrite(ops, { ordered: false });
        updated += result.modifiedCount || 0;
      } else {
        updated += ops.length;
      }
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    if (!DRY_RUN) {
      const result = await Product.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    } else {
      updated += ops.length;
    }
  }

  ok(`products: backfill scanned=${scanned} updated=${updated}`);
}

async function backfillRecipes() {
  log("recipes: backfilling search fields");
  const cursor = Recipe.find(
    {},
    {
      _id: 1,
      name: 1,
      nameNormalized: 1,
      namePrefixes: 1,
    },
  )
    .lean()
    .cursor();

  const ops = [];
  const batchSize = 1000;
  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const next = buildSearchFields(doc);
    const changed =
      doc.nameNormalized !== next.nameNormalized ||
      !areStringArraysEqual(doc.namePrefixes, next.namePrefixes);

    if (!changed) continue;

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            nameNormalized: next.nameNormalized,
            namePrefixes: next.namePrefixes,
          },
        },
      },
    });

    if (ops.length >= batchSize) {
      if (!DRY_RUN) {
        const result = await Recipe.bulkWrite(ops, { ordered: false });
        updated += result.modifiedCount || 0;
      } else {
        updated += ops.length;
      }
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    if (!DRY_RUN) {
      const result = await Recipe.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    } else {
      updated += ops.length;
    }
  }

  ok(`recipes: backfill scanned=${scanned} updated=${updated}`);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN} skipBackfill=${SKIP_BACKFILL}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  await dropUserIndexes(Product.collection, "products");
  await dropUserIndexes(Recipe.collection, "recipes");

  await createIndexes(Product.collection, "products", PRODUCT_INDEXES);
  await createIndexes(Recipe.collection, "recipes", RECIPE_INDEXES);

  if (!SKIP_BACKFILL) {
    await backfillProducts();
    await backfillRecipes();
  } else {
    log("backfill skipped");
  }

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore disconnect errors
  }
  process.exitCode = 1;
});
