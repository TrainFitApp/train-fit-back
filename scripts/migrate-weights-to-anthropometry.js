const mongoose = require("mongoose");
require("dotenv").config({ path: "../.env" });

const DietDay = require("./components/dietDays/diet-days-schema");
const Anthropometry = require("./components/anthropometry/anthropometry-schema");
const User = require("./components/users/schema");

async function migrate() {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/trainfit";
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const anthropometryModel = mongoose.model("Anthropometry", Anthropometry);
  const dietDayModel = mongoose.model("DietDay", DietDay);

  const dietDaysWithWeight = await dietDayModel.find({ weight: { $ne: null, $exists: true } }).lean();
  console.log(`Found ${dietDaysWithWeight.length} diet days with weight`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const dietDay of dietDaysWithWeight) {
    try {
      if (!dietDay.date || !dietDay.weight) {
        skipped++;
        continue;
      }

      // Need to find which user this diet day belongs to
      // Diet days are referenced by diet, so we need to find the diet and then the user
      const Diet = require("./components/diets/diet-schema");
      const DietModel = mongoose.model("Diet", Diet);
      const diet = await DietModel.findOne({ dietsDay: dietDay._id }).lean();

      if (!diet) {
        console.log(`No diet found for dietDay ${dietDay._id}, skipping`);
        skipped++;
        continue;
      }

      const user = await User.findOne({ dietInUse: diet._id }).lean();
      if (!user) {
        // Try archived diets
        const userWithArchived = await User.findOne({ archivedDiets: diet._id }).lean();
        if (!userWithArchived) {
          console.log(`No user found for diet ${diet._id}, skipping`);
          skipped++;
          continue;
        }
      }

      const userId = user ? user._id : userWithArchived._id;

      // Check if anthropometry already exists for this user/date
      const existing = await anthropometryModel.findOne({ userId, date: dietDay.date });
      if (existing) {
        console.log(`Anthropometry already exists for user ${userId} on ${dietDay.date}, skipping`);
        skipped++;
        continue;
      }

      await anthropometryModel.create({
        userId,
        date: dietDay.date,
        weight: dietDay.weight,
      });

      created++;
      if (created % 100 === 0) {
        console.log(`Created ${created} anthropometry records...`);
      }
    } catch (err) {
      console.error(`Error migrating dietDay ${dietDay._id}:`, err.message);
      errors++;
    }
  }

  console.log("\nMigration complete:");
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});