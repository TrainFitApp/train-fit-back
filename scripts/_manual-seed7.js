const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");

async function main() {
  await mongoose.connect(buildMongoUri());
  const userSchema = require("../components/users/schema");
  const tableService = require("../components/tables/table-service");
  const tableSchema = require("../components/tables/table-schema");
  const splitService = require("../components/splits/split-service");
  const workoutService = require("../components/workouts/workout-service");
  const exerciseSchema = require("../components/exercises/exercise-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const setSchema = require("../components/sets/set-schema");

  const email = "manual-verify-trainer7@test.local";
  let trainer = await userSchema.findOne({ email });
  if (!trainer) {
    trainer = await userSchema.create({ email, password: "TestPass123!", name: "Manual7", lastname: "Trainer", roles: ["trainer"] });
  }
  console.log("trainer", trainer._id.toString());

  const existingTables = await tableSchema.find({ userId: trainer._id }).select("_id");
  for (const t of existingTables) await tableService.deleteTable(trainer._id.toString(), t._id.toString(), false);

  const table = await tableService.createOwnRoutineTemplate(trainer._id.toString(), "Rutina cancel test");
  await splitService.createBlankSplitAndAddToTable(table._id.toString(), "Semana 1");
  const finalSplits = await workoutService.addWorkoutsToSplits(table._id.toString(), [{ name: "Empuje" }, { name: "Tiron" }]);

  const exercises = await exerciseSchema.find().limit(2);
  const workoutA = finalSplits[0].workouts[0];
  const set = await setSchema.create({ reps: 10, weight: 50, order: 0 });
  const ce = await customExerciseSchema.create({ exercise: exercises[0]._id, order: 0, sets: [set._id] });
  await workoutSchema.findByIdAndUpdate(workoutA._id, { $push: { exercises: ce._id } });

  console.log("TABLE_ID=" + table._id.toString());

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
