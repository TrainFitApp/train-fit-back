// Nutrición embebida (2026-10, docs/analisis-modelo-datos.md P1).
//
// Antes:  dietdays.meals[] -> meals -> customproducts / customrecipes
//         (las recetas a su vez -> customproducts en addedCustomProducts /
//         modifiedBaseCustomProducts), recipes.customProducts[] ->
//         customproducts, diettemplates.menus[].meals[].alternatives[] ->
//         customproducts / customrecipes, y las comidas guardadas del
//         entrenador como `meals` con trainerId.
// Ahora:  todo EMBEBIDO en su documento (día, receta, plantilla) y las
//         comidas guardadas en su propia colección `mealsnippets`.
//
// Se conservan TODOS los _id (comidas, alimentos, recetas puestas en platos,
// ingredientes): las apps siguen mandando los mismos ids a las mismas rutas.
//
// Idempotente (lo ya embebido se salta). Las referencias colgantes se
// descartan, que es lo que ya hacía el populate que veían las apps. Trabaja
// con las colecciones en crudo, sin modelos. Las colecciones antiguas solo se
// borran con --drop-old.


const isRef = (value) =>
  value != null && typeof value === "object" && String(value._bsontype).toLowerCase() === "objectid";
const key = (value) => String(value?._id ?? value);

async function fetchByIds(collection, ids) {
  const wanted = (ids || []).filter(isRef);
  if (!wanted.length) return new Map();
  const docs = await collection.find({ _id: { $in: wanted } }).toArray();
  return new Map(docs.map((doc) => [key(doc), doc]));
}

// Fuera la versión y las referencias inversas que ya no existen (un alimento
// o una receta van DENTRO de su comida o receta).
function stripVersion(doc) {
  const { __v, mealId, customRecipeId, ...rest } = doc;
  return rest;
}

const refOf = (value) => (value && typeof value === "object" && !isRef(value) ? value._id ?? null : value);

// Las alternativas de una comida del diario eran un "clipboard" sin tipo
// (productos y recetas poblados): pasan a la forma de MealAlternativeSchema.
function normalizeAlternative(alternative) {
  const item = (entry) => {
    const { __v, mealId, customRecipeId, ...rest } = entry || {};
    if (rest.product !== undefined) rest.product = refOf(rest.product);
    if (rest.recipe !== undefined) rest.recipe = refOf(rest.recipe);
    for (const field of ["addedCustomProducts", "modifiedBaseCustomProducts"]) {
      if (Array.isArray(rest[field])) rest[field] = rest[field].map(item);
    }
    if (rest.baseCustomProductId !== undefined) rest.baseCustomProductId = refOf(rest.baseCustomProductId);
    return rest;
  };
  return {
    label: alternative?.label || "",
    customProducts: (alternative?.customProducts || []).map(item),
    customRecipes: (alternative?.customRecipes || []).map(item),
  };
}

// `Meal.completed` ("comida entera hecha") desaparece: lo que contaba como
// hecho pasa a sus alimentos y recetas pautados (`consumed`).
function withoutMealCompleted(meal) {
  const { completed, ...rest } = meal;
  if (!completed) return rest;
  const mark = (entry) => (entry?.assignedByTrainerId ? { ...entry, consumed: true } : entry);
  return {
    ...rest,
    customProducts: (rest.customProducts || []).map(mark),
    customRecipes: (rest.customRecipes || []).map(mark),
  };
}

function createEmbedder(db, stats) {
  const customProducts = db.collection("customproducts");
  const customRecipes = db.collection("customrecipes");
  const used = { customProducts: new Set(), customRecipes: new Set() };

  async function embedProducts(refs) {
    if (!Array.isArray(refs) || !refs.some(isRef)) return refs || [];
    const byId = await fetchByIds(customProducts, refs);
    const result = [];
    for (const ref of refs) {
      if (!isRef(ref)) {
        result.push(ref);
        continue;
      }
      const doc = byId.get(key(ref));
      if (!doc) {
        stats.danglingProducts += 1;
        continue;
      }
      used.customProducts.add(key(doc));
      stats.customProducts += 1;
      result.push(stripVersion(doc));
    }
    return result;
  }

  async function embedRecipes(refs) {
    if (!Array.isArray(refs) || !refs.some(isRef)) return refs || [];
    const byId = await fetchByIds(customRecipes, refs);
    const result = [];
    for (const ref of refs) {
      if (!isRef(ref)) {
        result.push(ref);
        continue;
      }
      const doc = byId.get(key(ref));
      if (!doc) {
        stats.danglingRecipes += 1;
        continue;
      }
      used.customRecipes.add(key(doc));
      stats.customRecipes += 1;
      const recipe = stripVersion(doc);
      recipe.addedCustomProducts = await embedProducts(recipe.addedCustomProducts);
      recipe.modifiedBaseCustomProducts = await embedProducts(recipe.modifiedBaseCustomProducts);
      result.push(recipe);
    }
    return result;
  }

  async function embedMealContent(meal) {
    return {
      ...meal,
      customProducts: await embedProducts(meal.customProducts),
      customRecipes: await embedRecipes(meal.customRecipes),
    };
  }

  return { embedProducts, embedRecipes, embedMealContent, used };
}

