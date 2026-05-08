const mongoose = require("mongoose");
const customRecipeSchema = require("./custom-recipe-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const recipeMergeService = require("../recipes/recipe-merge.service");

const normalizeCustomProductId = (value) => {
  const normalizedValue = value?._id || value;
  return normalizedValue?.toString?.() || null;
};

const hasOwn = (value, key) =>
  !!value && Object.prototype.hasOwnProperty.call(value, key);

const areValuesEqual = (left, right, epsilon = 1e-9) => {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) < epsilon;
  }
  return false;
};

const normalizeRefList = (values = []) => {
  const byId = new Map();

  for (const value of values || []) {
    const id = normalizeCustomProductId(value);
    if (id && !byId.has(id)) {
      byId.set(id, id);
    }
  }

  return [...byId.values()];
};

const buildCustomProductUpdateQuery = (currentCustomProduct, cpData) => {
  const $set = {};
  const $unset = {};
  const overrideFields = recipeMergeService.CUSTOM_PRODUCT_OVERRIDE_FIELDS.filter(
    (field) => field !== "quantity",
  );

  Object.keys(cpData || {}).forEach((key) => {
    if (key === "_id") return;
    if (overrideFields.includes(key)) return;
    $set[key] = cpData[key];
  });

  overrideFields.forEach((field) => {
    if (!hasOwn(cpData, field)) {
      $unset[field] = "";
      return;
    }

    const value = cpData[field];
    const baseValue = currentCustomProduct?.product?.[field];

    if (value === undefined) {
      $unset[field] = "";
      return;
    }

    if (typeof value === "string" && value.trim() === "") {
      $unset[field] = "";
      return;
    }

    if (value === null) {
      $set[field] = null;
      return;
    }

    if (areValuesEqual(value, baseValue)) {
      $unset[field] = "";
      return;
    }

    $set[field] = value;
  });

  const updateQuery = {};
  if (Object.keys($set).length) updateQuery.$set = $set;
  if (Object.keys($unset).length) updateQuery.$unset = $unset;
  return updateQuery;
};

async function getBaseCustomProduct(baseCustomProductId) {
  if (!baseCustomProductId) return null;
  return customProductSchema
    .findById(baseCustomProductId)
    .setOptions({ autopopulate: false });
}

async function buildAddedCustomProductPayload(customProduct, customRecipeId) {
  const payload = recipeMergeService.sanitizeCustomProductData(customProduct, {
    includeId: true,
    includeProduct: true,
  });

  if (!payload.product) {
    throw new Error("addedCustomProducts.product is required");
  }

  payload.customRecipeId = customRecipeId;
  delete payload.baseCustomProductId;
  return payload;
}

async function buildModifiedBaseCustomProductPayload(
  customProduct,
  customRecipeId,
) {
  const payload = recipeMergeService.sanitizeCustomProductData(customProduct, {
    includeBaseCustomProductId: true,
    includeId: true,
    includeProduct: true,
  });

  const baseCustomProductId = normalizeCustomProductId(
    payload.baseCustomProductId || customProduct?.baseCustomProductId,
  );

  if (!baseCustomProductId) {
    throw new Error("modifiedBaseCustomProducts.baseCustomProductId is required");
  }

  payload.baseCustomProductId = baseCustomProductId;
  payload.customRecipeId = customRecipeId;

  if (!payload.product) {
    const baseCustomProduct = await getBaseCustomProduct(baseCustomProductId);
    const product = normalizeCustomProductId(baseCustomProduct?.product);
    if (!product) {
      throw new Error(`Base CustomProduct has no product: ${baseCustomProductId}`);
    }
    payload.product = product;
  }

  return payload;
}

async function syncCustomRecipeCustomProducts({
  customRecipeId,
  currentCustomProducts,
  nextCustomProducts,
  kind,
}) {
  const currentIds = normalizeRefList(currentCustomProducts);
  const currentDocs = currentIds.length
    ? await customProductSchema.find({ _id: { $in: currentIds } })
    : [];
  const currentById = new Map(
    currentDocs.map((customProduct) => [
      customProduct._id.toString(),
      customProduct,
    ]),
  );
  const currentModifiedByBaseId = new Map();

  currentDocs.forEach((customProduct) => {
    const baseId = normalizeCustomProductId(customProduct.baseCustomProductId);
    if (baseId) {
      currentModifiedByBaseId.set(baseId, customProduct);
    }
  });

  const nextIds = [];

  for (const customProduct of nextCustomProducts || []) {
    const payload =
      kind === "modified"
        ? await buildModifiedBaseCustomProductPayload(
            customProduct,
            customRecipeId,
          )
        : await buildAddedCustomProductPayload(customProduct, customRecipeId);

    const requestedId = normalizeCustomProductId(payload._id);
    const baseId = normalizeCustomProductId(payload.baseCustomProductId);
    let existingId =
      requestedId && currentById.has(requestedId) ? requestedId : null;

    if (!existingId && kind === "modified" && baseId) {
      const currentForBase = currentModifiedByBaseId.get(baseId);
      existingId = currentForBase?._id?.toString?.() || null;
    }

    delete payload._id;

    if (existingId) {
      const currentCustomProduct = currentById.get(existingId);
      const updateQuery = buildCustomProductUpdateQuery(
        currentCustomProduct,
        payload,
      );

      if (Object.keys(updateQuery).length > 0) {
        await customProductSchema.findByIdAndUpdate(existingId, updateQuery);
      }

      nextIds.push(existingId);
      continue;
    }

    const createdCustomProduct = await customProductSchema.create(payload);
    nextIds.push(createdCustomProduct._id.toString());
  }

  const nextIdSet = new Set(nextIds);
  const removedIds = currentIds.filter((id) => !nextIdSet.has(id));
  if (removedIds.length > 0) {
    await customProductSchema.deleteMany({ _id: { $in: removedIds } });
  }

  return nextIds;
}

