// Limpieza final (2026-10): lo que ningún schema declara ya y no tiene un paso
// propio.
//
// - users: fuera los campos retirados (los de main y los de develop):
//   stepGoal, dietInUse, dietEnabled, tables, archivedDiets, archivedTables,
//   isPremium.
// - dietdays: fuera `steps` (main; los pasos son un hábito desde 2026-09).
// - notifications y coachalerts de tipos que ya no existen (meal_proposal,
//   anthropometry_requested, goal_assigned, pending_review…): se calcula a
//   partir del enum de cada schema.
// - Con --drop-old: los días sin dueño (en main colgaban de un `diets` que ya
//   no apuntaba ningún usuario: nadie los veía) y las colecciones sin modelo
//   ni paso propio: setdrafts, planassignments, foodexchangegroups, owntables.
//
// Idempotente: el runner lo pasa en cada ejecución.

const Notification = require("../../components/notifications/notification-schema");
const CoachAlert = require("../../components/coachAlerts/coach-alert-schema");

const RETIRED_USER_FIELDS = ["stepGoal", "dietInUse", "dietEnabled", "tables", "archivedDiets", "archivedTables", "isPremium"];
const ORPHAN_COLLECTIONS = ["setdrafts", "planassignments", "foodexchangegroups", "owntables"];

const typesOf = (model) => model.schema.path("type").enumValues;

async function cleanup(db, { dryRun = false, dropOld = false } = {}) {
  const stats = { users: 0, dietDaySteps: 0, ownerlessDietDays: 0, notifications: 0, coachAlerts: 0, dropped: [] };

  const retired = { $or: RETIRED_USER_FIELDS.map((field) => ({ [field]: { $exists: true } })) };
  stats.users = await db.collection("users").countDocuments(retired);
  if (!dryRun && stats.users) {
    await db
      .collection("users")
      .updateMany(retired, { $unset: Object.fromEntries(RETIRED_USER_FIELDS.map((field) => [field, ""])) });
  }

  const dietDays = db.collection("dietdays");
  stats.dietDaySteps = await dietDays.countDocuments({ steps: { $exists: true } });
  if (!dryRun && stats.dietDaySteps) await dietDays.updateMany({ steps: { $exists: true } }, { $unset: { steps: "" } });
  const ownerless = { userId: { $not: { $type: "objectId" } } };
  stats.ownerlessDietDays = await dietDays.countDocuments(ownerless);

  for (const [key, model, collection] of [
    ["notifications", Notification, "notifications"],
    ["coachAlerts", CoachAlert, "coachalerts"],
  ]) {
    const obsolete = { type: { $nin: typesOf(model) } };
    stats[key] = await db.collection(collection).countDocuments(obsolete);
    if (!dryRun && stats[key]) await db.collection(collection).deleteMany(obsolete);
  }

  if (dropOld && !dryRun) {
    if (stats.ownerlessDietDays) await dietDays.deleteMany(ownerless);
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ORPHAN_COLLECTIONS) {
      if (!existing.has(name)) continue;
      await db.dropCollection(name);
      stats.dropped.push(name);
    }
  }
  return stats;
}

module.exports = { cleanup, RETIRED_USER_FIELDS };