async function migrateEmbedNutrition(db, { dryRun = false, dropOld = false, log = () => {} } = {}) {
  const stats = {
    dietDays: 0,
    meals: 0,
    snippets: 0,
    recipes: 0,
    dietTemplates: 0,
    customProducts: 0,
    customRecipes: 0,
    danglingMeals: 0,
    danglingProducts: 0,
    danglingRecipes: 0,
    orphanMeals: 0,
    orphanCustomProducts: 0,
    orphanCustomRecipes: 0,
    dropped: [],
  };
  const dietDays = db.collection("dietdays");
  const meals = db.collection("meals");
  const snippets = db.collection("mealsnippets");
  const recipes = db.collection("recipes");
  const templates = db.collection("diettemplates");
  const embedder = createEmbedder(db, stats);
  const usedMeals = new Set();

  // 1) Días: comidas (y su contenido) dentro.
  for await (const day of dietDays.find({ "meals.0": { $type: "objectId" } })) {
    const mealsById = await fetchByIds(meals, day.meals);
    const embedded = [];
    for (const ref of day.meals) {
      const meal = mealsById.get(key(ref));
      if (!meal) {
        stats.danglingMeals += 1;
        continue;
      }
      usedMeals.add(key(meal));
      const { __v, trainerId, ...rest } = meal;
      const content = await embedder.embedMealContent(rest);
      content.alternatives = (content.alternatives || []).map(normalizeAlternative);
      embedded.push(withoutMealCompleted(content));
    }
    stats.dietDays += 1;
    stats.meals += embedded.length;
    if (!dryRun) await dietDays.updateOne({ _id: day._id }, { $set: { meals: embedded }, $inc: { __v: 1 } });
  }

  // 2) Comidas guardadas del entrenador: de `meals` (con trainerId) a `mealsnippets`.
  for await (const meal of meals.find({ trainerId: { $ne: null } })) {
    usedMeals.add(key(meal));
    if (await snippets.findOne({ _id: meal._id }, { projection: { _id: 1 } })) continue;
    const content = await embedder.embedMealContent(meal);
    stats.snippets += 1;
    if (!dryRun) {
      await snippets.insertOne({
        _id: meal._id,
        trainerId: meal.trainerId,
        name: meal.name,
        notes: meal.notes,
        customProducts: content.customProducts,
        customRecipes: content.customRecipes,
        createdAt: meal.createdAt || new Date(),
        __v: 0,
      });
    }
  }

  // 3) Recetas: ingredientes dentro.
  for await (const recipe of recipes.find({ "customProducts.0": { $type: "objectId" } })) {
    const customProducts = await embedder.embedProducts(recipe.customProducts);
    stats.recipes += 1;
    if (!dryRun) await recipes.updateOne({ _id: recipe._id }, { $set: { customProducts }, $inc: { __v: 1 } });
  }

  // 4) Plantillas y fases de dieta: contenido de cada alternativa dentro.
  for await (const template of templates.find({
    $or: [
      { "menus.meals.alternatives.customProducts": { $type: "objectId" } },
      { "menus.meals.alternatives.customRecipes": { $type: "objectId" } },
    ],
  })) {
    const menus = [];
    for (const menu of template.menus || []) {
      const menuMeals = [];
      for (const meal of menu.meals || []) {
        const alternatives = [];
        for (const alternative of meal.alternatives || []) {
          alternatives.push(await embedder.embedMealContent(alternative));
        }
        menuMeals.push({ ...meal, alternatives });
      }
      menus.push({ ...menu, meals: menuMeals });
    }
    stats.dietTemplates += 1;
    if (!dryRun) await templates.updateOne({ _id: template._id }, { $set: { menus }, $inc: { __v: 1 } });
  }

  // 5) Lo que no colgaba de nada no se migra: se cuenta para el informe
  //    (solo en la pasada que migra; después ya no se marca como usado).
  if (stats.dietDays || stats.snippets || stats.recipes || stats.dietTemplates) {
    const count = async (collection, usedSet) => {
      let orphans = 0;
      for await (const doc of collection.find({}, { projection: { _id: 1 } })) if (!usedSet.has(key(doc))) orphans += 1;
      return orphans;
    };
    stats.orphanMeals = await count(meals, usedMeals);
    stats.orphanCustomProducts = await count(db.collection("customproducts"), embedder.used.customProducts);
    stats.orphanCustomRecipes = await count(db.collection("customrecipes"), embedder.used.customRecipes);
  }

  // 6) Colecciones antiguas: solo con --drop-old y si no queda nada pendiente.
  if (dropOld && !dryRun) {
    const pending = [
      await dietDays.countDocuments({ "meals.0": { $type: "objectId" } }),
      await recipes.countDocuments({ "customProducts.0": { $type: "objectId" } }),
      await templates.countDocuments({ "menus.meals.alternatives.customProducts": { $type: "objectId" } }),
      await templates.countDocuments({ "menus.meals.alternatives.customRecipes": { $type: "objectId" } }),
    ].reduce((a, b) => a + b, 0);
    if (pending) throw new Error(`Quedan ${pending} documentos sin migrar: no se borra nada.`);
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ["meals", "customproducts", "customrecipes"]) {
      if (existing.has(name)) {
        await db.dropCollection(name);
        stats.dropped.push(name);
        log(`dropped ${name}`);
      }
    }
  }

  return stats;
}

module.exports = { migrateEmbedNutrition };