module.exports = {
  async getCustomRecipeById(id) {
    return customRecipeSchema.findById(id);
  },

  async searchCustomRecipe(page, limit, search) {
    const query = search
      ? {
          $or: [
            { "recipe.name": { $regex: search, $options: "i" } },
            { name: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    return customRecipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async createCustomRecipe(customRecipe) {
    const customRecipeId =
      customRecipe._id || new mongoose.Types.ObjectId().toString();
    const baseCustomRecipe = {
      _id: customRecipeId,
      recipe: recipeMergeService.normalizeObjectId(customRecipe.recipe),
      quantity: recipeMergeService.normalizePositiveNumber(customRecipe.quantity),
      quantityCooked: recipeMergeService.normalizePositiveNumber(
        customRecipe.quantityCooked,
      ),
      addedCustomProducts: [],
      modifiedBaseCustomProducts: [],
      removedBaseCustomProductIds: normalizeRefList(
        customRecipe.removedBaseCustomProductIds,
      ),
    };

    recipeMergeService.validateCustomRecipe({
      ...baseCustomRecipe,
      addedCustomProducts: customRecipe.addedCustomProducts || [],
      modifiedBaseCustomProducts: customRecipe.modifiedBaseCustomProducts || [],
    });

    let created = null;

    try {
      created = await customRecipeSchema.create(baseCustomRecipe);

      const addedCustomProducts = await syncCustomRecipeCustomProducts({
        customRecipeId,
        currentCustomProducts: [],
        nextCustomProducts: customRecipe.addedCustomProducts || [],
        kind: "added",
      });
      const modifiedBaseCustomProducts = await syncCustomRecipeCustomProducts({
        customRecipeId,
        currentCustomProducts: [],
        nextCustomProducts: customRecipe.modifiedBaseCustomProducts || [],
        kind: "modified",
      });

      if (addedCustomProducts.length || modifiedBaseCustomProducts.length) {
        created = await customRecipeSchema.findByIdAndUpdate(
          customRecipeId,
          {
            $set: {
              addedCustomProducts,
              modifiedBaseCustomProducts,
            },
          },
          { new: true },
        );
      }

      return customRecipeSchema.findById(created._id);
    } catch (error) {
      if (created) {
        await customRecipeSchema.findByIdAndDelete(customRecipeId);
      } else {
        await customProductSchema.deleteMany({ customRecipeId });
      }
      throw error;
    }
  },

  async update(id, updateData) {
    const current = await customRecipeSchema.findById(id);
    if (!current) {
      throw new Error(`CustomRecipe not found: ${id}`);
    }

    const nextValue = {
      ...current.toObject(),
      ...updateData,
      recipe: current.recipe,
      quantity: recipeMergeService.normalizePositiveNumber(
        updateData.quantity === undefined ? current.quantity : updateData.quantity,
      ),
      quantityCooked: recipeMergeService.normalizePositiveNumber(
        updateData.quantityCooked === undefined
          ? current.quantityCooked
          : updateData.quantityCooked,
      ),
    };

    recipeMergeService.validateCustomRecipe(nextValue);

    const addedCustomProducts =
      updateData.addedCustomProducts === undefined
        ? normalizeRefList(current.addedCustomProducts)
        : await syncCustomRecipeCustomProducts({
            customRecipeId: id,
            currentCustomProducts: current.addedCustomProducts || [],
            nextCustomProducts: updateData.addedCustomProducts || [],
            kind: "added",
          });

    const modifiedBaseCustomProducts =
      updateData.modifiedBaseCustomProducts === undefined
        ? normalizeRefList(current.modifiedBaseCustomProducts)
        : await syncCustomRecipeCustomProducts({
            customRecipeId: id,
            currentCustomProducts: current.modifiedBaseCustomProducts || [],
            nextCustomProducts: updateData.modifiedBaseCustomProducts || [],
            kind: "modified",
          });

    return customRecipeSchema.findByIdAndUpdate(
      id,
      {
        $set: {
          quantity:
            recipeMergeService.normalizePositiveNumber(
              updateData.quantity === undefined
                ? current.quantity
                : updateData.quantity,
            ),
          quantityCooked:
            recipeMergeService.normalizePositiveNumber(
              updateData.quantityCooked === undefined
                ? current.quantityCooked
                : updateData.quantityCooked,
            ),
          addedCustomProducts,
          modifiedBaseCustomProducts,
          removedBaseCustomProductIds:
            updateData.removedBaseCustomProductIds === undefined
              ? normalizeRefList(current.removedBaseCustomProductIds)
              : normalizeRefList(updateData.removedBaseCustomProductIds),
        },
      },
      { new: true },
    );
  },

  async delete(id) {
    const deleted = await customRecipeSchema.findByIdAndDelete(id);
    if (!deleted) {
      throw new Error(`CustomRecipe not found: ${id}`);
    }
    return { success: true };
  },
};
