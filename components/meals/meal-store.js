const mongoose = require("mongoose");
const DietDay = require("../dietDays/diet-days-schema");
const MealSnippet = require("../mealSnippets/meal-snippet-schema");
const { mutateDocument, idOf } = require("../util/embedded-store");

// Dónde vive una comida (2026-10): dentro de su día (DietDay.meals[]) o, si
// es una comida guardada del entrenador, como documento MealSnippet. Los
// alimentos (customProducts) y recetas (customRecipes) van dentro de la
// comida. Este módulo localiza, lee y reescribe comidas y su contenido por
// `_id`, sin que quien llama tenga que saber en cuál de los dos sitios está.

const ITEM_KINDS = new Set(["customProducts", "customRecipes"]);
const SNIPPET_FIELDS = ["name", "notes", "customProducts", "customRecipes"];

const isObjectId = (value) => {
  const id = idOf(value);
  return Boolean(id) && /^[0-9a-fA-F]{24}$/.test(id);
};

function assertKind(kind) {
  if (!ITEM_KINDS.has(kind)) throw new Error(`Tipo de contenido desconocido: ${kind}`);
}

/** { kind: "day", dayId, userId, date } | { kind: "snippet", snippetId, trainerId } | null */
async function locateMeal(mealId) {
  if (!isObjectId(mealId)) return null;
  const day = await DietDay.findOne({ "meals._id": mealId }).select("_id userId date").lean();
  if (day) return { kind: "day", dayId: day._id, userId: day.userId, date: day.date };
  const snippet = await MealSnippet.findById(mealId).select("_id trainerId").lean();
  if (snippet) return { kind: "snippet", snippetId: snippet._id, trainerId: snippet.trainerId };
  return null;
}

/**
 * La comida tal cual la recibe la app (alimentos con su Product, recetas con
 * su Recipe), en plano. null si no existe.
 */
async function readMeal(mealId) {
  const location = await locateMeal(mealId);
  if (!location) return null;
  if (location.kind === "day") {
    const day = await DietDay.findOne({ "meals._id": mealId });
    return day?.meals?.id(mealId)?.toObject() || null;
  }
  const snippet = await MealSnippet.findById(mealId);
  return snippet ? snippet.toObject() : null;
}

/**
 * Cambia UNA comida con compare-and-swap sobre su documento. `change` recibe
 * la comida en plano (sin poblar: `product`/`recipe` son ids) y devuelve la
 * comida nueva, o null para no escribir nada. Devuelve true si la comida
 * existía.
 */
async function mutateMeal(mealId, change) {
  const location = await locateMeal(mealId);
  if (!location) return false;

  if (location.kind === "day") {
    let found = false;
    await mutateDocument(DietDay, { _id: location.dayId, "meals._id": mealId }, async (day) => {
      const index = (day.meals || []).findIndex((meal) => idOf(meal) === idOf(mealId));
      found = index >= 0;
      if (!found) return null;
      const next = await change({ ...day.meals[index] }, { day });
      if (!next) return null;
      const meals = [...day.meals];
      meals[index] = next;
      return { meals };
    });
    return found;
  }

  await mutateDocument(MealSnippet, { _id: location.snippetId }, async (snippet) => {
    const next = await change({ ...snippet }, { snippet });
    if (!next) return null;
    return Object.fromEntries(SNIPPET_FIELDS.filter((field) => field in next).map((field) => [field, next[field]]));
  });
  return true;
}

/**
 * Añade elementos al final de `kind` de la comida en una sola escritura
 * atómica ($push), sin leer antes: añadir alimentos es lo más frecuente y lo
 * que más se hace a la vez (varios toques seguidos en el buscador), y así
 * nunca choca. Devuelve true si la comida existía.
 */
async function pushToMeal(mealId, kind, items) {
  assertKind(kind);
  const location = await locateMeal(mealId);
  if (!location) return false;
  const list = Array.isArray(items) ? items : [items];
  if (location.kind === "day") {
    const result = await DietDay.updateOne(
      { _id: location.dayId, "meals._id": mealId },
      { $push: { [`meals.$.${kind}`]: { $each: list } }, $inc: { __v: 1 } },
      { runValidators: true },
    );
    return result.matchedCount > 0;
  }
  const result = await MealSnippet.updateOne(
    { _id: location.snippetId },
    { $push: { [kind]: { $each: list } }, $inc: { __v: 1 } },
    { runValidators: true },
  );
  return result.matchedCount > 0;
}

/** Id de la comida que contiene ese alimento / esa receta, o null. */
async function findMealIdContaining(itemId, kind) {
  assertKind(kind);
  if (!isObjectId(itemId)) return null;
  const path = `meals.${kind}._id`;
  const day = await DietDay.findOne({ [path]: itemId }).select(`meals._id meals.${kind}._id`).lean();
  if (day) {
    const meal = (day.meals || []).find((candidate) => (candidate[kind] || []).some((item) => idOf(item) === idOf(itemId)));
    return meal?._id || null;
  }
  const snippet = await MealSnippet.findOne({ [`${kind}._id`]: itemId }).select("_id").lean();
  return snippet?._id || null;
}

/** El alimento / la receta en plano y poblado, o null. */
async function readMealItem(itemId, kind) {
  const mealId = await findMealIdContaining(itemId, kind);
  if (!mealId) return null;
  const meal = await readMeal(mealId);
  return (meal?.[kind] || []).find((item) => idOf(item) === idOf(itemId)) || null;
}

/**
 * Cambia UN alimento / UNA receta de su comida. `change` recibe el elemento
 * en plano y devuelve el nuevo (o null para quitarlo de la comida, o
 * undefined para no escribir). Devuelve true si existía.
 */
async function mutateMealItem(itemId, kind, change) {
  const mealId = await findMealIdContaining(itemId, kind);
  if (!mealId) return false;
  let found = false;
  await mutateMeal(mealId, async (meal) => {
    const items = meal[kind] || [];
    const index = items.findIndex((item) => idOf(item) === idOf(itemId));
    found = index >= 0;
    if (!found) return null;
    const next = await change({ ...items[index] }, meal);
    if (next === undefined) return null;
    const list = [...items];
    if (next === null) list.splice(index, 1);
    else list[index] = next;
    return { ...meal, [kind]: list };
  });
  return found;
}

/** Comida del día de un usuario (comprobación de dueño), poblada, o null. */
async function readOwnedDayMeal(userId, mealId) {
  if (!isObjectId(mealId)) return null;
  const day = await DietDay.findOne({ userId, "meals._id": mealId });
  return day?.meals?.id(mealId) || null;
}

const newId = () => new mongoose.Types.ObjectId();

module.exports = {
  locateMeal,
  readMeal,
  mutateMeal,
  pushToMeal,
  findMealIdContaining,
  readMealItem,
  mutateMealItem,
  readOwnedDayMeal,
  isObjectId,
  newId,
};
