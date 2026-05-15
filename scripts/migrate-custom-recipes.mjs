/* eslint-disable no-console */
import "dotenv/config";
import { createRequire } from "module";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);
const { buildMongoUri } = require("./_mongo-uri.js");

const args = new Set(process.argv.slice(2));
const shouldCommit = args.has("--commit");
const dryRun = !shouldCommit;
const keepDataRecipes = args.has("--keep-datarecipes");
const sampleLimit = Number(process.env.MIGRATION_SAMPLE_LIMIT || 20);

if (args.has("--help")) {
  console.log(`
Usage:
  npm run migrate:custom-recipes
  npm run migrate:custom-recipes:commit

Options:
  --commit              Executes writes. Without this flag the script is dry-run.
  --keep-datarecipes    Keeps legacy datarecipes collection after migration.

Environment:
  The script loads .env automatically.
  Preferred local variables: MONGODB_HOST, MONGODB_PORT, MONGODB_DB.
  Atlas variables: MONGODB_CLUSTER, MONGODB_DB, MONGODB_USER, MONGODB_PASS.
  Optional override: MONGODB_URI or MONGO_URI.
  MIGRATION_SAMPLE_LIMIT controls error/warning samples. Default: 20.
`);
  process.exit(0);
}

const MONGODB_URI = buildMongoUri();
const ObjectId = mongoose.Types.ObjectId;

const NUTRITION_FIELDS = [
  "energyKcal100g",
  "protein100g",
  "carbohydrates100g",
  "fat100g",
  "saturatedFat100g",
  "sugars100g",
  "fiber100g",
  "salt100g",
  "sodium100g",
  "cholesterol100g",
  "transFat100g",
  "calcium100g",
  "iron100g",
  "magnesium100g",
  "phosphorus100g",
  "potassium100g",
  "zinc100g",
  "copper100g",
  "manganese100g",
  "selenium100g",
  "iodine100g",
  "vitaminA100g",
  "vitaminC100g",
  "vitaminD100g",
  "vitaminE100g",
  "vitaminK100g",
  "vitaminB1100g",
  "vitaminB2100g",
  "vitaminB3100g",
  "vitaminB5100g",
  "vitaminB6100g",
  "vitaminB9100g",
  "vitaminB12100g",
  "biotin100g",
  "omega3100g",
  "omega6100g",
  "omega9100g",
  "alcohol100g",
  "caffeine100g",
  "taurine100g",
];

const TEXT_FIELDS = ["ingredients"];
const ARRAY_FIELDS = ["allergens", "traces"];
const BOOLEAN_FIELDS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

await mongoose.connect(MONGODB_URI);

const db = mongoose.connection.db;
const customRecipes = db.collection("customrecipes");
const customProducts = db.collection("customproducts");
const dataRecipes = db.collection("datarecipes");
const recipes = db.collection("recipes");
const products = db.collection("products");
const meals = db.collection("meals");

const dataRecipeCache = new Map();
const recipeExistsCache = new Map();
const productExistsCache = new Map();
const customRecipeExistsCache = new Map();
const customProductCache = new Map();

const embeddedAddedQuery = {
  addedCustomProducts: { $elemMatch: { product: { $exists: true } } },
};
const embeddedModifiedQuery = {
  $or: [
    {
      modifiedBaseCustomProducts: {
        $elemMatch: { baseCustomProductId: { $exists: true } },
      },
    },
    {
      modifiedBaseCustomProducts: {
        $elemMatch: { customProductId: { $exists: true } },
      },
    },
  ],
};
const customRecipesToMigrateQuery = {
  $or: [
    { dataRecipe: { $exists: true, $ne: null } },
    embeddedAddedQuery,
    ...embeddedModifiedQuery.$or,
  ],
};

