require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { buildSearchFields } = require("../components/util/search-index");
const { buildMongoUri } = require("./_mongo-uri");

function areStringArraysEqual(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

async function backfill() {
  const mongoURI = buildMongoUri();
  await mongoose.connect(mongoURI);
  console.log("[backfill-product-search-fields] Connected to MongoDB");

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
  const batchSize = 1000;

  for await (const doc of cursor) {
    scanned += 1;
    const nextFields = buildSearchFields(doc);

    const shouldUpdate =
      doc.nameNormalized !== nextFields.nameNormalized ||
      doc.brandNormalized !== nextFields.brandNormalized ||
      !areStringArraysEqual(doc.namePrefixes, nextFields.namePrefixes) ||
      !areStringArraysEqual(doc.brandPrefixes, nextFields.brandPrefixes);

    if (!shouldUpdate) continue;
    planned += 1;

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            nameNormalized: nextFields.nameNormalized,
            brandNormalized: nextFields.brandNormalized,
            namePrefixes: nextFields.namePrefixes,
            brandPrefixes: nextFields.brandPrefixes,
          },
        },
      },
    });

    if (bulkOps.length >= batchSize) {
      const result = await Product.bulkWrite(bulkOps, { ordered: false });
      updated += result.modifiedCount || 0;
      bulkOps.length = 0;
      console.log(
        `[backfill-product-search-fields] scanned=${scanned} planned=${planned} updated=${updated}`,
      );
    }
  }

  if (bulkOps.length > 0) {
    const result = await Product.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount || 0;
  }

  console.log(
    `[backfill-product-search-fields] done scanned=${scanned} planned=${planned} updated=${updated}`,
  );
  await mongoose.disconnect();
}

backfill().catch(async (error) => {
  console.error("[backfill-product-search-fields] error", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
