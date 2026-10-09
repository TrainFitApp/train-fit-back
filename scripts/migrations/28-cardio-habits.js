// Fuera el hábito predefinido de cardio (2026-10-09): el cardio se pauta y se
// registra en el entrenamiento, no como hábito diario. Lo que ya había no se
// pierde: pasa a hábito con nombre propio («Cardio», o el nombre que tuviera),
// con su objetivo, su unidad y el cumplimiento ya marcado.
//
//   trainertasks                type "cardio" → "custom"
//   coachprotocols.dailyTasks   cada hábito "cardio" → "custom"
//
// Idempotente: después no queda ningún "cardio" con el que casar.

const LABEL = "Cardio";
const WITHOUT_LABEL = { $in: [null, ""] };

async function migrateTasks(db, dryRun) {
  const tasks = db.collection("trainertasks");
  if (dryRun) return tasks.countDocuments({ type: "cardio" });
  await tasks.updateMany({ type: "cardio", label: WITHOUT_LABEL }, { $set: { label: LABEL } });
  return (await tasks.updateMany({ type: "cardio" }, { $set: { type: "custom" } })).modifiedCount;
}

async function migrateProtocols(db, dryRun) {
  const protocols = db.collection("coachprotocols");
  const filter = { "dailyTasks.type": "cardio" };
  if (dryRun) return protocols.countDocuments(filter);
  await protocols.updateMany(
    { dailyTasks: { $elemMatch: { type: "cardio", label: WITHOUT_LABEL } } },
    { $set: { "dailyTasks.$[task].label": LABEL } },
    { arrayFilters: [{ "task.type": "cardio", "task.label": WITHOUT_LABEL }] }
  );
  return (
    await protocols.updateMany(
      filter,
      { $set: { "dailyTasks.$[task].type": "custom" } },
      { arrayFilters: [{ "task.type": "cardio" }] }
    )
  ).modifiedCount;
}

async function migrateCardioHabits(db, { dryRun = false } = {}) {
  return {
    trainertasks: await migrateTasks(db, dryRun),
    coachprotocols: await migrateProtocols(db, dryRun),
  };
}

module.exports = { migrateCardioHabits };
