require("dotenv").config();
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const { buildMongoUri } = require("./_mongo-uri");

function runStep(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      env: process.env,
      cwd: process.cwd(),
    });

    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Step failed: ${command} ${args.join(" ")} (code ${code})`));
    });
  });
}

function parseTerms() {
  const termsArg = process.argv.find((arg) => arg.startsWith("--terms="));
  if (!termsArg) return ["zanahoria", "prote"];
  const raw = termsArg.replace("--terms=", "");
  const parsed = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ["zanahoria", "prote"];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function dropProductIndexes() {
  const uri = buildMongoUri();
  await mongoose.connect(uri);
  console.log("[reset-product-search-stack] Connected to MongoDB");

  const collection = Product.collection;
  const before = await collection.indexes();
  console.log(
    `[reset-product-search-stack] Indexes before drop: ${before.map((i) => i.name).join(", ")}`,
  );

  await collection.dropIndexes();

  const after = await collection.indexes();
  console.log(
    `[reset-product-search-stack] Indexes after drop: ${after.map((i) => i.name).join(", ")}`,
  );

  await mongoose.disconnect();
}

async function run() {
  const skipDrop = hasFlag("--skip-drop");
  const skipBackfill = hasFlag("--skip-backfill");
  const skipVerify = hasFlag("--skip-verify");
  const terms = parseTerms();

  console.log("[reset-product-search-stack] Starting full reset flow");
  console.log(
    `[reset-product-search-stack] Options => skipDrop=${skipDrop} skipBackfill=${skipBackfill} skipVerify=${skipVerify} terms=${terms.join(",")}`,
  );

  if (!skipDrop) {
    await dropProductIndexes();
  }

  await runStep("npm", ["run", "create:product-search-indexes"]);

  if (!skipBackfill) {
    await runStep("npm", ["run", "backfill:product-search-fields"]);
  }

  if (!skipVerify) {
    for (const term of terms) {
      await runStep("npm", ["run", "verify:product-search-indexes", "--", term]);
    }
  }

  console.log("[reset-product-search-stack] Done");
}

run().catch((error) => {
  console.error("[reset-product-search-stack] error", error);
  process.exitCode = 1;
});
