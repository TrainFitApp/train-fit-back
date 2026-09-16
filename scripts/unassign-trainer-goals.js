const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// El entrenador ya no asigna objetivos nutricionales (2026-09): la meta la
// marcan fases y ciclos. Los objetivos que asignó pasan a ser objetivos
// normales del cliente (se quita `assignedByTrainerId`), se borran las
// notificaciones "goal_assigned" y se vacía `nutritionalGoal` de los
// protocolos. Va con el driver nativo: ninguno de esos campos sigue en los
// schemas, y con strictQuery un filtro por un campo ausente se vacía y
// afectaría a TODOS los documentos.
//
//   node scripts/unassign-trainer-goals.js --dry-run
//   node scripts/unassign-trainer-goals.js

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const uri = buildMongoUri();
  console.log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const goalsFilter = { assignedByTrainerId: { $exists: true } };
  const notificationsFilter = { type: "goal_assigned" };
  const protocolsFilter = { nutritionalGoal: { $exists: true } };

  console.log("nutritionalgoals con assignedByTrainerId:", await db.collection("nutritionalgoals").countDocuments(goalsFilter));
  console.log("notifications goal_assigned:", await db.collection("notifications").countDocuments(notificationsFilter));
  console.log("coachprotocols con nutritionalGoal:", await db.collection("coachprotocols").countDocuments(protocolsFilter));

  if (!DRY_RUN) {
    const goals = await db.collection("nutritionalgoals").updateMany(goalsFilter, { $unset: { assignedByTrainerId: "" } });
    const notifications = await db.collection("notifications").deleteMany(notificationsFilter);
    const protocols = await db.collection("coachprotocols").updateMany(protocolsFilter, { $unset: { nutritionalGoal: "" } });
    console.log(
      `objetivos: ${goals.modifiedCount}, notificaciones borradas: ${notifications.deletedCount}, protocolos: ${protocols.modifiedCount}`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
