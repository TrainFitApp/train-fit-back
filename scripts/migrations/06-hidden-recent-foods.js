// Recientes ocultos del buscador de alimentos (B1, 2026-10): la colección
// `hiddenrecentfoods` (solo PRE: la función es de develop) pasa a
// `users.hiddenRecentFoods[]`.
//
// Una entrada por (comida, tipo, alimento); si ya estaba en el usuario se
// queda la ocultación más reciente. Idempotente y seguro de relanzar después
// del despliegue. Con --drop-old (y todo ya en su usuario) borra la colección.

const keyOf = (entry) => `${entry.mealIndex}|${entry.kind}|${entry.refId ? String(entry.refId) : ""}`;

function merge(current, incoming) {
  const byKey = new Map((current || []).map((entry) => [keyOf(entry), entry]));
  let changed = false;
  for (const doc of incoming) {
    const entry = { _id: doc._id, mealIndex: doc.mealIndex, kind: doc.kind, refId: doc.refId ?? null, hiddenAt: doc.hiddenAt };
    const existing = byKey.get(keyOf(entry));
    if (existing && new Date(existing.hiddenAt) >= new Date(entry.hiddenAt)) continue;
    byKey.set(keyOf(entry), existing ? { ...existing, hiddenAt: entry.hiddenAt } : entry);
    changed = true;
  }
  return { entries: [...byKey.values()], changed };
}

async function migrateHiddenRecentFoods(db, { dryRun = false, dropOld = false } = {}) {
  const stats = { docs: 0, users: 0, orphans: 0, dropped: false };
  if (!(await db.listCollections({ name: "hiddenrecentfoods" }, { nameOnly: true }).toArray()).length) return stats;

  const old = db.collection("hiddenrecentfoods");
  const users = db.collection("users");
  const byUser = new Map();
  for await (const doc of old.find({})) {
    stats.docs += 1;
    const key = String(doc.userId);
    if (!byUser.has(key)) byUser.set(key, { userId: doc.userId, docs: [] });
    byUser.get(key).docs.push(doc);
  }

  for (const { userId, docs } of byUser.values()) {
    const user = await users.findOne({ _id: userId }, { projection: { hiddenRecentFoods: 1 } });
    if (!user) {
      stats.orphans += docs.length;
      continue;
    }
    const { entries, changed } = merge(user.hiddenRecentFoods, docs);
    if (!changed) continue;
    stats.users += 1;
    if (!dryRun) await users.updateOne({ _id: userId }, { $set: { hiddenRecentFoods: entries }, $inc: { __v: 1 } });
  }

  // Lo que acaba de escribirse es todo lo que había: ya se puede borrar.
  if (dropOld && !dryRun) {
    await old.drop();
    stats.dropped = true;
  }
  return stats;
}

module.exports = { migrateHiddenRecentFoods };
