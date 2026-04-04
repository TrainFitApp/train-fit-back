require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { normalizeSearchText } = require("../components/util/search-index");
const { buildMongoUri } = require("./_mongo-uri");

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

function summarizeExplain(name, explain) {
  const rootPlan = explain?.queryPlanner?.winningPlan || explain?.queryPlanner;
  const execution = explain?.executionStats || {};
  const stages = Array.from(collectStageNames(rootPlan));
  const indexNames = Array.from(collectIndexNames(rootPlan));
  const hasCollscan = stages.includes("COLLSCAN");

  return {
    name,
    nReturned: execution.nReturned,
    totalDocsExamined: execution.totalDocsExamined,
    totalKeysExamined: execution.totalKeysExamined,
    executionTimeMillis: execution.executionTimeMillis,
    hasCollscan,
    indexNames,
    stages,
  };
}

async function verify() {
  const queryRaw = process.argv[2] || process.env.SEARCH_VERIFY_TERM || "zanahoria";
  const normalizedQuery = normalizeSearchText(queryRaw);
  if (!normalizedQuery) {
    throw new Error("Search term is empty after normalization.");
  }

  const mongoURI = buildMongoUri();
  await mongoose.connect(mongoURI);
  console.log("[verify-product-search-indexes] Connected to MongoDB");
  console.log(
    `[verify-product-search-indexes] term="${queryRaw}" normalized="${normalizedQuery}"`,
  );

  const col = Product.collection;

  const [exactExplain, prefixExplain, textExplain] = await Promise.all([
    col
      .find({ nameNormalized: normalizedQuery, userId: null })
      .limit(20)
      .explain("executionStats"),
    col
      .find({ namePrefixes: normalizedQuery, userId: null })
      .limit(20)
      .explain("executionStats"),
    col
      .find(
        { $text: { $search: queryRaw }, userId: null },
        { projection: { score: { $meta: "textScore" } } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(20)
      .explain("executionStats"),
  ]);

  const summaries = [
    summarizeExplain("exact_nameNormalized", exactExplain),
    summarizeExplain("prefix_namePrefixes", prefixExplain),
    summarizeExplain("text_name_brand", textExplain),
  ];

  for (const item of summaries) {
    console.log(`\n[${item.name}]`);
    console.log(`- hasCollscan: ${item.hasCollscan}`);
    console.log(`- indexes: ${item.indexNames.join(", ") || "(none)"}`);
    console.log(`- stages: ${item.stages.join(" -> ") || "(unknown)"}`);
    console.log(`- nReturned: ${item.nReturned}`);
    console.log(`- totalDocsExamined: ${item.totalDocsExamined}`);
    console.log(`- totalKeysExamined: ${item.totalKeysExamined}`);
    console.log(`- executionTimeMillis: ${item.executionTimeMillis}`);
  }

  const failed = summaries.some((item) => item.hasCollscan);
  if (failed) {
    console.error(
      "\n[verify-product-search-indexes] WARNING: at least one query used COLLSCAN.",
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\n[verify-product-search-indexes] OK: no COLLSCAN detected in verified queries.",
    );
  }

  await mongoose.disconnect();
}

verify().catch(async (error) => {
  console.error("[verify-product-search-indexes] error", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
