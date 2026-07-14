const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");

const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");
const User = require("../components/users/schema");

async function migrate() {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("DRY RUN — no changes will be made");

  const mongoUri = buildMongoUri();
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const NutritionalGoalModel = NutritionalGoal;

  const users = await User.find({
    $or: [
      { kcalTotal: { $exists: true } },
      { proteinsGTotal: { $exists: true } },
    ],
  }).lean();

  console.log(`Found ${users.length} users with legacy macro fields`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      if (!user.kcalTotal && !user.proteinsGTotal) {
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log(`[DRY RUN] Would migrate user ${user.email || user._id}`);
        skipped++;
        continue;
      }

      const goal = await NutritionalGoalModel.create({
        userId: user._id,
        name: "Default",
        kcalTotal: user.kcalTotal || 0,
        proteinsGTotal: user.proteinsGTotal || 0,
        carbohydratesGTotal: user.carbohydratesGTotal || 0,
        fatGTotal: user.fatGTotal || 0,
      });

      await User.findByIdAndUpdate(user._id, {
        $set: { goalInUse: goal._id },
        $unset: {
          kcalTotal: "",
          proteinsGTotal: "",
          carbohydratesGTotal: "",
          fatGTotal: "",
        },
      });

      created++;
      console.log(`Migrated user ${user.email || user._id} -> goal ${goal._id}`);
    } catch (err) {
      console.error(`Error migrating user ${user._id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n${isDryRun ? "Dry run" : "Migration"} complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);

  if (isDryRun) {
    console.log("No changes were made.");
  }

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