function addSample(collection, value) {
  if (collection.length < sampleLimit) {
    collection.push(value);
  }
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function isObjectId(value) {
  return (
    value instanceof ObjectId ||
    value?._bsontype === "ObjectID" ||
    value?._bsontype === "ObjectId"
  );
}

function normalizeObjectId(value) {
  if (!value) return null;
  if (isObjectId(value)) return value;
  if (typeof value === "string" && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  if (value?._id) return normalizeObjectId(value._id);
  return null;
}

function isEmbeddedAddedCustomProduct(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !isObjectId(value) &&
    (hasOwn(value, "product") || hasOwn(value, "productId"))
  );
}

function isEmbeddedModifiedCustomProduct(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !isObjectId(value) &&
    (hasOwn(value, "baseCustomProductId") || hasOwn(value, "customProductId"))
  );
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function copyKnownFields(source, target) {
  for (const field of NUTRITION_FIELDS) {
    const value = toFiniteNumber(source?.[field]);
    if (value !== null) {
      target[field] = value;
    }
  }

  for (const field of TEXT_FIELDS) {
    if (source?.[field] !== undefined && source?.[field] !== null) {
      target[field] = source[field];
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = source?.[field];
    if (Array.isArray(value)) {
      target[field] = value.filter(Boolean).map(String);
    } else if (typeof value === "string" && value.trim()) {
      target[field] = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (typeof source?.[field] === "boolean") {
      target[field] = source[field];
    }
  }

  return target;
}

function uniqueRefs(...lists) {
  const byId = new Map();

  for (const list of lists) {
    for (const value of list || []) {
      const id = normalizeObjectId(value);
      const key = id?.toString?.();
      if (id && key && !byId.has(key)) {
        byId.set(key, id);
      }
    }
  }

  return [...byId.values()];
}

function collectRefsWithInvalidCount(...lists) {
  const byId = new Map();
  let invalidCount = 0;

  for (const list of lists) {
    for (const value of list || []) {
      const id = normalizeObjectId(value);
      const key = id?.toString?.();

      if (!id || !key) {
        invalidCount += 1;
        continue;
      }

      if (!byId.has(key)) {
        byId.set(key, id);
      }
    }
  }

  return {
    refs: [...byId.values()],
    invalidCount,
  };
}

async function collectionExists(name) {
  const found = await db
    .listCollections({ name }, { nameOnly: true })
    .toArray();
  return found.length > 0;
}

async function getDataRecipe(id) {
  const key = id.toString();
  if (dataRecipeCache.has(key)) return dataRecipeCache.get(key);

  const doc = await dataRecipes.findOne({ _id: id });
  dataRecipeCache.set(key, doc);
  return doc;
}

async function recipeExists(id) {
  const key = id.toString();
  if (recipeExistsCache.has(key)) return recipeExistsCache.get(key);

  const exists = !!(await recipes.findOne({ _id: id }, { projection: { _id: 1 } }));
  recipeExistsCache.set(key, exists);
  return exists;
}

async function productExists(id) {
  const key = id.toString();
  if (productExistsCache.has(key)) return productExistsCache.get(key);

  const exists = !!(await products.findOne({ _id: id }, { projection: { _id: 1 } }));
  productExistsCache.set(key, exists);
  return exists;
}

async function customRecipeExists(id) {
  const key = id.toString();
  if (customRecipeExistsCache.has(key)) return customRecipeExistsCache.get(key);

  const exists = !!(await customRecipes.findOne(
    { _id: id },
    { projection: { _id: 1 } },
  ));
  customRecipeExistsCache.set(key, exists);
  return exists;
}

async function getCustomProduct(id) {
  const key = id.toString();
  if (customProductCache.has(key)) return customProductCache.get(key);

  const doc = await customProducts.findOne({ _id: id });
  customProductCache.set(key, doc);
  return doc;
}

async function getBaseProductId(baseCustomProductId) {
  const baseCustomProduct = await getCustomProduct(baseCustomProductId);
  return normalizeObjectId(baseCustomProduct?.product);
}

function getEmbeddedAddedItems(customRecipe) {
  if (customRecipe.dataRecipe) {
    return (
      customRecipe.additionalCustomProducts ||
      customRecipe.addedCustomProducts ||
      []
    ).filter(isEmbeddedAddedCustomProduct);
  }

  return (customRecipe.addedCustomProducts || []).filter(
    isEmbeddedAddedCustomProduct,
  );
}

function getEmbeddedModifiedItems(customRecipe) {
  if (customRecipe.dataRecipe) {
    return (
      customRecipe.customProductsOverrides ||
      customRecipe.modifiedBaseCustomProducts ||
      []
    ).filter((item) => !item?.removed && isEmbeddedModifiedCustomProduct(item));
  }

  return (customRecipe.modifiedBaseCustomProducts || []).filter(
    isEmbeddedModifiedCustomProduct,
  );
}

function getRemovedBaseCustomProductIds(customRecipe) {
  const explicitRemoved = customRecipe.removedBaseCustomProductIds || [];
  const legacyRemoved = (customRecipe.customProductsOverrides || [])
    .filter((override) => override?.removed)
    .map((override) => override.customProductId || override.baseCustomProductId);

  return uniqueRefs(explicitRemoved, legacyRemoved);
}

function getExistingReferenceIds(items, isEmbedded) {
  return (items || [])
    .filter((item) => !isEmbedded(item))
    .map((item) => normalizeObjectId(item))
    .filter(Boolean);
}

async function buildAddedCustomProductDoc(item, customRecipeId, issues) {
  const product = normalizeObjectId(item?.product || item?.productId);
  if (!product) {
    addSample(issues.errors, {
      type: "invalidAddedCustomProduct",
      customRecipeId,
      value: item,
    });
    issues.errorCount += 1;
    return null;
  }

  const next = {
    _id: new ObjectId(),
    customRecipeId,
    quantity: toFiniteNumber(item?.quantity) ?? 0,
    product,
  };

  return copyKnownFields(item, next);
}

async function buildModifiedCustomProductDoc(item, customRecipeId, issues) {
  const baseCustomProductId = normalizeObjectId(
    item?.baseCustomProductId || item?.customProductId,
  );

  if (!baseCustomProductId) {
    addSample(issues.errors, {
      type: "invalidModifiedBaseCustomProduct",
      customRecipeId,
      value: item,
    });
    issues.errorCount += 1;
    return null;
  }

  const product =
    normalizeObjectId(item?.product || item?.productId) ||
    (await getBaseProductId(baseCustomProductId));

  if (!product) {
    addSample(issues.errors, {
      type: "missingModifiedBaseProduct",
      customRecipeId,
      baseCustomProductId,
    });
    issues.errorCount += 1;
    return null;
  }

  const next = {
    _id: new ObjectId(),
    customRecipeId,
    baseCustomProductId,
    quantity: toFiniteNumber(item?.quantity) ?? 0,
    product,
  };

  return copyKnownFields(item, next);
}

async function collectPreflight() {
  const issues = {
    errorCount: 0,
    warningCount: 0,
    errors: [],
    warnings: [],
  };

  const stats = {
    legacyCustomRecipes: await customRecipes.countDocuments({
      dataRecipe: { $exists: true, $ne: null },
    }),
    customRecipesWithEmbeddedAddedCustomProducts:
      await customRecipes.countDocuments(embeddedAddedQuery),
    customRecipesWithEmbeddedModifiedBaseCustomProducts:
      await customRecipes.countDocuments(embeddedModifiedQuery),
    customRecipesToMigrate: await customRecipes.countDocuments(
      customRecipesToMigrateQuery,
    ),
    referenceBasedCustomRecipes: await customRecipes.countDocuments({
      dataRecipe: { $exists: false },
      recipe: { $exists: true, $ne: null },
      $nor: [embeddedAddedQuery, ...embeddedModifiedQuery.$or],
    }),
    customProductsLinkedToCustomRecipes: await customProducts.countDocuments({
      customRecipeId: { $exists: true, $ne: null },
    }),
    dataRecipes: await dataRecipes.countDocuments({}),
    dataRecipesWithQuantity: await dataRecipes.countDocuments({
      quantity: { $exists: true, $ne: null },
    }),
    legacyCustomRecipesMissingQuantity: await customRecipes.countDocuments({
      dataRecipe: { $exists: true, $ne: null },
      $or: [{ quantity: { $exists: false } }, { quantity: null }],
    }),
    mealsWithLegacyField: await meals.countDocuments({
      customRecipeInstances: { $exists: true },
    }),
    mealsWithNewField: await meals.countDocuments({
      customRecipes: { $exists: true },
    }),
  };

  const customRecipeCursor = customRecipes.find(customRecipesToMigrateQuery);

  while (await customRecipeCursor.hasNext()) {
    const customRecipe = await customRecipeCursor.next();
    let recipe = normalizeObjectId(customRecipe.recipe);

    if (customRecipe.dataRecipe) {
      const dataRecipeId = normalizeObjectId(customRecipe.dataRecipe);

      if (!dataRecipeId) {
        addSample(issues.errors, {
          type: "invalidDataRecipeRef",
          customRecipeId: customRecipe._id,
          dataRecipe: customRecipe.dataRecipe,
        });
        issues.errorCount += 1;
        continue;
      }

      const dataRecipe = await getDataRecipe(dataRecipeId);
      if (!dataRecipe) {
        addSample(issues.errors, {
          type: "missingDataRecipe",
          customRecipeId: customRecipe._id,
          dataRecipe: dataRecipeId,
        });
        issues.errorCount += 1;
        continue;
      }

      recipe = normalizeObjectId(dataRecipe.recipe);
    }

    if (!recipe) {
      addSample(issues.errors, {
        type: "invalidRecipeRef",
        customRecipeId: customRecipe._id,
        recipe: customRecipe.recipe,
      });
      issues.errorCount += 1;
    } else if (!(await recipeExists(recipe))) {
      addSample(issues.errors, {
        type: "missingRecipe",
        customRecipeId: customRecipe._id,
        recipe,
      });
      issues.errorCount += 1;
    }

    for (const item of getEmbeddedAddedItems(customRecipe)) {
      const product = normalizeObjectId(item?.product || item?.productId);
      if (!product) {
        addSample(issues.errors, {
          type: "invalidAddedCustomProduct",
          customRecipeId: customRecipe._id,
          value: item,
        });
        issues.errorCount += 1;
      } else if (!(await productExists(product))) {
        addSample(issues.errors, {
          type: "missingAddedProduct",
          customRecipeId: customRecipe._id,
          product,
        });
        issues.errorCount += 1;
      }
    }

    for (const item of getEmbeddedModifiedItems(customRecipe)) {
      const baseCustomProductId = normalizeObjectId(
        item?.baseCustomProductId || item?.customProductId,
      );
      if (!baseCustomProductId) {
        addSample(issues.errors, {
          type: "invalidModifiedBaseCustomProduct",
          customRecipeId: customRecipe._id,
          value: item,
        });
        issues.errorCount += 1;
        continue;
      }

      const baseCustomProduct = await getCustomProduct(baseCustomProductId);
      if (!baseCustomProduct) {
        addSample(issues.errors, {
          type: "missingBaseCustomProduct",
          customRecipeId: customRecipe._id,
          baseCustomProductId,
        });
        issues.errorCount += 1;
        continue;
      }

      const product = normalizeObjectId(baseCustomProduct.product);
      if (!product) {
        addSample(issues.errors, {
          type: "baseCustomProductWithoutProduct",
          customRecipeId: customRecipe._id,
          baseCustomProductId,
        });
        issues.errorCount += 1;
      }
    }
  }

  const mealCursor = meals.find(
    { customRecipeInstances: { $exists: true, $ne: [] } },
    { projection: { customRecipeInstances: 1 } },
  );

  while (await mealCursor.hasNext()) {
    const meal = await mealCursor.next();

    for (const ref of meal.customRecipeInstances || []) {
      const customRecipeId = normalizeObjectId(ref);
      if (!customRecipeId) {
        addSample(issues.warnings, {
          type: "invalidMealCustomRecipeInstanceRef",
          mealId: meal._id,
          value: ref,
        });
        issues.warningCount += 1;
        continue;
      }

      if (!(await customRecipeExists(customRecipeId))) {
        addSample(issues.warnings, {
          type: "missingMealCustomRecipeInstance",
          mealId: meal._id,
          customRecipeId,
        });
        issues.warningCount += 1;
      }
    }
  }

  return { stats, issues };
}

async function buildCustomRecipeMigration(customRecipe, issues) {
  let recipe = normalizeObjectId(customRecipe.recipe);
  let quantity = toFiniteNumber(customRecipe.quantity);
  let quantityCooked = toFiniteNumber(customRecipe.quantityCooked);

  if (customRecipe.dataRecipe) {
    const dataRecipeId = normalizeObjectId(customRecipe.dataRecipe);
    const dataRecipe = dataRecipeId ? await getDataRecipe(dataRecipeId) : null;

    if (!dataRecipe) {
      throw new Error(`DataRecipe not found for customRecipe ${customRecipe._id}`);
    }

    recipe = normalizeObjectId(dataRecipe.recipe);
    quantity = toFiniteNumber(customRecipe.quantity);
    quantityCooked = toFiniteNumber(dataRecipe.quantityCooked);
  }

  if (!recipe) {
    throw new Error(`Recipe ref not found for customRecipe ${customRecipe._id}`);
  }

  const customProductsToInsert = [];
  const embeddedAddedItems = getEmbeddedAddedItems(customRecipe);
  const embeddedModifiedItems = getEmbeddedModifiedItems(customRecipe);

  const addedCustomProducts = getExistingReferenceIds(
    customRecipe.addedCustomProducts,
    isEmbeddedAddedCustomProduct,
  );
  const modifiedBaseCustomProducts = getExistingReferenceIds(
    customRecipe.modifiedBaseCustomProducts,
    isEmbeddedModifiedCustomProduct,
  );

  for (const item of embeddedAddedItems) {
    const doc = await buildAddedCustomProductDoc(item, customRecipe._id, issues);
    if (doc) {
      customProductsToInsert.push(doc);
      addedCustomProducts.push(doc._id);
    }
  }

  for (const item of embeddedModifiedItems) {
    const doc = await buildModifiedCustomProductDoc(
      item,
      customRecipe._id,
      issues,
    );
    if (doc) {
      customProductsToInsert.push(doc);
      modifiedBaseCustomProducts.push(doc._id);
    }
  }

  if (issues.errorCount > 0) {
    return null;
  }

  return {
    customProductsToInsert,
    update: {
      $set: {
        recipe,
        // La racion consumida pertenece a CustomRecipe legacy.
        // dataRecipe.quantity era peso crudo/base y no debe pisar la racion.
        quantity,
        // El peso total cocinado pertenecia a DataRecipe y ahora vive aqui.
        quantityCooked,
        addedCustomProducts,
        modifiedBaseCustomProducts,
        removedBaseCustomProductIds: getRemovedBaseCustomProductIds(customRecipe),
      },
      $unset: {
        dataRecipe: "",
        customProductsOverrides: "",
        additionalCustomProducts: "",
      },
    },
  };
}

async function migrateCustomRecipes() {
  const issues = {
    errorCount: 0,
    warningCount: 0,
    errors: [],
    warnings: [],
  };
  let planned = 0;
  let matched = 0;
  let modified = 0;
  let plannedCustomProducts = 0;
  let insertedCustomProducts = 0;

  const cursor = customRecipes.find(customRecipesToMigrateQuery);

  while (await cursor.hasNext()) {
    const customRecipe = await cursor.next();
    const migration = await buildCustomRecipeMigration(customRecipe, issues);

    if (!migration) {
      continue;
    }

    planned += 1;
    plannedCustomProducts += migration.customProductsToInsert.length;

    if (dryRun) {
      matched += 1;
      continue;
    }

    await customProducts.deleteMany({ customRecipeId: customRecipe._id });

    if (migration.customProductsToInsert.length > 0) {
      const insertResult = await customProducts.insertMany(
        migration.customProductsToInsert,
        { ordered: true },
      );
      insertedCustomProducts += Object.keys(insertResult.insertedIds || {}).length;
    }

    const updateResult = await customRecipes.updateOne(
      { _id: customRecipe._id },
      migration.update,
    );
    matched += updateResult.matchedCount || 0;
    modified += updateResult.modifiedCount || 0;
  }

  if (issues.errorCount > 0) {
    throw new Error(
      `Unexpected transformation errors: ${JSON.stringify(issues.errors, null, 2)}`,
    );
  }

  return {
    planned,
    matched,
    modified,
    plannedCustomProducts,
    insertedCustomProducts,
  };
}

async function migrateMeals() {
  let planned = 0;
  let matched = 0;
  let modified = 0;
  let omittedInvalidCustomRecipeRefs = 0;
  let omittedMissingCustomRecipeRefs = 0;
  const cursor = meals.find({
    customRecipeInstances: { $exists: true },
  });

  while (await cursor.hasNext()) {
    const meal = await cursor.next();
    const candidateCustomRecipeRefs = collectRefsWithInvalidCount(
      meal.customRecipes || [],
      meal.customRecipeInstances || [],
    );
    const customRecipesNext = [];
    omittedInvalidCustomRecipeRefs += candidateCustomRecipeRefs.invalidCount;

    for (const customRecipeId of candidateCustomRecipeRefs.refs) {
      if (!(await customRecipeExists(customRecipeId))) {
        omittedMissingCustomRecipeRefs += 1;
        continue;
      }

      customRecipesNext.push(customRecipeId);
    }

    planned += 1;

    if (dryRun) {
      matched += 1;
      continue;
    }

    const result = await meals.updateOne(
      { _id: meal._id },
      {
        $set: { customRecipes: customRecipesNext },
        $unset: { customRecipeInstances: "" },
      },
    );
    matched += result.matchedCount || 0;
    modified += result.modifiedCount || 0;
  }

  return {
    planned,
    matched,
    modified,
    omittedInvalidCustomRecipeRefs,
    omittedMissingCustomRecipeRefs,
  };
}

async function ensureIndexes() {
  if (dryRun) {
    return {
      customRecipesRecipeIndex: "planned",
      customProductsCustomRecipeIndex: "planned",
      customProductsBaseCustomProductIndex: "planned",
    };
  }

  await customRecipes.createIndex({ recipe: 1 });
  await customProducts.createIndex({ customRecipeId: 1 });
  await customProducts.createIndex({ baseCustomProductId: 1 });

  return {
    customRecipesRecipeIndex: "created-or-existing",
    customProductsCustomRecipeIndex: "created-or-existing",
    customProductsBaseCustomProductIndex: "created-or-existing",
  };
}

async function cleanupDataRecipes() {
  if (keepDataRecipes) {
    return { dropped: false, reason: "--keep-datarecipes" };
  }

  const exists = await collectionExists("datarecipes");
  if (!exists) {
    return { dropped: false, reason: "collection-missing" };
  }

  if (dryRun) {
    return { dropped: false, reason: "dry-run-planned-drop" };
  }

  await dataRecipes.drop();
  return { dropped: true };
}

async function postValidate() {
  const dataRecipesExists = await collectionExists("datarecipes");

  return {
    remainingLegacyCustomRecipes: await customRecipes.countDocuments({
      dataRecipe: { $exists: true, $ne: null },
    }),
    remainingEmbeddedAddedCustomProducts:
      await customRecipes.countDocuments(embeddedAddedQuery),
    remainingEmbeddedModifiedBaseCustomProducts:
      await customRecipes.countDocuments(embeddedModifiedQuery),
    remainingLegacyMeals: await meals.countDocuments({
      customRecipeInstances: { $exists: true },
    }),
    customRecipesWithoutRecipe: await customRecipes.countDocuments({
      $or: [{ recipe: { $exists: false } }, { recipe: null }],
    }),
    customProductsLinkedToCustomRecipes: await customProducts.countDocuments({
      customRecipeId: { $exists: true, $ne: null },
    }),
    dataRecipesExists,
  };
}

function printSection(title, payload) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

try {
  console.log(
    dryRun
      ? "Running custom recipe migration in DRY-RUN mode. Add --commit to write."
      : "Running custom recipe migration in COMMIT mode.",
  );

  const preflight = await collectPreflight();
  printSection("Preflight", preflight);

  if (preflight.issues.errorCount > 0) {
    throw new Error(
      "Preflight failed. Fix the reported errors before running the migration.",
    );
  }

  console.log(
    "\nQuantity rule: customrecipes.quantity wins for consumed quantity; " +
      "datarecipes.quantityCooked wins for cooked total weight. " +
      "datarecipes.quantity is treated as legacy raw/base weight and is not used to overwrite consumed quantity.",
  );

  console.log(
    "Ingredient rule: added/modified recipe ingredients are stored as CustomProduct documents and CustomRecipe keeps only their ids.",
  );

  const customRecipeResult = await migrateCustomRecipes();
  printSection("CustomRecipes migration", customRecipeResult);

  const mealResult = await migrateMeals();
  printSection("Meals migration", mealResult);

  const indexResult = await ensureIndexes();
  printSection("Indexes", indexResult);

  const cleanupResult = await cleanupDataRecipes();
  printSection("Cleanup", cleanupResult);

  const validation = await postValidate();
  printSection("Post validation", validation);

  if (!dryRun) {
    if (validation.remainingLegacyCustomRecipes > 0) {
      throw new Error("Post validation failed: legacy customrecipes remain");
    }

    if (validation.remainingEmbeddedAddedCustomProducts > 0) {
      throw new Error("Post validation failed: embedded added ingredients remain");
    }

    if (validation.remainingEmbeddedModifiedBaseCustomProducts > 0) {
      throw new Error(
        "Post validation failed: embedded modified ingredients remain",
      );
    }

    if (validation.remainingLegacyMeals > 0) {
      throw new Error("Post validation failed: legacy meal fields remain");
    }

    if (!keepDataRecipes && validation.dataRecipesExists) {
      throw new Error("Post validation failed: datarecipes still exists");
    }
  }

  console.log(
    dryRun
      ? "\nDry-run completed. Re-run with --commit to apply writes."
      : "\nCustom recipe migration completed successfully.",
  );
} finally {
  await mongoose.disconnect();
}
