require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { buildSearchFields } = require("../components/util/search-index");
const { buildMongoUri } = require("./_mongo-uri");

async function backfill() {
  const mongoURI = buildMongoUri();
  await mongoose.connect(mongoURI);
  console.log("[backfill-product-search-fields] Connected to MongoDB");

  const cursor = Product.find(
    {},
    { _id: 1, name: 1, brand: 1, nameNormalized: 1, brandNormalized: 1 },
  )
    .lean()
    .cursor();

  const bulkOps = [];
  let scanned = 0;
  let updated = 0;
  const batchSize = 1000;

  for await (const doc of cursor) {
    scanned += 1;
    const nextFields = buildSearchFields(doc);

    const shouldUpdate =
      doc.nameNormalized !== nextFields.nameNormalized ||
      doc.brandNormalized !== nextFields.brandNormalized;

    if (!shouldUpdate) continue;

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
        `[backfill-product-search-fields] scanned=${scanned} updated=${updated}`,
      );
    }
  }

  if (bulkOps.length > 0) {
    const result = await Product.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount || 0;
  }

  console.log(
    `[backfill-product-search-fields] done scanned=${scanned} updated=${updated}`,
  );
  await mongoose.disconnect();
}

backfill().catch(async (error) => {
  console.error("[backfill-product-search-fields] error", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
