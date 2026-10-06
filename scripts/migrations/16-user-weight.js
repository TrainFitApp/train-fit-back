// El peso vive solo en las medidas (2026-10, docs/refactor-modelo-datos-estado.md D3).
//
// Antes:  users.weight (lo del registro y del editor de perfil) y, aparte,
//         el peso de cada medida (anthropometries). El objetivo y el
//         cuestionario usaban uno u otro según hubiera medidas.
// Ahora:  solo anthropometries. El perfil sigue enseñando y aceptando
//         `weight`, pero es el último peso apuntado / el de hoy.
//
// Quien no tenga ninguna medida con peso recibe una con su peso del perfil el
// día de su alta (zona de Madrid). Quien ya tenga, conserva las suyas (el
// informe cuenta cuántos tenían en el perfil otro valor distinto del último).
// Después desaparece users.weight. Idempotente.

const TIME_ZONE = "Europe/Madrid";

function dayInZone(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function migrateUserWeight(db, { dryRun = false } = {}) {
  const users = db.collection("users");
  const anthropometries = db.collection("anthropometries");
  const withWeight = await users.find({ weight: { $exists: true } }, { projection: { weight: 1 } }).toArray();
  const stats = { users: withWeight.length, seeded: 0, alreadyMeasured: 0, differentFromLatest: 0, invalid: 0 };

  for (const user of withWeight) {
    const weight = user.weight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 30 || weight > 300) {
      stats.invalid += 1;
      continue;
    }
    const latest = await anthropometries.findOne({ userId: user._id, weight: { $type: "number" } }, { sort: { date: -1 } });
    if (latest) {
      stats.alreadyMeasured += 1;
      if (latest.weight !== weight) stats.differentFromLatest += 1;
      continue;
    }
    stats.seeded += 1;
    if (!dryRun) {
      await anthropometries.updateOne(
        { userId: user._id, date: dayInZone(user._id.getTimestamp()) },
        { $set: { weight }, $setOnInsert: { userId: user._id, date: dayInZone(user._id.getTimestamp()) } },
        { upsert: true }
      );
    }
  }
  if (!dryRun && withWeight.length) await users.updateMany({ weight: { $exists: true } }, { $unset: { weight: "" } });
  return stats;
}

module.exports = { migrateUserWeight };
