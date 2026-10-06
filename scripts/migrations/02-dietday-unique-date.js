// Funde los DietDay duplicados (mismo userId y misma fecha) y sustituye el
// índice {userId, date} por su versión ÚNICA.
//
// Por qué existe: hasta 2026-10 cada acción que podía "estrenar" un día
// (añadir producto, añadir receta, pegar un día, apuntar una nota) creaba el
// DietDay a ciegas, sin comprobar si la fecha ya tenía día. Resultado: días
// solapados, uno de ellos invisible para el cliente (y, en el caso de las
// recetas, incluso con un userId que no era de nadie porque se pasaba el id
// del wrapper Diet en ese hueco). El código ya no puede volver a hacerlo
// (dietDays/diet-days-dao.js#ensureDietDay es la única vía de creación), pero
// el índice único solo se puede crear si antes no quedan duplicados.
//
//   npm run migrate:dietday-unique:dry-run
//   npm run migrate:dietday-unique
//
// Trabaja con las colecciones en crudo (sin modelos de mongoose) a propósito:
// los hooks de borrado en cascada de DietDay y Meal arrastrarían las comidas
// —y su contenido— justo cuando lo que queremos es moverlo de sitio.

const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-dietday-unique-date]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const INDEX_NAME = "userId_1_date_1";
const INDEX_KEY = { userId: 1, date: 1 };
const INDEX_OPTIONS = {
  name: INDEX_NAME,
  unique: true,
  partialFilterExpression: { userId: { $type: "objectId" } },
};

// Cuánto contenido real tiene un día: es lo que decide qué duplicado se queda
// como ganador (el resto se funde dentro de él).
function countItems(meals) {
  return meals.reduce(
    (total, meal) =>
      total +
      (meal.customProducts || []).length +
      (meal.customRecipes || []).length,
    0,
  );
}

function pickWinner(days) {
  return [...days].sort((a, b) => {
    const byItems = countItems(b.meals) - countItems(a.meals);
    if (byItems) return byItems;

    const byMenu = Number(!!b.day.menuName) - Number(!!a.day.menuName);
    if (byMenu) return byMenu;

    // A igualdad, el más antiguo: es el que llevan referenciando las
    // pantallas que ya tuvieran ese día cargado.
    return String(a.day._id) < String(b.day._id) ? -1 : 1;
  })[0];
}

async function loadDay(mealsCollection, day) {
  const meals = await mealsCollection
    .find({ _id: { $in: day.meals || [] } })
    .toArray();
  // Respetando el orden del array del día (= el orden de los huecos:
  // Desayuno, Almuerzo, ...), no el que devuelva la base.
  const byId = new Map(meals.map((meal) => [String(meal._id), meal]));
  return {
    day,
    meals: (day.meals || []).map((id) => byId.get(String(id))).filter(Boolean),
  };
}

// Mueve el contenido de las comidas del día perdedor al hueco del mismo nombre
// del ganador. Lo que no se puede fundir (dos notas distintas en el mismo
// hueco) se queda con lo del ganador, que es el día con más contenido.
function buildMergeOps(winner, loser) {
  const winnerByName = new Map(winner.meals.map((meal) => [meal.name, meal]));
  const mealUpdates = [];

  for (const loserMeal of loser.meals) {
    const winnerMeal = winnerByName.get(loserMeal.name);
    if (!winnerMeal) continue;

    const set = {};
    const push = {};

    if ((loserMeal.customProducts || []).length) {
      push.customProducts = { $each: loserMeal.customProducts };
    }
    if ((loserMeal.customRecipes || []).length) {
      push.customRecipes = { $each: loserMeal.customRecipes };
    }
    if (!winnerMeal.notes && loserMeal.notes) set.notes = loserMeal.notes;
    if (!winnerMeal.completed && loserMeal.completed) set.completed = true;
    if (!winnerMeal.assignedByTrainerId && loserMeal.assignedByTrainerId) {
      set.assignedByTrainerId = loserMeal.assignedByTrainerId;
    }
    if (!(winnerMeal.alternatives || []).length && (loserMeal.alternatives || []).length) {
      set.alternatives = loserMeal.alternatives;
      set.alternativesTrainerId = loserMeal.alternativesTrainerId || null;
      set.chosenAlternativeIndex = loserMeal.chosenAlternativeIndex ?? null;
    }

    const update = {};
    if (Object.keys(push).length) update.$push = push;
    if (Object.keys(set).length) update.$set = set;
    if (!Object.keys(update).length) continue;

    mealUpdates.push({ updateOne: { filter: { _id: winnerMeal._id }, update } });
  }

  const dayUpdate = {};
  if (!winner.day.notes && loser.day.notes) dayUpdate.notes = loser.day.notes;
  if (!winner.day.menuName && loser.day.menuName) dayUpdate.menuName = loser.day.menuName;
  if (!winner.day.skipped && loser.day.skipped) dayUpdate.skipped = true;

  return { mealUpdates, dayUpdate };
}

