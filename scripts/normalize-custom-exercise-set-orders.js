require("dotenv").config();
const mongoose = require("mongoose");
mongoose.set("strictQuery", true);

function parseArgs(argv) {
  return argv.reduce(
    (acc, arg) => {
      if (arg === "--commit") acc.commit = true;
      else if (arg.startsWith("--limit=")) acc.limit = Number(arg.slice(8));
      else if (arg.startsWith("--sample=")) acc.sample = Number(arg.slice(9));
      return acc;
    },
    { commit: false, limit: 0, sample: 10 },
  );
}

function buildMongoUri() {
  const mongoDBUser = process.env.MONGODB_USER;
  const mongoDBPass = process.env.MONGODB_PASS;
  const mongoDBCluster =
    process.env.MONGODB_CLUSTER || process.env.MONGODB_HOST || "localhost";
  const mongoDBDB = process.env.MONGODB_DB;

  if (!mongoDBDB) {
    throw new Error("MONGODB_DB is required");
  }

  if (
    mongoDBCluster.includes("localhost") ||
    mongoDBCluster.includes("127.0.0.1")
  ) {
    return `mongodb://${mongoDBCluster}/${mongoDBDB}`;
  }

  return `mongodb+srv://${mongoDBUser}:${mongoDBPass}@${mongoDBCluster}.mongodb.net/${mongoDBDB}`;
}

function numericOrder(value, fallback) {
  const order = Number(value);
  return Number.isFinite(order) ? order : fallback;
}

function sameId(left, right) {
  return left?.toString() === right?.toString();
}

function analyzeCustomExercise(customExercise, setDocs) {
  const setById = new Map(setDocs.map((setDoc) => [setDoc._id.toString(), setDoc]));
  const items = (customExercise.sets || []).map((setId, index) => ({
    setId,
    index,
    doc: setById.get(setId.toString()),
  }));

  const missingRefs = items.filter((item) => !item.doc);
  const normalizedItems = items
    .filter((item) => item.doc)
    .sort((a, b) => {
      const orderDiff =
        numericOrder(a.doc.order, Number.MAX_SAFE_INTEGER) -
        numericOrder(b.doc.order, Number.MAX_SAFE_INTEGER);

      if (orderDiff !== 0) return orderDiff;
      return a.index - b.index;
    })
    .map((item, order) => ({ ...item, order }));

  const normalizedSetIds = normalizedItems.map((item) => item.setId);
  const arrayChanged =
    normalizedSetIds.length !== customExercise.sets.length ||
    normalizedSetIds.some((setId, index) => !sameId(setId, customExercise.sets[index]));

  const setOrderUpdates = normalizedItems.filter(
    (item) => item.doc.order !== item.order,
  );

  return {
    affected:
      missingRefs.length > 0 || arrayChanged || setOrderUpdates.length > 0,
    missingRefs,
    normalizedSetIds,
    setOrderUpdates,
    beforeOrders: items.map((item) => item.doc?.order ?? null),
    afterOrders: normalizedItems.map((item) => item.order),
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = buildMongoUri();
  await mongoose.connect(mongoUri);

  const customExercises = mongoose.connection.db.collection("customexercises");
  const sets = mongoose.connection.db.collection("sets");

  const summary = {
    mode: options.commit ? "commit" : "dry-run",
    scanned: 0,
    affected: 0,
    missingRefs: 0,
    setOrderUpdates: 0,
    customExerciseArrayUpdates: 0,
    samples: [],
  };

  const cursor = customExercises
    .find({ sets: { $exists: true, $ne: [] } }, { projection: { sets: 1 } })
    .batchSize(500);

  for await (const customExercise of cursor) {
    if (options.limit && summary.scanned >= options.limit) break;
    summary.scanned += 1;

    const setIds = customExercise.sets || [];
    const setDocs = await sets
      .find(
        { _id: { $in: setIds } },
        { projection: { order: 1 } },
      )
      .toArray();

    const analysis = analyzeCustomExercise(customExercise, setDocs);
    if (!analysis.affected) continue;

    summary.affected += 1;
    summary.missingRefs += analysis.missingRefs.length;
    summary.setOrderUpdates += analysis.setOrderUpdates.length;

    const arrayChanged =
      analysis.normalizedSetIds.length !== setIds.length ||
      analysis.normalizedSetIds.some((setId, index) => !sameId(setId, setIds[index]));

    if (arrayChanged) summary.customExerciseArrayUpdates += 1;

    if (summary.samples.length < options.sample) {
      summary.samples.push({
        customExerciseId: customExercise._id.toString(),
        beforeOrders: analysis.beforeOrders,
        afterOrders: analysis.afterOrders,
        missingRefs: analysis.missingRefs.length,
      });
    }

    if (!options.commit) continue;

    if (analysis.setOrderUpdates.length > 0) {
      await sets.bulkWrite(
        analysis.setOrderUpdates.map((item) => ({
          updateOne: {
            filter: { _id: item.setId },
            update: { $set: { order: item.order } },
          },
        })),
      );
    }

    if (arrayChanged) {
      await customExercises.updateOne(
        { _id: customExercise._id },
        { $set: { sets: analysis.normalizedSetIds } },
      );
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
