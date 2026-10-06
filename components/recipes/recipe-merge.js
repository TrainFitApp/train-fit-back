const mongoose = require("mongoose");
const { RECIPE_OVERRIDE_FIELDS } = require("../util/nutrient-fields");

// Saneado de lo que llega para una receta puesta en un plato (CustomRecipe) y
// para los ingredientes de una receta. La fusión receta + ajustes y sus macros
// viven en dietDays/diet-days-nutrition-util.js (una sola copia en el back).

const hasOwn = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
const copyArray = (value) => (Array.isArray(value) ? [...value] : value);

function normalizePositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeObjectId(value) {
  if (!value) return null;
  const rawValue = value?._id || value;
  const normalizedValue = typeof rawValue === "string" ? rawValue : rawValue?.toString?.();
  if (!normalizedValue || !mongoose.Types.ObjectId.isValid(normalizedValue)) return null;
  return normalizedValue;
}

function validateCustomRecipe(customRecipe) {
  if (!customRecipe.recipe) {
    throw new Error("customRecipe.recipe is required");
  }

  const quantity = normalizePositiveNumber(customRecipe.quantity);
  if (customRecipe.quantity !== undefined && customRecipe.quantity !== null && !quantity) {
    throw new Error("customRecipe.quantity must be a positive number");
  }

  const quantityCooked = normalizePositiveNumber(customRecipe.quantityCooked);
  if (customRecipe.quantityCooked !== undefined && customRecipe.quantityCooked !== null && !quantityCooked) {
    throw new Error("customRecipe.quantityCooked must be a positive number");
  }

  for (const field of ["modifiedBaseCustomProducts", "removedBaseCustomProductIds", "addedCustomProducts"]) {
    if (customRecipe[field] && !Array.isArray(customRecipe[field])) {
      throw new Error(`${field} must be an array`);
    }
  }
}

// Solo los campos pisables (util/nutrient-fields.js) más, según `options`,
// `_id`, `baseCustomProductId` y `product`. Los vacíos no se copian.
function sanitizeCustomProductData(customProduct, options = {}) {
  const { includeBaseCustomProductId = false, includeProduct = true, includeId = false } = options;
  const nextValue = {};

  if (includeId && customProduct?._id) {
    const id = normalizeObjectId(customProduct._id);
    if (id) nextValue._id = id;
  }

  if (includeBaseCustomProductId && customProduct?.baseCustomProductId) {
    const baseId = normalizeObjectId(customProduct.baseCustomProductId);
    if (baseId) nextValue.baseCustomProductId = baseId;
  }

  if (includeProduct) {
    const productId = normalizeObjectId(customProduct?.product);
    if (productId) nextValue.product = productId;
  }

  for (const field of RECIPE_OVERRIDE_FIELDS) {
    if (!hasOwn(customProduct, field)) continue;
    const rawValue = customProduct[field];
    const value = field === "quantity" ? normalizePositiveNumber(rawValue) : copyArray(rawValue);
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    nextValue[field] = value;
  }

  return nextValue;
}

module.exports = {
  normalizePositiveNumber,
  normalizeObjectId,
  validateCustomRecipe,
  sanitizeCustomProductData,
};
