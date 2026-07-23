const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");

const Exercise = require("../components/exercises/exercise-schema");

async function migrate() {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("DRY RUN — no changes will be made");

  const dataPath = path.join(__dirname, "data", "exercise-description-steps-es.json");
  const entries = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${entries.length} default exercises with step-split descriptions`);

  const mongoUri = buildMongoUri();
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const backup = [];

  for (const entry of entries) {
    try {
      const doc = await Exercise.findById(entry._id);
      if (!doc) {
        console.log(`No exercise found for id ${entry._id} (${entry.name}), skipping`);
        skipped++;
        continue;
      }
      if (doc.userId) {
        console.log(`Exercise ${entry.name} now has a userId, skipping (no longer default)`);
        skipped++;
        continue;
      }

      const newDescription = entry.esSteps.join("\n");
      if (doc.description === newDescription) {
        skipped++;
        continue;
      }

      backup.push({ _id: doc._id, name: doc.name, description: doc.description });

      if (isDryRun) {
        console.log(`[DRY RUN] Would update ${entry.name} (${entry._id})`);
        updated++;
        continue;
      }

      doc.description = newDescription;
      await doc.save();
      updated++;
    } catch (err) {
      console.error(`Error updating ${entry.name} (${entry._id}):`, err.message);
      errors++;
    }
  }

  if (!isDryRun && backup.length > 0) {
    const backupPath = path.join(
      __dirname,
      `exercise-description-backup-${Date.now()}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
    console.log(`Backed up ${backup.length} original descriptions to ${backupPath}`);
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
