/* eslint-disable no-console */
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGODB_URI) {
  throw new Error("Set MONGODB_URI or MONGO_URI before running this migration");
}

await mongoose.connect(MONGODB_URI);

const db = mongoose.connection.db;

const customRecipes = db.collection("customrecipes");
const dataRecipes = db.collection("datarecipes");
const recipes = db.collection("recipes");

const cursor = customRecipes.find({
  dataRecipe: { $exists: true, $ne: null },
});

while (await cursor.hasNext()) {
  const legacy = await cursor.next();
  if (!legacy) {
    continue;
  }

  const dataRecipe = await dataRecipes.findOne({ _id: legacy.dataRecipe });
  if (!dataRecipe) {
    throw new Error(`DataRecipe no encontrado para customRecipe ${legacy._id}`);
  }

  const recipe = await recipes.findOne({ _id: dataRecipe.recipe });
  if (!recipe) {
    throw new Error(`Recipe no encontrada para dataRecipe ${dataRecipe._id}`);
  }

  const overrides = legacy.customProductsOverrides || [];
  const additional = legacy.additionalCustomProducts || [];

  const removedBaseCustomProductIds = [];
  const modifiedBaseCustomProducts = [];

  for (const override of overrides) {
    if (override.removed === true && override.customProductId) {
      removedBaseCustomProductIds.push(override.customProductId);
      continue;
    }

    if (
      override.customProductId &&
      override.quantity !== null &&
      override.quantity !== undefined
    ) {
      modifiedBaseCustomProducts.push({
        baseCustomProductId: override.customProductId,
        quantity: override.quantity,
      });
    }
  }

  await customRecipes.updateOne(
    { _id: legacy._id },
    {
      $set: {
        recipe: dataRecipe.recipe,
        quantity: legacy.quantity ?? null,
        quantityCooked: dataRecipe.quantityCooked ?? null,
        addedCustomProducts: additional,
        modifiedBaseCustomProducts,
        removedBaseCustomProductIds,
      },
      $unset: {
        dataRecipe: "",
        customProductsOverrides: "",
        additionalCustomProducts: "",
      },
    },
  );
}

await customRecipes.createIndex({ recipe: 1 });
await dataRecipes.drop();

console.log("Custom recipe migration completed successfully.");

await mongoose.disconnect();
