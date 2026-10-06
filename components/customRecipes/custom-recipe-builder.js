const mongoose = require("mongoose");
const recipeMerge = require("../recipes/recipe-merge");
const { RECIPE_OVERRIDE_FIELDS } = require("../util/nutrient-fields");
const { patchCustomProduct } = require("../customProducts/custom-product-patch");
const { idOf } = require("../util/embedded-store");

// Construye una receta puesta en un plato (CustomRecipe EMBEBIDA, 2026-10) a
// partir de lo que manda el cliente o el profesional, nueva o sobre una ya
// guardada. Solo guarda lo que difiere de la Recipe:
//
//   addedCustomProducts         ingredientes añadidos (con su Product)
//   modifiedBaseCustomProducts  ingredientes de la Recipe cambiados: cada uno
//                               apunta al original por baseCustomProductId y
//                               guarda solo los valores que difieren
//   removedBaseCustomProductIds ingredientes de la Recipe quitados
//
// Antes esto creaba y borraba documentos de la colección customproducts; el
// resultado (qué se guarda y cómo se casa con lo anterior) es el mismo.

const OVERRIDE_FIELDS = RECIPE_OVERRIDE_FIELDS.filter((field) => field !== "quantity");

const newId = () => new mongoose.Types.ObjectId();

function normalizeRefList(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const id = recipeMerge.normalizeObjectId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(new mongoose.Types.ObjectId(id));
    }
  }
  return result;
}

// Lecturas que hacen falta, una vez por receta construida.
function createLookups() {
  const products = new Map();
  const recipes = new Map();
  return {
    async products(ids) {
      const missing = [...new Set(ids.filter(Boolean).map(String))].filter((id) => !products.has(id));
      if (missing.length) {
        const docs = await mongoose.model("Product").find({ _id: { $in: missing } }).lean();
        missing.forEach((id) => products.set(id, null));
        docs.forEach((doc) => products.set(String(doc._id), doc));
      }
      return products;
    },
    async recipe(id) {
      const key = String(id);
      if (!recipes.has(key)) {
        recipes.set(key, await mongoose.model("Recipe").findById(id).setOptions({ autopopulate: false }).lean());
      }
      return recipes.get(key);
    },
  };
}

async function syncItems({ recipeId, current = [], next = [], kind, lookups }) {
  const currentById = new Map(current.map((item) => [idOf(item), item]));
  const currentByBaseId = new Map(
    current.filter((item) => item.baseCustomProductId).map((item) => [idOf(item.baseCustomProductId), item]),
  );
  const products = await lookups.products(current.map((item) => item.product));

  const result = [];
  for (const raw of next || []) {
    const payload = recipeMerge.sanitizeCustomProductData(raw, {
      includeBaseCustomProductId: kind === "modified",
      includeId: true,
      includeProduct: true,
    });

    if (kind === "added") {
      if (!payload.product) throw new Error("addedCustomProducts.product is required");
      delete payload.baseCustomProductId;
    } else {
      const baseId = recipeMerge.normalizeObjectId(payload.baseCustomProductId || raw?.baseCustomProductId);
      if (!baseId) throw new Error("modifiedBaseCustomProducts.baseCustomProductId is required");
      payload.baseCustomProductId = baseId;
      if (!payload.product) {
        const recipe = await lookups.recipe(recipeId);
        const base = (recipe?.customProducts || []).find((ingredient) => idOf(ingredient) === baseId);
        const product = recipeMerge.normalizeObjectId(base?.product);
        if (!product) throw new Error(`Base CustomProduct has no product: ${baseId}`);
        payload.product = product;
      }
    }

    const requestedId = idOf(payload._id);
    let existing = requestedId ? currentById.get(requestedId) : null;
    if (!existing && kind === "modified") existing = currentByBaseId.get(idOf(payload.baseCustomProductId));
    delete payload._id;
    delete payload.customRecipeId;
    delete payload.mealId;

    if (existing) {
      result.push(
        patchCustomProduct(existing, payload, {
          overrideFields: OVERRIDE_FIELDS,
          baseProduct: products.get(idOf(existing.product)),
          blankUnsets: false,
        }),
      );
      continue;
    }
    result.push({ ...payload, _id: newId() });
  }
  return result;
}

/**
 * Receta embebida nueva (`current` null) o actualizada (`current` = la
 * guardada, en plano). Lanza Error con mensaje si el payload no es válido
 * (recipe-merge.js#validateCustomRecipe).
 */
async function buildCustomRecipe(payload, { current = null } = {}) {
  const lookups = createLookups();
  const isUpdate = Boolean(current);
  const customRecipeId = isUpdate ? current._id : recipeMerge.normalizeObjectId(payload?._id) || newId();
  const recipeId = isUpdate ? current.recipe : recipeMerge.normalizeObjectId(payload?.recipe);

  const pick = (field) => (isUpdate && payload?.[field] === undefined ? current[field] : payload?.[field]);
  const quantity = recipeMerge.normalizePositiveNumber(pick("quantity"));
  const quantityCooked = recipeMerge.normalizePositiveNumber(pick("quantityCooked"));

  recipeMerge.validateCustomRecipe({
    ...(current || {}),
    ...(payload || {}),
    recipe: recipeId,
    quantity,
    quantityCooked,
    addedCustomProducts: payload?.addedCustomProducts ?? current?.addedCustomProducts ?? [],
    modifiedBaseCustomProducts: payload?.modifiedBaseCustomProducts ?? current?.modifiedBaseCustomProducts ?? [],
  });

  const sync = (kind, field) =>
    isUpdate && payload?.[field] === undefined
      ? current[field] || []
      : syncItems({
          recipeId,
          current: (isUpdate && current[field]) || [],
          next: payload?.[field] || [],
          kind,
          lookups,
        });

  const now = new Date();
  return {
    ...(current || {}),
    _id: new mongoose.Types.ObjectId(String(customRecipeId)),
    recipe: new mongoose.Types.ObjectId(String(recipeId)),
    quantity,
    quantityCooked,
    addedCustomProducts: await sync("added", "addedCustomProducts"),
    modifiedBaseCustomProducts: await sync("modified", "modifiedBaseCustomProducts"),
    removedBaseCustomProductIds:
      isUpdate && payload?.removedBaseCustomProductIds === undefined
        ? normalizeRefList(current.removedBaseCustomProductIds)
        : normalizeRefList(payload?.removedBaseCustomProductIds),
    ...(isUpdate
      ? {}
      : {
          assignedByTrainerId: payload?.assignedByTrainerId || null,
          // La cantidad pautada viaja con la marca de pautado (antes se perdía
          // al crear la receta y la del profesional no tenía referencia).
          assignedQuantity: payload?.assignedByTrainerId ? payload?.assignedQuantity ?? quantity ?? null : null,
          consumed: false,
          createdAt: now,
        }),
    updatedAt: now,
  };
}

module.exports = { buildCustomRecipe, normalizeRefList, OVERRIDE_FIELDS };