async function mergeDuplicates(dietDays, meals) {
  const groups = await dietDays
    .aggregate([
      { $match: { userId: { $type: "objectId" } } },
      { $group: { _id: { userId: "$userId", date: "$date" }, ids: { $push: "$_id" } } },
      { $match: { "ids.1": { $exists: true } } },
    ])
    .toArray();

  log(`grupos duplicados: ${groups.length}`);

  let mergedDays = 0;
  let movedItems = 0;

  for (const group of groups) {
    const docs = await dietDays.find({ _id: { $in: group.ids } }).toArray();
    const loaded = await Promise.all(docs.map((day) => loadDay(meals, day)));
    const winner = pickWinner(loaded);
    const losers = loaded.filter((entry) => entry !== winner);

    for (const loser of losers) {
      const { mealUpdates, dayUpdate } = buildMergeOps(winner, loser);
      const loserMealIds = loser.meals.map((meal) => meal._id);
      movedItems += countItems(loser.meals);

      log(
        `${group._id.userId} ${group._id.date}: funde ${loser.day._id} (${countItems(loser.meals)} items) en ${winner.day._id}`,
      );

      if (DRY_RUN) continue;

      if (mealUpdates.length) await meals.bulkWrite(mealUpdates, { ordered: false });
      if (Object.keys(dayUpdate).length) {
        await dietDays.updateOne({ _id: winner.day._id }, { $set: dayUpdate });
      }
      // Las comidas del perdedor ya no tienen nada propio: lo que contenían
      // cuelga ahora de las del ganador.
      if (loserMealIds.length) await meals.deleteMany({ _id: { $in: loserMealIds } });
      await dietDays.deleteOne({ _id: loser.day._id });
    }

    mergedDays += losers.length;
  }

  return { groups: groups.length, mergedDays, movedItems };
}

async function replaceIndex(dietDays) {
  const existing = await dietDays.indexes();
  const current = existing.find((index) => index.name === INDEX_NAME);

  if (current?.unique) {
    ok("el índice único ya existe");
    return;
  }

  if (current) {
    log(`sustituyendo el índice NO único ${INDEX_NAME}`);
    if (!DRY_RUN) await dietDays.dropIndex(INDEX_NAME);
  }

  if (DRY_RUN) {
    log(`crearía ${INDEX_NAME} único (partial: userId objectId)`);
    return;
  }

  await dietDays.createIndex(INDEX_KEY, INDEX_OPTIONS);
  ok(`${INDEX_NAME} único creado`);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const dietDays = mongoose.connection.collection("dietdays");
  const meals = mongoose.connection.collection("meals");

  const summary = await mergeDuplicates(dietDays, meals);
  await replaceIndex(dietDays);

  ok(
    `grupos=${summary.groups} díasFundidos=${summary.mergedDays} itemsMovidos=${summary.movedItems}${DRY_RUN ? " (dry-run: nada escrito)" : ""}`,
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "ERROR", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
