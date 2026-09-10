/* Migración aditiva. Simulación por defecto; requiere URI explícita y --apply para escribir. */
const mongoose = require("mongoose");
const Relation = require("../components/trainerClients/trainer-client-schema");
const Intake = require("../components/clientIntake/client-intake-schema");
const { groupRelations } = require("../components/clientOverview/overview-domain");
const { ensureStages } = require("../components/clientOverview/stage-service");

async function main() {
  const uri = process.env.TRAINFIT_OVERVIEW_MIGRATION_URI;
  if (!uri) throw new Error("Define TRAINFIT_OVERVIEW_MIGRATION_URI explícitamente. No se usa la conexión de producción por defecto.");
  const apply = process.argv.includes("--apply");
  await mongoose.connect(uri);
  const pairs = await Relation.aggregate([{ $match: { clientId: { $exists: true }, status: { $ne: "pending" } } }, { $group: { _id: { trainerId: "$trainerId", clientId: "$clientId" } } }]);
  const report = { mode: apply ? "apply" : "dry-run", pairs: pairs.length, stages: 0, estimatedStages: 0, unassignedIntakes: 0 };
  for (const pair of pairs) {
    const filter = pair._id;
    const groups = groupRelations(await Relation.find(filter).lean());
    report.stages += groups.length; report.estimatedStages += groups.filter((g) => g.estimated).length;
    const intake = await Intake.findOne(filter).lean();
    if (intake && !groups.some((g) => new Date(intake.submittedAt).getTime() >= g.start.getTime() && new Date(intake.submittedAt).getTime() <= g.end)) report.unassignedIntakes++;
    if (apply) await ensureStages(filter.trainerId, filter.clientId);
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { main };
