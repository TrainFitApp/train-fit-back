require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { buildMongoUri } = require("./_mongo-uri");

async function createIndexes() {
  const mongoURI = buildMongoUri();
  await mongoose.connect(mongoURI);
  console.log("[create-product-search-indexes] Connected to MongoDB");

  const collection = Product.collection;

  const operations = [
    // Legacy / compatibility indexes (still useful for some list/sort paths)
    {
      keys: { userId: 1, name: 1, _id: 1 },
      options: { name: "idx_products_user_name_id", background: true },
    },
    {
      keys: { verified: 1, name: 1, _id: 1 },
      options: { name: "idx_products_verified_name_id", background: true },
    },
    {
      keys: { verified: 1, userId: 1, name: 1, _id: 1 },
      options: {
        name: "idx_products_verified_user_name_id",
        background: true,
      },
    },
    {
      keys: { name: 1, _id: 1 },
      options: { name: "idx_products_name_id", background: true },
    },
    {
      keys: { code: 1, userId: 1 },
      options: { name: "idx_products_code_user", background: true },
    },

    // New search engine indexes
    {
      keys: { nameNormalized: 1 },
      options: { name: "nameNormalized_1", background: true },
    },
    {
      keys: { brandNormalized: 1 },
      options: { name: "brandNormalized_1", background: true },
    },
    {
      keys: { namePrefixes: 1 },
      options: { name: "namePrefixes_1", background: true },
    },
    {
      keys: { brandPrefixes: 1 },
      options: { name: "brandPrefixes_1", background: true },
    },
    {
      keys: { name: "text", brand: "text" },
      options: {
        name: "name_text_brand_text",
        background: true,
        weights: { name: 10, brand: 4 },
      },
    },
    {
      keys: { userId: 1, name: 1 },
      options: { name: "userId_1_name_1", background: true },
    },
    {
      keys: { verified: 1, userId: 1, nameNormalized: 1 },
      options: { name: "verified_1_userId_1_nameNormalized_1", background: true },
    },
    {
      keys: { verified: 1, userId: 1, namePrefixes: 1 },
      options: { name: "verified_1_userId_1_namePrefixes_1", background: true },
    },
  ];

  for (const op of operations) {
    const indexName = await collection.createIndex(op.keys, op.options);
    console.log(`[create-product-search-indexes] ensured index: ${indexName}`);
  }

  const indexes = await collection.indexes();
  const names = indexes.map((idx) => idx.name).sort();
  console.log("[create-product-search-indexes] current indexes:");
  for (const name of names) {
    console.log(`- ${name}`);
  }

  await mongoose.disconnect();
}

createIndexes().catch(async (error) => {
  console.error("[create-product-search-indexes] error", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
