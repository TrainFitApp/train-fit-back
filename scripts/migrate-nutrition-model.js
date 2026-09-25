const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Refactor nutrición (2026-09) — deja el modelo de dieta en 5 colecciones:
// dietdays, meals, customproducts, customrecipes, diettemplates.
//
//   1. dietdays.userId       <- el dueño, que hasta ahora solo se sabía
//                               recorriendo diets.dietsDay[]
//   2. users.dietPinnedNote  <- diets.pinnedNote (único campo con contenido
//                               real del wrapper; `name` valía siempre "Diet")
//   3. meals.pendingAlternatives <- colección mealproposals (las no elegidas)
//   4. dietdays.skipped <- colección dietexceptions
//   5. Borra diets, mealproposals y dietexceptions, y quita users.dietInUse
//
// Se ejecuta con el driver crudo (no con los modelos de Mongoose) a
// propósito: los esquemas nuevos ya NO declaran diets/dietInUse, así que un
// find() por modelo devolvería esos campos vacíos.
//
// Uso:
//   node scripts/migrate-nutrition-model.js --dry-run   (no escribe nada)
//   node scripts/migrate-nutrition-model.js             (aplica)
//   node scripts/migrate-nutrition-model.js --keep-old  (aplica sin borrar
//                                                        las 3 colecciones)

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");
const KEEP_OLD = hasFlag("--keep-old");

const LOG_PREFIX = "[migrate-nutrition-model]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);
const warn = (...args) => console.warn(LOG_PREFIX, "WARN", ...args);

const stats = {
  usersScanned: 0,
  dietDaysOwned: 0,
  dietDaysDateNormalized: 0,
  dietDaysUnreachable: 0,
  dietsOrphan: 0,
  pinnedNotesMoved: 0,
  proposalsMoved: 0,
  proposalsDropped: 0,
  exceptionsSkipDays: 0,
  exceptionsMealDiscarded: 0,
  exceptionsUnmatched: 0,
};

// (clientId + fecha) -> _id del DietDay. Se llena en el paso 1 leyendo la
// relación VIEJA (diets.dietsDay) y lo consumen los pasos 3 y 4, que si no
// tendrían que consultar por el userId que el paso 1 acaba de escribir — y
// en --dry-run no se escribe nada, así que darían todo por no encontrado.
const dayIndex = new Map();
const dayKey = (clientId, date) => `${clientId}|${date}`;

// "YYYY-MM-DD" tal cual; ISO completo -> su parte de fecha; Date -> idem.
// Cualquier otra cosa devuelve null (no se toca: mejor dejarlo raro que
// convertirlo mal).
function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// 1 + 2. diets -> dietdays.userId  y  diets.pinnedNote -> users.dietPinnedNote
// ---------------------------------------------------------------------------
async function migrateDietOwnership(db) {
  const users = db.collection("users");
  const diets = db.collection("diets");
  const dietdays = db.collection("dietdays");

  const cursor = users.find(
    { dietInUse: { $exists: true, $ne: null } },
    { projection: { _id: 1, dietInUse: 1 } }
  );

  const dietDayOps = [];
  const userOps = [];

  while (await cursor.hasNext()) {
    const user = await cursor.next();
    stats.usersScanned += 1;

    const diet = await diets.findOne(
      { _id: user.dietInUse },
      { projection: { dietsDay: 1, pinnedNote: 1 } }
    );
    if (!diet) {
      warn(`user ${user._id}: dietInUse ${user.dietInUse} no existe, se ignora`);
      continue;
    }

    const dayIds = diet.dietsDay || [];
    if (dayIds.length) {
      // Solo los días que EXISTEN de verdad: diets.dietsDay arrastra
      // referencias colgadas a días ya borrados (en pre hay 1740 refs para
      // 722 días reales), y contarlas como migradas falsearía el informe.
      const realDays = await dietdays
        .find({ _id: { $in: dayIds } }, { projection: { _id: 1, date: 1 } })
        .toArray();

      if (realDays.length) {
        dietDayOps.push({
          updateMany: {
            filter: { _id: { $in: realDays.map((day) => day._id) } },
            update: { $set: { userId: user._id } },
          },
        });
        stats.dietDaysOwned += realDays.length;

        realDays.forEach((day) => {
          // Sin userId, buscar el día era comparar fechas en JavaScript
          // (datesAreOnSameDay), que toleraba cualquier formato. La consulta
          // nueva es un findOne indexado por (userId, date) exacto, así que
          // un día guardado como ISO completo ("2026-08-21T09:59:48.003Z")
          // dejaría de encontrarse y la app crearía un duplicado. En pre hay
          // 2 días vivos así.
          const normalized = normalizeDate(day.date);
          if (normalized && normalized !== day.date) {
            dietDayOps.push({
              updateOne: {
                filter: { _id: day._id },
                update: { $set: { date: normalized } },
              },
            });
            stats.dietDaysDateNormalized += 1;
          }
          dayIndex.set(dayKey(user._id, normalized || day.date), day._id);
        });
      }
    }

    if (diet.pinnedNote) {
      userOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { dietPinnedNote: diet.pinnedNote } },
        },
      });
      stats.pinnedNotesMoved += 1;
    }
  }

  if (!DRY_RUN) {
    if (dietDayOps.length) await dietdays.bulkWrite(dietDayOps, { ordered: false });
    if (userOps.length) await users.bulkWrite(userOps, { ordered: false });
  }

  // Días que no cuelgan de NINGÚN usuario vivo: ya son inalcanzables hoy
  // (ningún user.dietInUse llega a ellos), solo que hasta ahora nadie lo
  // veía. No se tocan — borrar datos es irreversible y esto es un recuento,
  // no una limpieza. Se informan para que la decisión sea consciente.
  const totalDays = await dietdays.countDocuments();
  stats.dietDaysUnreachable = totalDays - stats.dietDaysOwned;

  // Wrappers Diet a los que no apunta ningún usuario: puro residuo.
  const liveDietIds = await users.distinct("dietInUse", {
    dietInUse: { $exists: true, $ne: null },
  });
  stats.dietsOrphan = await diets.countDocuments({ _id: { $nin: liveDietIds } });
}

