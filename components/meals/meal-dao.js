const mealSchema = require("./meal-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const productSchema = require("../products/product-schema");
const recipeSchema = require("../recipes/recipe-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const ns = require("../util/normalize-search");
const {
  createAccentInsensitiveRegexArray,
} = require("../util/accent-insensitive-regex");
const { default: mongoose } = require("mongoose");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  async findAll(page, limit) {
    return new Promise((resolve, reject) =>
      mealSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async findById(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findOne({ _id: id }).exec((err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async createMeal(meal) {
    return new Promise((resolve, reject) =>
      mealSchema.create(meal, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async searchAllWithFilters(
    page,
    limit,
    search,
    ownFilter,
    recipeFilter,
    shieldFilter,
    favFilter,
    userId,
  ) {
    try {
      if (!search) search = "";

      const hasSearch = search.trim().length > 0;

      // Helper function para crear regex query (fallback)
      const createRegexQuery = (additionalFilters = {}) => {
        if (!hasSearch) return additionalFilters;

        const searchTerms = search
          .split(" ")
          .filter((term) => term.trim().length > 0);
        const accentInsensitiveRegexTerms =
          createAccentInsensitiveRegexArray(searchTerms);

        return {
          $and: accentInsensitiveRegexTerms.map((term) => ({
            name: { $regex: term, $options: "i" },
          })),
          ...additionalFilters,
        };
      };

      let docs = [];

      let user = null;
      if (userId) {
        user = await userSchema
          .findById(userId)
          .select("archivedProducts archivedRecipes")
          .lean();
      }
      if (!user) user = { archivedProducts: [], archivedRecipes: [] };

      // CASE 1: Own Products (products with userId = currentUser)
      if (ownFilter && !recipeFilter && !shieldFilter && !favFilter) {
        const userObjectId = toObjectId(userId);
        if (!userObjectId) return [];
        const query = createRegexQuery({
          userId: userObjectId,
        });
        docs = await productSchema.aggregate([
          { $match: query },
          {
            $addFields: {
              isSpanish: {
                $cond: {
                  if: { $regexMatch: { input: { $toString: { $ifNull: ["$code", ""] } }, regex: "^84" } },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          { $sort: { isSpanish: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0 } },
        ]);
      }
      // CASE 3: Favorite Own Products (own + fav, no recipe, no shield)
      else if (ownFilter && !recipeFilter && !shieldFilter && favFilter) {
        const userObjectId = toObjectId(userId);
        if (!userObjectId) return [];
        const query = createRegexQuery({
          userId: userObjectId,
          _id: { $in: user.archivedProducts || [] },
        });
        docs = await productSchema.aggregate([
          { $match: query },
          {
            $addFields: {
              isSpanish: {
                $cond: {
                  if: { $regexMatch: { input: { $toString: { $ifNull: ["$code", ""] } }, regex: "^84" } },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          { $sort: { isSpanish: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0 } },
        ]);
      }
      // CASE 5: Recipes (no own, recipe, no shield, no fav)
      else if (!ownFilter && recipeFilter && !shieldFilter && !favFilter) {
        const query = createRegexQuery();
        docs = await recipeSchema
          .find(query)
          .skip(page * limit)
          .limit(limit);
      }
      // CASE 6: Verified Recipes (no own, recipe + shield, no fav)
      else if (!ownFilter && recipeFilter && shieldFilter && !favFilter) {
        const query = createRegexQuery({ verified: shieldFilter });
        docs = await recipeSchema
          .find(query)
          .skip(page * limit)
          .limit(limit);
      }
      // CASE 7: Favorite Recipes (no own, recipe + fav, no shield)
      else if (!ownFilter && recipeFilter && !shieldFilter && favFilter) {
        const query = createRegexQuery({
          _id: { $in: user.archivedRecipes || [] },
        });
        docs = await recipeSchema
          .find(query)
          .skip(page * limit)
          .limit(limit);
      }
      // CASE 8: Favorite Verified Recipes (no own, recipe + shield + fav)
      else if (!ownFilter && recipeFilter && shieldFilter && favFilter) {
        const query = createRegexQuery({
          _id: { $in: user.archivedRecipes || [] },
          verified: shieldFilter,
        });
        docs = await recipeSchema
          .find(query)
          .skip(page * limit)
          .limit(limit);
      }
      // CASE 9: Verified Products (no own, no recipe, shield, no fav)
      else if (!ownFilter && !recipeFilter && shieldFilter && !favFilter) {
        const query = createRegexQuery({
          verified: shieldFilter,
          $or: [{ userId: null }, { userId: { $exists: false } }],
        });
        docs = await productSchema.aggregate([
          { $match: query },
          {
            $addFields: {
              isSpanish: {
                $cond: {
                  if: { $regexMatch: { input: { $toString: { $ifNull: ["$code", ""] } }, regex: "^84" } },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          { $sort: { isSpanish: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0 } },
        ]);
      }
      // CASE 10: Favorite Verified Products (no own, no recipe, shield + fav)
      else if (!ownFilter && !recipeFilter && shieldFilter && favFilter) {
        const query = createRegexQuery({
          _id: { $in: user.archivedProducts || [] },
          verified: shieldFilter,
        });
        docs = await productSchema.aggregate([
          { $match: query },
          {
            $addFields: {
              isSpanish: {
                $cond: {
                  if: { $regexMatch: { input: { $toString: { $ifNull: ["$code", ""] } }, regex: "^84" } },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          { $sort: { isSpanish: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0 } },
        ]);
      }
      // CASE 11: Favorite Products (no own, no recipe, no shield, fav)
      else if (!ownFilter && !recipeFilter && !shieldFilter && favFilter) {
        // All favorited products (archivedProducts) — now unified, no archivedOwnProducts
        const p1 = productSchema.find(
          createRegexQuery({ _id: { $in: user.archivedProducts || [] } }),
        );

        const [r1] = await Promise.all([p1]);
        const allDocs = [...r1];

        allDocs.sort((a, b) => {
          const isSpanishA = a.code && a.code.startsWith("84") ? 1 : 0;
          const isSpanishB = b.code && b.code.startsWith("84") ? 1 : 0;
          if (isSpanishA !== isSpanishB) return isSpanishB - isSpanishA;
          return (a.name || "").localeCompare(b.name || "");
        });

        const startIndex = page * limit;
        docs = allDocs.slice(startIndex, startIndex + limit);
      }
      // CASE 12: General Products (no filters) — includes user's own products (userId)
      else if (!ownFilter && !recipeFilter && !shieldFilter && !favFilter) {
        // Exclude user's own products from the global results to avoid duplicates
        const baseMatch = userId
          ? { ...createRegexQuery(), $or: [{ userId: null }, { userId: { $exists: false } }] }
          : createRegexQuery();

        const pipeline = [
          { $match: baseMatch },
        ];

        if (userId) {
          const userObjectId = toObjectId(userId);
          if (!userObjectId) return [];
          pipeline.push({
            $unionWith: {
              coll: "products",
              pipeline: [
                {
                  $match: {
                    ...createRegexQuery(),
                    userId: userObjectId,
                  },
                },
                { $addFields: { isOwn: 1 } },
              ],
            },
          });
        }

        pipeline.push(
          {
            $addFields: {
              isOwn: { $ifNull: ["$isOwn", 0] },
              isSpanish: {
                $cond: {
                  if: { $regexMatch: { input: { $toString: { $ifNull: ["$code", ""] } }, regex: "^84" } },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          { $sort: { isOwn: -1, isSpanish: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0 } }
        );

        docs = await productSchema.aggregate(pipeline);
      }
      // Default case
      else {
        docs = [];
      }

      // Ordenar resultados si hay búsqueda
      if (hasSearch) {
        const searchTerms = search
          .split(" ")
          .filter((term) => term.trim().length > 0);
        const normalizedSearchTerms = searchTerms.map((term) =>
          ns.normalizeSearchTerm(term),
        );
        return orderByTermsMatched(docs, normalizedSearchTerms);
      }

      return docs;
    } catch (err) {
      throw err;
    }
  },

  async addMealProduct(idMeal, idProduct) {
    const addProduct = {
      $push: { customProducts: idProduct },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        addProduct,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async addMealCustomRecipe(idMeal, idCustomRecipe) {
    const addCustomRecipe = {
      $push: { customRecipes: idCustomRecipe },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        addCustomRecipe,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async pasteMeal(mealClipboard, mealToPaste, merge) {
    try {
      const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");
      const normalizeId = (value) => value?._id || value;
      const clipboardCustomProducts = mealClipboard.customProducts || [];
      const clipboardCustomRecipes = mealClipboard.customRecipes || [];
      const clipboardDataRecipes = mealClipboard.dataRecipes || [];
      const targetCustomProducts = mealToPaste.customProducts || [];
      const targetCustomRecipes = mealToPaste.customRecipes || [];
      const targetDataRecipes = mealToPaste.dataRecipes || [];

      // Nuevos ids
      clipboardCustomProducts.forEach(
        (customProductTemp) =>
          (customProductTemp._id = new mongoose.Types.ObjectId()),
      );

      clipboardCustomRecipes
        .flatMap((customRecipeTemp) => customRecipeTemp.customProducts || [])
        .forEach(
          (customProductTemp) =>
            (customProductTemp._id = new mongoose.Types.ObjectId()),
        );

      clipboardCustomRecipes.forEach(
        (customRecipeTemp) =>
          (customRecipeTemp._id = new mongoose.Types.ObjectId()),
      );

      // Copiar dataRecipes con nuevos IDs (recetas y customProducts)
      const newDataRecipes = [];
      if (clipboardDataRecipes.length > 0) {
        for (const dataRecipe of clipboardDataRecipes) {
          const originalRecipe = dataRecipe.recipe;

          // Copiar customProducts de la receta con nuevos IDs
          const copiedCustomProducts = [];
          if (
            originalRecipe.customProducts &&
            originalRecipe.customProducts.length > 0
          ) {
            for (const cp of originalRecipe.customProducts) {
              const cpCopy = {
                quantity: cp.quantity,
                product: cp.product?._id || cp.product,
                energyKcal100g: cp.energyKcal100g,
                protein100g: cp.protein100g,
                carbohydrates100g: cp.carbohydrates100g,
                fat100g: cp.fat100g,
                salt100g: cp.salt100g,
                sugars100g: cp.sugars100g,
              };
              const newCP = await customProductSchema.create(cpCopy);
              copiedCustomProducts.push(newCP._id);
            }
          }

          // Crear copia de la receta con los nuevos customProducts
          const recipeCopy = await recipeSchema.create({
            name: originalRecipe.name,
            description: originalRecipe.description,
            customProducts: copiedCustomProducts,
            verified: originalRecipe.verified,
            userId: originalRecipe.userId,
          });

          // Crear nuevo dataRecipe con la receta copiada
          const newDataRecipe = await dataRecipeSchema.create({
            recipe: recipeCopy._id,
            quantity: dataRecipe.quantity,
            quantityCooked: dataRecipe.quantityCooked,
          });

          newDataRecipes.push(newDataRecipe._id);
        }
      }

      // Vaciamos la meal a la que se van a pegar customProducts, customRecipes y dataRecipes
      if (!merge) {
        await customProductSchema.deleteMany({
          _id: {
            $in: targetCustomProducts.map((customProductTemp) =>
              normalizeId(customProductTemp),
            ),
          },
        });
        await customProductSchema.deleteMany({
          _id: {
            $in: targetCustomRecipes
              .flatMap(
                (customRecipeTemp) => customRecipeTemp.customProducts || [],
              )
              .map((customProductTemp) => normalizeId(customProductTemp)),
          },
        });
        await customRecipeSchema.deleteMany({
          _id: {
            $in: targetCustomRecipes.map((customRecipeTemp) =>
              normalizeId(customRecipeTemp),
            ),
          },
        });

        // Eliminar dataRecipes existentes
        if (targetDataRecipes.length > 0) {
          for (const drRef of targetDataRecipes) {
            const drId = normalizeId(drRef);
            if (!drId) continue;
            const dr = await dataRecipeSchema.findById(drId);
            if (dr && dr.recipe) {
              // Eliminar la receta y sus customProducts
              const recipe = await recipeSchema.findById(dr.recipe);
              if (recipe && recipe.customProducts) {
                await customProductSchema.deleteMany({
                  _id: { $in: recipe.customProducts },
                });
              }
              await recipeSchema.findByIdAndDelete(dr.recipe);
            }
            await dataRecipeSchema.findByIdAndDelete(drId);
          }
        }
      }

      const newCustomProducts = await customProductSchema.insertMany(
        clipboardCustomProducts,
      );

      const newCustomRecipes = await customRecipeSchema.insertMany(
        clipboardCustomRecipes,
      );

      if (merge) {
        const targetDataRecipeIds = targetDataRecipes
          .map((dataRecipeTemp) => normalizeId(dataRecipeTemp))
          .filter(Boolean);
        mealToPaste.customProducts =
          targetCustomProducts.concat(newCustomProducts);
        mealToPaste.customRecipes =
          targetCustomRecipes.concat(newCustomRecipes);
        mealToPaste.dataRecipes = targetDataRecipeIds.concat(newDataRecipes);
      } else {
        // Creación de nuevos customProducts, customRecipes y dataRecipes
        mealToPaste.customProducts = newCustomProducts;
        mealToPaste.customRecipes = newCustomRecipes;
        mealToPaste.dataRecipes = newDataRecipes;
      }

      // Creación de nuevos customProducts en customRecipe
      await customProductSchema.insertMany(
        clipboardCustomRecipes.flatMap(
          (customRecipeTemp) => customRecipeTemp.customProducts || [],
        ),
      );

      return await mealSchema.findByIdAndUpdate(mealToPaste._id, mealToPaste, {
        new: true,
      });
    } catch (err) {
      return err;
    }

    // try {
    //   // Obtención de ids de meal que se va a eliminar
    //   const mealIdsCustomProducts = mealToPaste.customProducts.map(
    //     (productTemp) => productTemp._id
    //   );
    //   await customProductSchema.deleteMany({
    //     _id: { $in: mealIdsCustomProducts },
    //   });

    //   // Creación de ids de customProducts que se van a crear en la meal
    //   const customProductsToCreate = mealClipboard.customProducts.map(
    //     (productTemp) => {
    //       return { ...productTemp, _id: new mongoose.Types.ObjectId() };
    //     }
    //   );
    //   // Asígnación de ids de customProducts a la meal a la que van a ser copiados
    //   mealToPaste.customProducts = mealClipboard.customProducts;
    //   await customProductSchema.insertMany(customProductsToCreate);

    //   const mealIdsCustomRecipes = mealToPaste.customRecipes.map(
    //     (customRecipeTemp) => customRecipeTemp._id
    //   );

    //   const mealIdsCustomRecipesCustomProducts = mealToPaste.customRecipes
    //     .map((customRecipeTemp) =>
    //       customRecipeTemp.customProducts.map(
    //         (customProductTemp) => customProductTemp._id
    //       )
    //     )
    //     .flat();

    //   await customRecipeSchema.deleteMany({
    //     _id: { $in: mealIdsCustomRecipes },
    //   });

    //   await customProductSchema.deleteMany({
    //     _id: { $in: mealIdsCustomRecipesCustomProducts },
    //   });

    //   const customRecipeCustomProductsIds = [];
    //   mealClipboard.customRecipes = mealClipboard.customRecipes.map(
    //     (customRecipe) => {
    //       customRecipe.customProducts = customRecipe.customProducts.map((customProduct) => {
    //         customProduct._id = mongoose.Types.ObjectId();
    //         customRecipeCustomProductsIds.push(customProduct);
    //         return customProduct;
    //       });
    //       customRecipe._id = mongoose.Types.ObjectId();
    //       return customRecipe;
    //     }
    //   );

    //   mealToPaste.customRecipes = mealClipboard.customRecipes;
    //   await customProductSchema.insertMany(customRecipeCustomProductsIds);
    //   await customRecipeSchema.insertMany(mealClipboard.customRecipes);

    //   const updatedMeal = await mealSchema.findByIdAndUpdate(
    //     mealToPaste._id,
    //     mealToPaste,
    //     { new: true }
    //   );

    //   return updatedMeal;
    // } catch (err) {
    //   throw err;
    // }
  },

  async updateMeal({ id, name, products, notes }) {
    const update = { $set: { name, products } };

    if (!notes || notes.trim() === "") update.$unset = { notes: 1 };
    else update.$set.notes = notes;

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(id, update, { new: true }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async modifyMeal(meal) {
    const update = { $set: meal };
    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        meal._id,
        update,
        { new: true },
        (err, doc) => {
          if (err) return reject(err);
          return resolve(doc);
        },
      ),
    );
  },

  async deleteMeal(id) {
    return new Promise((resolve, reject) =>
      mealSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async deleteMealProduct(idMeal, idProduct) {
    const deleteProduct = {
      $pull: { customProducts: idProduct },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        deleteProduct,
        { new: true },
        (err, mealDoc) => {
          if (err) return reject(err);

          customProductSchema.deleteOne(
            { _id: idProduct },
            (err2, doc2) => {
              if (err2) return reject(err2);

              return resolve(mealDoc);
            },
          );
        },
      ),
    );
  },

  async deleteMealCustomRecipe(idMeal, idCustomRecipe) {
    const deleteCustomRecipe = {
      $pull: { customRecipes: idCustomRecipe },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        deleteCustomRecipe,
        { new: true },
        (err, mealDoc) => {
          if (err) return reject(err);

          customRecipeSchema.deleteOne(
            { _id: idCustomRecipe },
            (err2, doc2) => {
              if (err2) return reject(err2);

              return resolve(mealDoc);
            },
          );
        },
      ),
    );
  },

  async deleteMealCustomProducts(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const customProductIds = doc.customProducts.map(
          (productTemp) => productTemp._id || productTemp,
        );
        customProductSchema.deleteMany(
          { _id: { $in: customProductIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            mealSchema.findByIdAndUpdate(
              id,
              { $set: { customProducts: [] } },
              { new: true },
              (err3, finalDoc) => {
                if (err3) return reject(err3);
                return resolve(finalDoc);
              }
            );
          },
        );
      }),
    );
  },

  async deleteMealCustomRecipes(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const customRecipeIds = doc.customRecipes.map(
          (recipeTemp) => recipeTemp._id || recipeTemp,
        );
        customRecipeSchema.deleteMany(
          { _id: { $in: customRecipeIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            mealSchema.findByIdAndUpdate(
              id,
              { $set: { customRecipes: [] } },
              { new: true },
              (err3, finalDoc) => {
                if (err3) return reject(err3);
                return resolve(finalDoc);
              }
            );
          },
        );
      }),
    );
  },
};

function orderByTermsMatched(docs, searchTerms) {
  return docs.sort((a, b) => {
    // Primero por prioridad española (código 84)
    const isSpanishA = a.code && a.code.startsWith("84") ? 1 : 0;
    const isSpanishB = b.code && b.code.startsWith("84") ? 1 : 0;

    if (isSpanishA !== isSpanishB) {
      return isSpanishB - isSpanishA;
    }

    if (!searchTerms || searchTerms.length === 0) {
      return (a.name || "").localeCompare(b.name || "");
    }

    const scoreA = calculateMatchScore(a.name, searchTerms);
    const scoreB = calculateMatchScore(b.name, searchTerms);

    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Orden descendente por puntuación de relevancia
    }

    return (a.name || "").localeCompare(b.name || "");
  });
}

function calculateMatchScore(name, searchTerms) {
  if (!name || !searchTerms || searchTerms.length === 0) return 0;

  // Normalizar el nombre y los términos de búsqueda
  const normalizedName = ns.normalizeSearchTerm(name);
  const normalizedSearchTerms = searchTerms.map((term) =>
    ns.normalizeSearchTerm(term),
  );
  const searchQuery = normalizedSearchTerms.join(" ");

  // Dividir en palabras
  const nameWords = normalizedName
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const searchWords = normalizedSearchTerms.filter((word) => word.length > 0);

  let score = 0;

  // Prioridad máxima: coincidencia exacta completa del nombre normalizado
  if (normalizedName === searchQuery) {
    return 100000;
  }

  // Segunda prioridad: coincidencia exacta de nombres de una sola palabra
  if (
    nameWords.length === 1 &&
    searchWords.length === 1 &&
    nameWords[0] === searchWords[0]
  ) {
    return 50000;
  }

  // Puntuación por coincidencias exactas de palabras
  let exactMatches = 0;
  for (const searchWord of searchWords) {
    if (nameWords.includes(searchWord)) {
      exactMatches++;
      score += 1000; // Bonus por cada palabra que coincide exactamente
    }
  }

  // Puntuación por coincidencias parciales
  let partialMatches = 0;
  for (const searchWord of searchWords) {
    for (const nameWord of nameWords) {
      if (nameWord.includes(searchWord) && nameWord !== searchWord) {
        partialMatches++;
        score += 500; // Bonus menor por coincidencias parciales
        break; // Solo contar una vez por término de búsqueda
      }
    }
  }

  // Bonus por diferencia en número de palabras (preferir nombres más cortos)
  const wordCountDifference = Math.abs(nameWords.length - searchWords.length);
  if (wordCountDifference === 0) {
    score += 200; // Bonus por mismo número de palabras
  } else {
    score -= wordCountDifference * 50; // Penalización por diferencia
  }

  // Bonus por porcentaje de palabras que coinciden
  const matchPercentage = exactMatches / searchWords.length;
  score += matchPercentage * 300;

  // Penalización por nombres muy largos cuando la búsqueda es corta
  if (searchWords.length <= 2 && nameWords.length > 4) {
    score -= 100;
  }

  return Math.max(0, score); // Asegurar que la puntuación no sea negativa
}

// CustomRecipeInstance methods for meals
module.exports.addMealCustomRecipeInstance = async function (
  idMeal,
  idCustomRecipeInstance,
) {
  return mealSchema.findByIdAndUpdate(
    idMeal,
    { $push: { customRecipeInstances: idCustomRecipeInstance } },
    { new: true },
  );
};

module.exports.deleteMealCustomRecipeInstance = async function (
  idMeal,
  idCustomRecipeInstance,
) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  // Remove from meal
  const meal = await mealSchema.findByIdAndUpdate(
    idMeal,
    { $pull: { customRecipeInstances: idCustomRecipeInstance } },
    { new: true },
  );

  // Delete the customRecipeInstance document
  await CustomRecipe.findByIdAndDelete(idCustomRecipeInstance);

  return meal;
};

module.exports.deleteMealCustomRecipeInstances = async function (id) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  const meal = await mealSchema.findById(id);
  if (
    meal &&
    meal.customRecipeInstances &&
    meal.customRecipeInstances.length > 0
  ) {
    await CustomRecipe.deleteMany({ _id: { $in: meal.customRecipeInstances } });
  }

  return mealSchema.findByIdAndUpdate(
    id,
    { $set: { customRecipeInstances: [] } },
    { new: true },
  );
};
