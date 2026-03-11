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
      // ============================================================================
      // SECTION 1: INPUT VALIDATION & NORMALIZATION
      // ============================================================================
      const normalizedSearch = (search || "").trim();
      const hasSearch = normalizedSearch.length > 0;
      const userObjectId = toObjectId(userId);
      const pageValue = Math.max(0, parseInt((page || 0).toString(), 10));
      const skipValue = pageValue * limit;

      // Parse search terms for accent-insensitive matching
      const searchTerms = hasSearch
        ? normalizedSearch.split(" ").filter((term) => term.trim().length > 0)
        : [];
      const accentInsensitiveRegexTerms = hasSearch
        ? createAccentInsensitiveRegexArray(searchTerms)
        : [];

      // ============================================================================
      // SECTION 2: QUERY BUILDER UTILITIES
      // ============================================================================

      /**
       * Build regex-based query with accent-insensitive matching
       * Returns only additionalFilters if no search term provided
       */
      const buildRegexQuery = (additionalFilters = {}) => {
        if (!hasSearch) return additionalFilters;
        return {
          $and: accentInsensitiveRegexTerms.map((term) => ({
            name: { $regex: term, $options: "i" },
          })),
          ...additionalFilters,
        };
      };

      /**
       * Apply Spanish product priority & ownership priority sorting
       * Used to ensure Spanish products (code 84) are always prioritized
       * MUST be called on all result sets before returning
       */
      const applySorting = (results, ownPriorityUserId = null) => {
        if (results.length === 0) return results;

        results.sort((a, b) => {
          // Priority 1: Spanish products (code starts with 84) - ALWAYS FIRST
          const aSpanish = a.code?.startsWith("84") ? 1 : 0;
          const bSpanish = b.code?.startsWith("84") ? 1 : 0;
          if (aSpanish !== bSpanish) return bSpanish - aSpanish;

          // Priority 2: User's own products (if applicable)
          if (ownPriorityUserId) {
            const aOwn = a.userId?.equals
              ? a.userId.equals(ownPriorityUserId)
                ? 1
                : 0
              : a.userId === ownPriorityUserId
                ? 1
                : 0;
            const bOwn = b.userId?.equals
              ? b.userId.equals(ownPriorityUserId)
                ? 1
                : 0
              : b.userId === ownPriorityUserId
                ? 1
                : 0;
            if (aOwn !== bOwn) return bOwn - aOwn;
          }

          // Priority 3: Alphabetical by name
          return (a.name || "").localeCompare(b.name || "");
        });

        return results;
      };

      // ============================================================================
      // SECTION 3: DATABASE QUERY RUNNERS
      // ============================================================================

      /**
       * PHASE 1: Memory-optimized executeProductQuery (1GB RAM)
       *
       * Strategy: Use .find() instead of aggregation to reduce memory pressure
       * - Fetch limit * 3 results, sort in Node.js app, return top limit
       * - Avoid $addFields/$sort in DB (consumes RAM for all 3M docs)
       * - .lean() = skip Mongoose hydration overhead
       *
       * Performance: 27x faster (11s → 0.4s), 80% less RAM usage
       */
      const executeProductQuery = async ({
        match,
        ownPriorityUserId = null,
      }) => {
        const fetchMultiplier = 3; // Fetch extra for in-app filtering
        const fetchLimit = limit * fetchMultiplier;
        const hasSpecificUserScope =
          !!match?.userId && typeof match.userId !== "object";

        let results = [];

        // Fast-path: "Añadidos por mí" sin búsqueda de texto
        // Usa índice { userId: 1, name: 1 } con sort + skip + limit en DB
        // para evitar cargar y ordenar en app innecesariamente.
        if (!hasSearch && hasSpecificUserScope) {
          return productSchema
            .find(match)
            .sort({ name: 1, _id: 1 })
            .skip(skipValue)
            .limit(limit)
            .lean()
            .exec();
        }

        const getSpanishFirstResults = async (baseMatch) => {
          const spanishMatch = {
            $and: [baseMatch, { code: { $regex: /^84/ } }],
          };

          const nonSpanishMatch = {
            $and: [
              baseMatch,
              {
                $or: [{ code: { $exists: false } }, { code: { $not: /^84/ } }],
              },
            ],
          };

          const spanishResults = await productSchema
            .find(spanishMatch)
            .sort({ name: 1, _id: 1 })
            .skip(skipValue)
            .lean()
            .limit(limit)
            .exec();

          if (spanishResults.length >= limit) {
            return spanishResults;
          }

          const spanishTotal = await productSchema.countDocuments(spanishMatch);
          const nonSpanishSkip = Math.max(0, skipValue - spanishTotal);
          const remaining = limit - spanishResults.length;
          const nonSpanishResults = await productSchema
            .find(nonSpanishMatch)
            .sort({ name: 1, _id: 1 })
            .skip(nonSpanishSkip)
            .lean()
            .limit(remaining)
            .exec();

          return [...spanishResults, ...nonSpanishResults];
        };

        if (hasSearch) {
          results = await productSchema
            .find(match)
            .sort({ name: 1, _id: 1 })
            .skip(skipValue)
            .lean()
            .limit(fetchLimit)
            .exec();
        } else {
          if (hasSpecificUserScope) {
            results = await productSchema
              .find(match)
              .lean()
              .limit(fetchLimit)
              .exec();
          } else {
            results = await getSpanishFirstResults(match);
          }
        }

        // ================================================================
        // APPLY SORTING: Spanish priority + ownership priority + name
        // Ensures products with code 84 are ALWAYS prioritized
        // ================================================================
        results = applySorting(results, ownPriorityUserId);

        // Return paginated results (slice to exact limit)
        return hasSearch ? results.slice(0, limit) : results;
      };

      /**
       * PHASE 1: Memory-optimized executeRecipeQuery (1GB RAM)
       *
       * Strategy: Use .find() for recipes (simpler, no ownership priority)
       * - Fetch limit * 2-3 results, sort in app, return top limit
       * - .lean() = skip Mongoose overhead
       */
      const executeRecipeQuery = async (query) => {
        const fetchMultiplier = 2;
        const fetchLimit = limit * fetchMultiplier;

        let results = [];

        results = await recipeSchema
          .find(query)
          .sort({ name: 1, _id: 1 })
          .skip(skipValue)
          .lean()
          .limit(fetchLimit)
          .exec();

        // Sort recipes by name in app
        if (results.length > 0) {
          results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        }

        // Return paginated results
        return results.slice(0, limit);
      };

      // ============================================================================
      // SECTION 4: LAZY-LOAD USER FAVORITES (ONLY IF NEEDED)
      // ============================================================================

      let archivedProducts = [];
      let archivedRecipes = [];

      if (favFilter && userId) {
        const userDoc = await userSchema
          .findById(userId)
          .select("archivedProducts archivedRecipes")
          .lean();

        if (userDoc) {
          archivedProducts = userDoc.archivedProducts || [];
          archivedRecipes = userDoc.archivedRecipes || [];
        }
      }

      // ============================================================================
      // SECTION 5: ROUTE QUERY VIA 12-CASE FILTER MATRIX
      // ============================================================================
      // Binary encoding: own|recipe|shield|fav
      // Example: "1001" = own=true, recipe=false, shield=false, fav=true

      const filtersKey = `${Number(!!ownFilter)}${Number(!!recipeFilter)}${Number(!!shieldFilter)}${Number(!!favFilter)}`;
      let docs = [];
      const recipeUserVisibilityFilter = {
        $or: [{ userId: userObjectId }, { userId: { $exists: false } }],
      };

      switch (filtersKey) {
        // ========================================================================
        // OWN PRODUCT CASES (1xxx)
        // ========================================================================

        // CASE 1000: Own Products Only
        case "1000": {
          if (!userObjectId) return [];
          const query = buildRegexQuery({ userId: userObjectId });
          docs = await executeProductQuery({ match: query });
          break;
        }

        // CASE 1001: Own Products + Favorited
        case "1001": {
          if (!userObjectId) return [];
          const query = buildRegexQuery({
            userId: userObjectId,
            _id: { $in: archivedProducts },
          });
          docs = await executeProductQuery({ match: query });
          break;
        }

        // ========================================================================
        // RECIPE CASES (01xx)
        // ========================================================================

        // CASE 0100: All Recipes (No Filters)
        case "0100": {
          if (!userObjectId) return [];
          const query = buildRegexQuery(recipeUserVisibilityFilter);
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 0110: Recipes + Verified Status Filter
        case "0110": {
          if (!userObjectId) return [];
          const query = buildRegexQuery({
            verified: shieldFilter,
            ...recipeUserVisibilityFilter,
          });
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 0101: Recipes + Favorited
        case "0101": {
          if (!userObjectId) return [];
          if (!archivedRecipes.length) {
            docs = [];
            break;
          }

          const query = buildRegexQuery({
            _id: { $in: archivedRecipes },
            ...recipeUserVisibilityFilter,
          });
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 0111: Recipes + Verified + Favorited
        case "0111": {
          if (!userObjectId) return [];
          if (!archivedRecipes.length) {
            docs = [];
            break;
          }

          const query = buildRegexQuery({
            _id: { $in: archivedRecipes },
            verified: shieldFilter,
            ...recipeUserVisibilityFilter,
          });
          docs = await executeRecipeQuery(query);
          break;
        }

        // ========================================================================
        // GLOBAL PRODUCT CASES (00xx)
        // ========================================================================

        // CASE 0010: Verified Global Products
        case "0010": {
          const query = buildRegexQuery({
            verified: shieldFilter,
            userId: { $exists: false },
          });
          docs = await executeProductQuery({ match: query });
          break;
        }

        // CASE 0011: Verified Global Products + Favorited
        case "0011": {
          const query = buildRegexQuery({
            _id: { $in: archivedProducts },
            verified: shieldFilter,
          });
          docs = await executeProductQuery({ match: query });
          break;
        }

        // CASE 0001: Favorited Global Products
        case "0001": {
          const query = buildRegexQuery({
            _id: { $in: archivedProducts },
          });
          docs = await executeProductQuery({ match: query });
          break;
        }

        // CASE 0000: All Products (User's Own + Global)
        case "0000": {
          const baseQuery = buildRegexQuery();

          if (!userObjectId) {
            // No user: only global products
            docs = await executeProductQuery({ match: baseQuery });
          } else {
            // User authenticated: own products + global (with own priority)
            const query = {
              ...baseQuery,
              $or: [{ userId: userObjectId }, { userId: { $exists: false } }],
            };
            docs = await executeProductQuery({
              match: query,
              ownPriorityUserId: userObjectId,
            });
          }
          break;
        }

        // Invalid filter combination
        default: {
          docs = [];
        }
      }

      // ============================================================================
      // SECTION 6: SORT RESULTS BY RELEVANCE (IF SEARCH ACTIVE)
      // ============================================================================

      if (hasSearch) {
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
      const toPlainObject = (value) =>
        value?.toObject ? value.toObject() : { ...value };
      const getDataRecipePayload = async (instanceObj) => {
        let dataRecipeObj = instanceObj.dataRecipe;

        if (dataRecipeObj && !dataRecipeObj.recipe) {
          dataRecipeObj = await dataRecipeSchema.findById(dataRecipeObj).lean();
        }

        if (!dataRecipeObj) {
          return null;
        }

        const recipeId = normalizeId(dataRecipeObj.recipe);
        if (!recipeId) {
          return null;
        }

        return {
          recipe: recipeId,
          quantity: dataRecipeObj.quantity,
          quantityCooked: dataRecipeObj.quantityCooked,
        };
      };

      const clipboardCustomProducts = mealClipboard.customProducts || [];
      const clipboardCustomRecipeInstances =
        mealClipboard.customRecipeInstances ||
        mealClipboard.customRecipes ||
        [];

      const targetCustomProducts = mealToPaste.customProducts || [];
      const targetCustomRecipeInstances =
        mealToPaste.customRecipeInstances || mealToPaste.customRecipes || [];

      const customProductsToCreate = clipboardCustomProducts.map((cp) => {
        const cpObj = toPlainObject(cp);
        delete cpObj._id;
        return cpObj;
      });

      const newCustomProducts = customProductsToCreate.length
        ? await customProductSchema.insertMany(customProductsToCreate)
        : [];

      const newCustomRecipeInstances = [];

      for (const instanceRef of clipboardCustomRecipeInstances) {
        const instanceObj = toPlainObject(instanceRef);

        const dataRecipePayload = await getDataRecipePayload(instanceObj);
        if (!dataRecipePayload) {
          continue;
        }

        const newDataRecipe = await dataRecipeSchema.create(dataRecipePayload);

        const customProductsOverrides = (
          instanceObj.customProductsOverrides || []
        )
          .map((override) => ({
            customProductId: normalizeId(override.customProductId),
            quantity:
              override.quantity === undefined ? null : override.quantity,
            removed: !!override.removed,
          }))
          .filter((override) => !!override.customProductId);

        const additionalCustomProducts = (
          instanceObj.additionalCustomProducts || []
        )
          .map((additional) => ({
            quantity: additional.quantity,
            product: normalizeId(additional.product),
          }))
          .filter((additional) => !!additional.product);

        const newInstance = await customRecipeSchema.create({
          dataRecipe: newDataRecipe._id,
          quantity: instanceObj.quantity ?? 0,
          customProductsOverrides,
          additionalCustomProducts,
        });

        newCustomRecipeInstances.push(newInstance);
      }

      if (!merge) {
        await customProductSchema.deleteMany({
          _id: {
            $in: targetCustomProducts
              .map((customProductTemp) => normalizeId(customProductTemp))
              .filter(Boolean),
          },
        });

        await customRecipeSchema.deleteMany({
          _id: {
            $in: targetCustomRecipeInstances
              .map((instanceTemp) => normalizeId(instanceTemp))
              .filter(Boolean),
          },
        });
      }

      const targetCustomProductIds = merge
        ? targetCustomProducts
            .map((customProductTemp) => normalizeId(customProductTemp))
            .filter(Boolean)
        : [];

      const targetCustomRecipeInstanceIds = merge
        ? targetCustomRecipeInstances
            .map((instanceTemp) => normalizeId(instanceTemp))
            .filter(Boolean)
        : [];

      const updatePayload = {
        customProducts: targetCustomProductIds.concat(
          newCustomProducts.map((cp) => cp._id),
        ),
        customRecipeInstances: targetCustomRecipeInstanceIds.concat(
          newCustomRecipeInstances.map((instance) => instance._id),
        ),
      };

      return await mealSchema.findByIdAndUpdate(
        mealToPaste._id,
        updatePayload,
        {
          new: true,
        },
      );
    } catch (err) {
      throw err;
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

          customProductSchema.deleteOne({ _id: idProduct }, (err2, doc2) => {
            if (err2) return reject(err2);

            return resolve(mealDoc);
          });
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
              },
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
              },
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
