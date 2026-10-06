// Ajustes de usuario embebidos (2026-10, docs/analisis-modelo-datos.md P4).
//
// Antes:  clientnutritionpreferences  (un documento por cliente, por clientId)
//         trainerpaymentsettings      (un documento por entrenador, por trainerId)
//         trainerintakeconfigs        (un documento por entrenador, por trainerId)
//         nutritionalgoals            (varios por usuario, por userId)
// Ahora:  users.nutritionPreferences
//         users.trainerSettings.payments
//         users.trainerSettings.intake  (P5)
//         users.nutritionalGoals[]      (mismo _id: users.goalInUse no cambia)
//
// Idempotente y seguro de relanzar después del despliegue: si el usuario ya
// tiene el subdocumento, solo se pisa cuando el de la colección antigua es
// más reciente (`revision` en cobros, `updatedAt` en el resto), que es lo
// que pasa si la app vieja escribió entre la primera pasada y el despliegue.
// Los documentos de usuarios que ya no existen se cuentan y no se migran.
// Trabaja con las colecciones en crudo, sin modelos. Las colecciones antiguas
// solo se borran con --drop-old.


const SOURCES = [
  {
    name: "nutritionPreferences",
    collection: "clientnutritionpreferences",
    ownerField: "clientId",
    path: "nutritionPreferences",
    read: (user) => user?.nutritionPreferences,
    isNewer: (incoming, current) => !current || time(incoming.updatedAt) > time(current.updatedAt),
  },
  {
    name: "paymentSettings",
    collection: "trainerpaymentsettings",
    ownerField: "trainerId",
    path: "trainerSettings.payments",
    read: (user) => user?.trainerSettings?.payments,
    isNewer: (incoming, current) => !current || (incoming.revision || 0) > (current.revision || 0),
  },
  {
    name: "intakeConfig",
    collection: "trainerintakeconfigs",
    ownerField: "trainerId",
    path: "trainerSettings.intake",
    read: (user) => user?.trainerSettings?.intake,
    isNewer: (incoming, current) => !current || time(incoming.updatedAt) > time(current.updatedAt),
  },
];

const time = (value) => (value ? new Date(value).getTime() : 0);

// Lo que sobrevive de un objetivo nutricional (fuera dueño, versión y los
// campos de modelos ya retirados: assignedByTrainerId, startDate, endMode…).
const GOAL_FIELDS = ["name", "kcalTotal", "proteinsGTotal", "carbohydratesGTotal", "fatGTotal", "fiberGTotal", "source", "updatedByTrainerId", "createdAt", "updatedAt"];
const goalOf = (doc) => Object.fromEntries([["_id", doc._id], ...GOAL_FIELDS.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]])]);

function embeddable(doc, ownerField) {
  const { _id, __v, [ownerField]: owner, ...rest } = doc;
  return rest;
}

async function migrateEmbedUserSettings(db, { dryRun = false, dropOld = false, log = () => {} } = {}) {
  const users = db.collection("users");
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const stats = { dropped: [] };

  for (const source of SOURCES) {
    const counts = { read: 0, embedded: 0, alreadyCurrent: 0, missingUser: 0 };
    stats[source.name] = counts;
    if (!existing.has(source.collection)) continue;

    for await (const doc of db.collection(source.collection).find({})) {
      counts.read += 1;
      const user = await users.findOne({ _id: doc[source.ownerField] }, { projection: { [source.path]: 1 } });
      if (!user) {
        counts.missingUser += 1;
        continue;
      }
      const incoming = embeddable(doc, source.ownerField);
      if (!source.isNewer(incoming, source.read(user))) {
        counts.alreadyCurrent += 1;
        continue;
      }
      counts.embedded += 1;
      if (!dryRun) await users.updateOne({ _id: user._id }, { $set: { [source.path]: incoming } });
    }
  }

  const goals = { read: 0, embedded: 0, alreadyCurrent: 0, missingUser: 0 };
  stats.nutritionalGoals = goals;
  if (existing.has("nutritionalgoals")) {
    for await (const doc of db.collection("nutritionalgoals").find({})) {
      goals.read += 1;
      const user = await users.findOne({ _id: doc.userId }, { projection: { _id: 1, "nutritionalGoals._id": 1 } });
      if (!user) {
        goals.missingUser += 1;
        continue;
      }
      if ((user.nutritionalGoals || []).some((goal) => String(goal._id) === String(doc._id))) {
        goals.alreadyCurrent += 1;
        continue;
      }
      goals.embedded += 1;
      if (!dryRun) await users.updateOne({ _id: user._id }, { $push: { nutritionalGoals: goalOf(doc) } });
    }
  }

  if (dropOld && !dryRun) {
    if (existing.has("nutritionalgoals")) {
      for await (const doc of db.collection("nutritionalgoals").find({})) {
        const user = await users.findOne({ _id: doc.userId }, { projection: { "nutritionalGoals._id": 1 } });
        if (user && !(user.nutritionalGoals || []).some((goal) => String(goal._id) === String(doc._id))) {
          throw new Error(`nutritionalgoals ${doc._id} no está migrado: no se borra nada.`);
        }
      }
      await db.dropCollection("nutritionalgoals");
      stats.dropped.push("nutritionalgoals");
      log("dropped nutritionalgoals");
    }
    // Solo si cada documento antiguo ya está en su usuario (o el usuario no existe).
    for (const source of SOURCES) {
      if (!existing.has(source.collection)) continue;
      for await (const doc of db.collection(source.collection).find({})) {
        const user = await users.findOne({ _id: doc[source.ownerField] }, { projection: { [source.path]: 1 } });
        if (user && source.isNewer(embeddable(doc, source.ownerField), source.read(user))) {
          throw new Error(`${source.collection} ${doc._id} no está migrado: no se borra nada.`);
        }
      }
    }
    for (const source of SOURCES) {
      if (!existing.has(source.collection)) continue;
      await db.dropCollection(source.collection);
      stats.dropped.push(source.collection);
      log(`dropped ${source.collection}`);
    }
  }

  return stats;
}

module.exports = { migrateEmbedUserSettings };
