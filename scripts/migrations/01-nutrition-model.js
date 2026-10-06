// Fuera el wrapper `diets` (producción, rama main; en PRE ya lo hizo
// migrate-nutrition-model.js de develop):
//
//   1. dietdays.userId       <- el dueño, que hasta ahora solo se sabía
//                               recorriendo diets.dietsDay[] desde
//                               users.dietInUse. De paso, la fecha de cada día
//                               a "YYYY-MM-DD" (había ISO completos).
//   2. users.dietPinnedNote  <- diets.pinnedNote.
//   3. mealproposals         -> alternativas de su comida (las elegidas también:
//                               el cliente puede volver a cambiar de opción).
//   4. dietexceptions        -> dietdays.skipped (las de una sola comida no
//                               tienen dónde ir y se cuentan como descartadas).
//   5. Fuera users.dietInUse.
//
// Con --drop-old (y sin nada pendiente) borra diets, mealproposals y
// dietexceptions. Driver crudo: ningún schema declara ya nada de esto.
// Idempotente: sin `dietInUse` no queda nada que recorrer. Va antes de
// 02-dietday-unique-date (necesita el userId) y de 04-embed-nutrition (las
// alternativas se escriben en la colección `meals`).

const OLD_COLLECTIONS = ["diets", "mealproposals", "dietexceptions"];

const dayKey = (clientId, date) => `${clientId}|${date}`;

// "YYYY-MM-DD" tal cual; ISO completo o Date -> su parte de fecha. Cualquier
// otra cosa, null (mejor dejarlo raro que convertirlo mal).
function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}

async function exists(db, name) {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

// 1 + 2. Devuelve (cliente + fecha) -> _id del día, leído de la relación VIEJA:
// en dry-run no se escribe el userId y los pasos 3 y 4 no lo encontrarían.
async function migrateOwnership(db, { dryRun, log }, stats) {
  const users = db.collection("users");
  const diets = db.collection("diets");
  const dietDays = db.collection("dietdays");
  const dayIndex = new Map();
  const dayOps = [];
  const userOps = [];

  for await (const user of users.find({ dietInUse: { $ne: null } }, { projection: { dietInUse: 1 } })) {
    stats.users += 1;
    const diet = await diets.findOne({ _id: user.dietInUse }, { projection: { dietsDay: 1, pinnedNote: 1 } });
    if (!diet) {
      log(`user ${user._id}: su dietInUse ${user.dietInUse} no existe`);
      continue;
    }
    // Solo los días que existen: dietsDay arrastra referencias a días borrados.
    const days = await dietDays
      .find({ _id: { $in: diet.dietsDay || [] } }, { projection: { date: 1 } })
      .toArray();
    if (days.length) {
      dayOps.push({
        updateMany: { filter: { _id: { $in: days.map((day) => day._id) } }, update: { $set: { userId: user._id } } },
      });
      stats.daysOwned += days.length;
    }
    for (const day of days) {
      const date = normalizeDate(day.date);
      if (date && date !== day.date) {
        dayOps.push({ updateOne: { filter: { _id: day._id }, update: { $set: { date } } } });
        stats.datesNormalized += 1;
      }
      dayIndex.set(dayKey(user._id, date || day.date), day._id);
    }
    if (diet.pinnedNote) {
      userOps.push({ updateOne: { filter: { _id: user._id }, update: { $set: { dietPinnedNote: diet.pinnedNote } } } });
      stats.pinnedNotes += 1;
    }
  }

  if (!dryRun) {
    if (dayOps.length) await dietDays.bulkWrite(dayOps, { ordered: false });
    if (userOps.length) await users.bulkWrite(userOps, { ordered: false });
  }
  return dayIndex;
}

// 3. La comida se resuelve por su nombre dentro del día del cliente.
async function migrateProposals(db, dayIndex, { dryRun }, stats) {
  if (!(await exists(db, "mealproposals"))) return;
  const dietDays = db.collection("dietdays");
  const meals = db.collection("meals");
  const ops = [];
  for await (const proposal of db.collection("mealproposals").find({})) {
    const dayId = dayIndex.get(dayKey(proposal.clientId, proposal.date));
    const day = dayId ? await dietDays.findOne({ _id: dayId }, { projection: { meals: 1 } }) : null;
    const dayMeals = day
      ? await meals.find({ _id: { $in: day.meals || [] } }, { projection: { name: 1 } }).toArray()
      : [];
    const target = dayMeals.find((meal) => meal.name === proposal.mealSlot);
    if (!target) {
      stats.proposalsDropped += 1;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: target._id },
        update: {
          $set: {
            alternatives: (proposal.alternatives || []).map((alternative) => ({
              label: alternative.label,
              customProducts: alternative.customProducts || [],
              customRecipes: alternative.customRecipes || [],
            })),
            alternativesTrainerId: proposal.trainerId || null,
            chosenAlternativeIndex: proposal.chosenIndex ?? null,
          },
        },
      },
    });
    stats.proposalsMoved += 1;
  }
  if (!dryRun && ops.length) await meals.bulkWrite(ops, { ordered: false });
}

// 4. Solo las de día entero tienen equivalente.
async function migrateExceptions(db, dayIndex, { dryRun }, stats) {
  if (!(await exists(db, "dietexceptions"))) return;
  const ops = [];
  for await (const exception of db.collection("dietexceptions").find({})) {
    const dayId = dayIndex.get(dayKey(exception.clientId, exception.date));
    if (!dayId) {
      stats.exceptionsUnmatched += 1;
      continue;
    }
    if (exception.mealSlot) {
      stats.exceptionsMealDiscarded += 1;
      continue;
    }
    ops.push({ updateOne: { filter: { _id: dayId }, update: { $set: { skipped: true } } } });
    stats.skippedDays += 1;
  }
  if (!dryRun && ops.length) await db.collection("dietdays").bulkWrite(ops, { ordered: false });
}

async function migrateNutritionModel(db, { dryRun = false, dropOld = false, log = () => {} } = {}) {
  const stats = {
    users: 0,
    daysOwned: 0,
    datesNormalized: 0,
    pinnedNotes: 0,
    proposalsMoved: 0,
    proposalsDropped: 0,
    skippedDays: 0,
    exceptionsMealDiscarded: 0,
    exceptionsUnmatched: 0,
    dropped: [],
  };
  const dayIndex = (await exists(db, "diets")) ? await migrateOwnership(db, { dryRun, log }, stats) : new Map();
  await migrateProposals(db, dayIndex, { dryRun }, stats);
  await migrateExceptions(db, dayIndex, { dryRun }, stats);

  const users = db.collection("users");
  if (!dryRun) await users.updateMany({ dietInUse: { $exists: true } }, { $unset: { dietInUse: "" } });

  if (dropOld && !dryRun) {
    const pending = await users.countDocuments({ dietInUse: { $exists: true } });
    if (pending) throw new Error(`Quedan ${pending} usuarios con dietInUse: no se borra nada.`);
    for (const name of OLD_COLLECTIONS) {
      if (!(await exists(db, name))) continue;
      await db.dropCollection(name);
      stats.dropped.push(name);
    }
  }
  return stats;
}

module.exports = { migrateNutritionModel, normalizeDate };