// ---------------------------------------------------------------------------
// 3. mealproposals -> meals.pendingAlternatives
// ---------------------------------------------------------------------------
async function migrateMealProposals(db) {
  const proposals = db.collection("mealproposals");
  const dietdays = db.collection("dietdays");
  const meals = db.collection("meals");

  // TODAS, no solo las pendientes: el selector del cliente es persistente
  // (puede volver a cambiar de opción cuando quiera), así que una propuesta
  // ya elegida sigue siendo necesaria — se conserva con su chosenIndex.
  const cursor = proposals.find({});
  const mealOps = [];

  while (await cursor.hasNext()) {
    const proposal = await cursor.next();

    const dayId = dayIndex.get(dayKey(proposal.clientId, proposal.date));
    const day = dayId
      ? await dietdays.findOne({ _id: dayId }, { projection: { meals: 1 } })
      : null;
    if (!day) {
      stats.proposalsDropped += 1;
      continue;
    }

    // El slot se resuelve por NOMBRE de la comida, que es como ya lo hacía
    // meal-proposal-client-controller al elegir.
    const dayMeals = await meals
      .find({ _id: { $in: day.meals || [] } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    const target = dayMeals.find((meal) => meal.name === proposal.mealSlot);
    if (!target) {
      stats.proposalsDropped += 1;
      continue;
    }

    mealOps.push({
      updateOne: {
        filter: { _id: target._id },
        update: {
          $set: {
            alternatives: (proposal.alternatives || []).map((alt) => ({
              label: alt.label,
              customProducts: alt.customProducts || [],
              customRecipes: alt.customRecipes || [],
            })),
            alternativesTrainerId: proposal.trainerId || null,
            chosenAlternativeIndex: proposal.chosenIndex ?? null,
          },
        },
      },
    });
    stats.proposalsMoved += 1;
  }

  if (!DRY_RUN && mealOps.length) await meals.bulkWrite(mealOps, { ordered: false });
}

// ---------------------------------------------------------------------------
// 4. dietexceptions -> dietdays.skipped
// ---------------------------------------------------------------------------
async function migrateDietExceptions(db) {
  const exceptions = db.collection("dietexceptions");
  const dietdays = db.collection("dietdays");

  const cursor = exceptions.find({});
  const dayOps = [];

  while (await cursor.hasNext()) {
    const exception = await cursor.next();

    const dayId = dayIndex.get(dayKey(exception.clientId, exception.date));
    const day = dayId
      ? await dietdays.findOne({ _id: dayId }, { projection: { _id: 1, meals: 1 } })
      : null;
    if (!day) {
      stats.exceptionsUnmatched += 1;
      continue;
    }

    // Una excepción de día entero (mealSlot null) se conserva como
    // `skipped`. Las de UNA comida no tienen dónde ir: el modelo ya no
    // distingue "esta comida se cambió" (ese concepto se retiró en 2026-09
    // — nadie lo escribía y su contenido nunca se guardaba aparte), y el
    // cambio en sí ya está aplicado sobre la comida real. Se cuentan como
    // descartadas para que la migración lo diga en voz alta.
    if (exception.mealSlot) {
      stats.exceptionsMealDiscarded += 1;
      continue;
    }

    dayOps.push({
      updateOne: { filter: { _id: day._id }, update: { $set: { skipped: true } } },
    });
    stats.exceptionsSkipDays += 1;
  }

  if (!DRY_RUN && dayOps.length) {
    await dietdays.bulkWrite(dayOps, { ordered: false });
  }
}

// ---------------------------------------------------------------------------
// 5. Limpieza: quitar users.dietInUse y tirar las 3 colecciones absorbidas
// ---------------------------------------------------------------------------
async function dropLegacy(db) {
  const users = db.collection("users");
  const res = await users.updateMany(
    { dietInUse: { $exists: true } },
    { $unset: { dietInUse: "" } }
  );
  ok(`users.dietInUse eliminado de ${res.modifiedCount} documentos`);

  for (const name of ["diets", "mealproposals", "dietexceptions"]) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) {
      log(`colección ${name} ya no existe`);
      continue;
    }
    await db.collection(name).drop();
    ok(`colección ${name} eliminada`);
  }
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN} keepOld=${KEEP_OLD}`);

  await mongoose.connect(mongoUri);
  ok("connected");
  const db = mongoose.connection.db;

  log("paso 1+2: dueño de los días y nota fijada");
  await migrateDietOwnership(db);

  log("paso 3: propuestas de comida pendientes");
  await migrateMealProposals(db);

  log("paso 4: excepciones de dieta");
  await migrateDietExceptions(db);

  if (!DRY_RUN && !KEEP_OLD) {
    log("paso 5: limpieza de lo antiguo");
    await dropLegacy(db);
  } else {
    log("paso 5: OMITIDO (dry-run o --keep-old)");
  }

  console.log("");
  log("RESUMEN");
  Object.entries(stats).forEach(([key, value]) => log(`  ${key}: ${value}`));
  if (DRY_RUN) log("DRY RUN — no se ha escrito nada");

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "FALLO", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
