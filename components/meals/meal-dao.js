const mealSchema = require("./meal-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const productSchema = require("../products/product-schema");
const recipeSchema = require("../recipes/recipe-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const ns = require("../util/normalize-search");
const {
  createAccentInsensitiveRegexArray,
} = require("../util/accent-insensitive-regex");
const {
  normalizeSearchText,
  splitSearchTokens,
  hasEditDistanceOneOrLess,
  buildSearchFields,
} = require("../util/search-index");
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

  // TAREA 1 — marcar/desmarcar cumplimiento, nunca protegido por assertMealEditable.
  async setCompleted(id, completed) {
    return mealSchema.findByIdAndUpdate(id, { $set: { completed: Boolean(completed) } }, { new: true });
  },

  async markAssignedByTrainer(id, trainerId) {
    return mealSchema.findByIdAndUpdate(id, { $set: { assignedByTrainerId: trainerId } }, { new: true });
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

      // Parse search terms
      const searchTerms = hasSearch ? splitSearchTokens(normalizedSearch) : [];
      const normalizedSearchQuery = hasSearch
        ? normalizeSearchText(normalizedSearch)
        : "";
      const accentInsensitiveRegexTerms = hasSearch
        ? createAccentInsensitiveRegexArray(searchTerms)
        : [];

      // ============================================================================
      // SECTION 2: QUERY BUILDER UTILITIES
      // ============================================================================

      /**
       * Build regex-based query with accent-insensitive matching (usado solo para recetas)
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

      const buildProductBaseQuery = (additionalFilters = {}) => ({
        ...additionalFilters,
      });

      const toComparableId = (value) => {
        if (!value) return "";
        if (typeof value === "string") return value;
        if (typeof value === "object" && value.toString) return value.toString();
        return String(value);
      };

      const isOwnedByUser = (doc, ownPriorityUserId = null) => {
        if (!ownPriorityUserId) return false;
        return toComparableId(doc?.userId) === toComparableId(ownPriorityUserId);
      };

      const getProductTieBreakKey = (
        doc,
        ownPriorityUserId = null,
        favoriteIdSet = null,
      ) => {
        const id = toComparableId(doc?._id);
        return {
          isSpanish: doc?.code?.startsWith("84") ? 1 : 0,
          isVerified: doc?.verified ? 1 : 0,
          isOwn: isOwnedByUser(doc, ownPriorityUserId) ? 1 : 0,
          isFavorite:
            favoriteIdSet && id ? (favoriteIdSet.has(id) ? 1 : 0) : 0,
          name: doc?.name || "",
          id,
        };
      };

      const compareProductByTieBreak = (a, b) => {
        if (a.isSpanish !== b.isSpanish) return b.isSpanish - a.isSpanish;
        if (a.isVerified !== b.isVerified) return b.isVerified - a.isVerified;
        if (a.isOwn !== b.isOwn) return b.isOwn - a.isOwn;
        if (a.isFavorite !== b.isFavorite) return b.isFavorite - a.isFavorite;
        const nameOrder = a.name.localeCompare(b.name);
        if (nameOrder !== 0) return nameOrder;
        return a.id.localeCompare(b.id);
      };

      const getMatchPriority = (doc) => {
        const normalizedName = normalizeSearchText(
          doc?.nameNormalized || doc?.name,
        );
        const normalizedBrand = normalizeSearchText(
          doc?.brandNormalized || doc?.brand,
        );

        const nameTokens = splitSearchTokens(normalizedName);
        const brandTokens = splitSearchTokens(normalizedBrand);

        if (normalizedName === normalizedSearchQuery) return 900;
        if (normalizedName.startsWith(`${normalizedSearchQuery} `)) return 850;
        if (normalizedName.startsWith(normalizedSearchQuery)) return 820;
        if (nameTokens.includes(normalizedSearchQuery)) return 780;
        if (nameTokens.some((token) => token.startsWith(normalizedSearchQuery))) {
          return 740;
        }
        if (normalizedName.includes(normalizedSearchQuery)) return 700;

        if (normalizedBrand === normalizedSearchQuery) return 620;
        if (normalizedBrand.startsWith(`${normalizedSearchQuery} `)) return 600;
        if (normalizedBrand.startsWith(normalizedSearchQuery)) return 580;
        if (brandTokens.includes(normalizedSearchQuery)) return 560;
        if (
          brandTokens.some((token) => token.startsWith(normalizedSearchQuery))
        ) {
          return 540;
        }
        if (normalizedBrand.includes(normalizedSearchQuery)) return 520;

        return 0;
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
        favoriteIdSet = null,
      }) => {
        const fetchMultiplier = 3;
        const fetchLimit = skipValue + limit * fetchMultiplier;
        const hasSpecificUserScope = (() => {
          if (!match || !Object.prototype.hasOwnProperty.call(match, "userId")) {
            return false;
          }

          const rawUserId = match.userId;
          if (!rawUserId) return false;

          // Concrete scopes: ObjectId/string/null direct values.
          // Non-concrete scopes: operator objects like {$exists:false}.
          const isOperatorObject =
            typeof rawUserId === "object" &&
            rawUserId !== null &&
            Object.keys(rawUserId).some((key) => key.startsWith("$"));

          return !isOperatorObject;
        })();
        const fallbackUserScopeId = hasSpecificUserScope
          ? toObjectId(match.userId) || match.userId
          : ownPriorityUserId;

        // Fast-path: sin búsqueda para scope de usuario concreto
        if (!hasSearch && hasSpecificUserScope) {
          return productSchema
            .find(match)
            .sort({ name: 1, _id: 1 })
            .skip(skipValue)
            .limit(limit)
            .lean()
            .exec();
        }

        if (!hasSearch) {
          const results = await productSchema
            .find(match)
            .lean()
            .limit(fetchLimit)
            .exec();

          results.sort((left, right) => {
            const a = getProductTieBreakKey(
              left,
              ownPriorityUserId,
              favoriteIdSet,
            );
            const b = getProductTieBreakKey(
              right,
              ownPriorityUserId,
              favoriteIdSet,
            );
            return compareProductByTieBreak(a, b);
          });

          return results.slice(skipValue, skipValue + limit);
        }

        const candidateLimitPerStage = 220;
        const typoEnabled = normalizedSearchQuery.length > 2;
        const candidatesById = new Map();
        const queryUpperBound = `${normalizedSearchQuery}\uffff`;

        const upsertCandidate = (doc, score, stagePriority) => {
          if (!doc?._id) return;
          const key = toComparableId(doc._id);
          const existing = candidatesById.get(key);
          const payload = {
            doc,
            score,
            stagePriority,
            tieBreak: getProductTieBreakKey(doc, ownPriorityUserId, favoriteIdSet),
          };

          if (!existing) {
            candidatesById.set(key, payload);
            return;
          }

          if (
            score > existing.score ||
            (score === existing.score && stagePriority > existing.stagePriority)
          ) {
            candidatesById.set(key, payload);
          }
        };

        const [
          exactNameDocs,
          startsWithNameDocs,
          exactBrandDocs,
          startsWithBrandDocs,
          prefixNameDocs,
          prefixBrandDocs,
          textDocs,
        ] =
          await Promise.all([
            productSchema
              .find({ ...match, nameNormalized: normalizedSearchQuery })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find({
                ...match,
                nameNormalized: {
                  $gte: normalizedSearchQuery,
                  $lte: queryUpperBound,
                },
              })
              .sort({ nameNormalized: 1, _id: 1 })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find({ ...match, brandNormalized: normalizedSearchQuery })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find({
                ...match,
                brandNormalized: {
                  $gte: normalizedSearchQuery,
                  $lte: queryUpperBound,
                },
              })
              .sort({ brandNormalized: 1, _id: 1 })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find({ ...match, namePrefixes: normalizedSearchQuery })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find({ ...match, brandPrefixes: normalizedSearchQuery })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
            productSchema
              .find(
                { ...match, $text: { $search: normalizedSearch } },
                { score: { $meta: "textScore" } },
              )
              .sort({ score: { $meta: "textScore" } })
              .limit(candidateLimitPerStage)
              .lean()
              .exec(),
          ]);

        for (const doc of exactNameDocs) upsertCandidate(doc, 100000, 5);
        for (const doc of startsWithNameDocs) upsertCandidate(doc, 85000, 4);
        for (const doc of exactBrandDocs) upsertCandidate(doc, 90000, 4);
        for (const doc of startsWithBrandDocs) upsertCandidate(doc, 76000, 3);
        for (const doc of prefixNameDocs) upsertCandidate(doc, 70000, 2);
        for (const doc of prefixBrandDocs) upsertCandidate(doc, 60000, 1);
        for (const doc of textDocs) {
          const textScore = Number(doc.score || 0);
          upsertCandidate(doc, 40000 + textScore * 1200, 0);
        }

        // Fallback for legacy own products missing derived search fields.
        // Keep this lightweight to avoid UI lag.
        if (fallbackUserScopeId) {
          const missingDerivedQuery = {
            userId: fallbackUserScopeId,
            $or: [
              { nameNormalized: { $exists: false } },
              { brandNormalized: { $exists: false } },
              { namePrefixes: { $exists: false } },
              { brandPrefixes: { $exists: false } },
            ],
          };

          if (
            match &&
            Object.prototype.hasOwnProperty.call(match, "verified") &&
            typeof match.verified === "boolean"
          ) {
            missingDerivedQuery.verified = match.verified;
          }

          if (match && Object.prototype.hasOwnProperty.call(match, "_id")) {
            missingDerivedQuery._id = match._id;
          }

          const missingDerivedDocs = await productSchema
            .find(missingDerivedQuery)
            .limit(500)
            .lean()
            .exec();

          for (const doc of missingDerivedDocs) {
            const derived = buildSearchFields(doc);
            const enrichedDoc = { ...doc, ...derived };
            const fallbackPriority = getMatchPriority(enrichedDoc);
            if (fallbackPriority <= 0) continue;
            upsertCandidate(enrichedDoc, 30000 + fallbackPriority * 30, 0);
          }
        }

        const scoredCandidates = Array.from(candidatesById.values()).map(
          (candidate) => {
            const { doc } = candidate;
            let score = candidate.score;
            const matchPriority = getMatchPriority(doc);
            const nameTokens = splitSearchTokens(doc.nameNormalized || doc.name);
            const brandTokens = splitSearchTokens(
              doc.brandNormalized || doc.brand,
            );

            for (const term of searchTerms) {
              if (nameTokens.includes(term)) score += 1800;
              else if (nameTokens.some((token) => token.startsWith(term))) {
                score += 650;
              }

              if (brandTokens.includes(term)) score += 900;
              else if (brandTokens.some((token) => token.startsWith(term))) {
                score += 300;
              }

              if (typoEnabled) {
                if (
                  nameTokens.some((token) => hasEditDistanceOneOrLess(token, term))
                ) {
                  score += 450;
                }
                if (
                  brandTokens.some((token) => hasEditDistanceOneOrLess(token, term))
                ) {
                  score += 200;
                }
              }
            }

            return {
              ...candidate,
              matchPriority,
              score,
            };
          },
        );

        scoredCandidates.sort((left, right) => {
          if (left.matchPriority !== right.matchPriority) {
            return right.matchPriority - left.matchPriority;
          }
          if (left.score !== right.score) return right.score - left.score;
          if (left.stagePriority !== right.stagePriority) {
            return right.stagePriority - left.stagePriority;
          }
          return compareProductByTieBreak(left.tieBreak, right.tieBreak);
        });

        return scoredCandidates
          .slice(skipValue, skipValue + limit)
          .map((candidate) => candidate.doc);
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

      const shouldLoadFavoriteTieBreak = hasSearch && !!userObjectId && !favFilter;
      if (shouldLoadFavoriteTieBreak) {
        const userDoc = await userSchema
          .findById(userObjectId)
          .select("archivedProducts")
          .lean();
        archivedProducts = userDoc?.archivedProducts || [];
      }

      const favoriteProductIdSet = new Set(
        archivedProducts.map((value) => toComparableId(value)),
      );

      // ============================================================================
      // SECTION 5: ROUTE QUERY VIA 12-CASE FILTER MATRIX
      // ============================================================================
      // Binary encoding: own|recipe|shield|fav
      // Example: "1001" = own=true, recipe=false, shield=false, fav=true

      const filtersKey = `${Number(!!ownFilter)}${Number(!!recipeFilter)}${Number(!!shieldFilter)}${Number(!!favFilter)}`;
      let docs = [];
      const globalProductsFilter = {
        $or: [{ userId: null }, { userId: { $exists: false } }],
      };
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
          const query = buildProductBaseQuery({ userId: userObjectId });
          docs = await executeProductQuery({
            match: query,
            favoriteIdSet: favoriteProductIdSet,
          });
          break;
        }

        // CASE 1001: Own Products + Favorited
        case "1001": {
          if (!userObjectId) return [];
          const query = buildProductBaseQuery({
            userId: userObjectId,
            _id: { $in: archivedProducts },
          });
          docs = await executeProductQuery({
            match: query,
            favoriteIdSet: favoriteProductIdSet,
          });
          break;
        }

        // ========================================================================
        // RECIPE CASES (01xx)
        // ========================================================================

        // CASE 1100: Own Recipes Only
        case "1100": {
          if (!userObjectId) return [];
          const query = buildRegexQuery({ userId: userObjectId });
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 1110: Own Recipes + Verified
        case "1110": {
          if (!userObjectId) return [];
          const query = buildRegexQuery({
            userId: userObjectId,
            verified: shieldFilter,
          });
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 1101: Own Recipes + Favorited
        case "1101": {
          if (!userObjectId) return [];
          if (!archivedRecipes.length) {
            docs = [];
            break;
          }

          const query = buildRegexQuery({
            userId: userObjectId,
            _id: { $in: archivedRecipes },
          });
          docs = await executeRecipeQuery(query);
          break;
        }

        // CASE 1111: Own Recipes + Verified + Favorited
        case "1111": {
          if (!userObjectId) return [];
          if (!archivedRecipes.length) {
            docs = [];
            break;
          }

          const query = buildRegexQuery({
            userId: userObjectId,
            verified: shieldFilter,
            _id: { $in: archivedRecipes },
          });
          docs = await executeRecipeQuery(query);
          break;
        }

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
          const query = buildProductBaseQuery({
            verified: shieldFilter,
            ...globalProductsFilter,
          });
          docs = await executeProductQuery({
            match: query,
            favoriteIdSet: favoriteProductIdSet,
          });
          break;
        }

        // CASE 0011: Verified Global Products + Favorited
        case "0011": {
          const query = buildProductBaseQuery({
            _id: { $in: archivedProducts },
            verified: shieldFilter,
          });
          docs = await executeProductQuery({
            match: query,
            favoriteIdSet: favoriteProductIdSet,
          });
          break;
        }

        // CASE 0001: Favorited Global Products
        case "0001": {
          const query = buildProductBaseQuery({
            _id: { $in: archivedProducts },
          });
          docs = await executeProductQuery({
            match: query,
            favoriteIdSet: favoriteProductIdSet,
          });
          break;
        }

        // CASE 0000: All Products (User's Own + Global)
        case "0000": {
          const baseQuery = buildProductBaseQuery();

          if (!userObjectId) {
            // No user: only global products
            docs = await executeProductQuery({
              match: {
                ...baseQuery,
                ...globalProductsFilter,
              },
              favoriteIdSet: favoriteProductIdSet,
            });
          } else {
            // User authenticated: own products + global (with own priority)
            const query = {
              ...baseQuery,
              $or: [
                { userId: userObjectId },
                { userId: null },
                { userId: { $exists: false } },
              ],
            };
            docs = await executeProductQuery({
              match: query,
              ownPriorityUserId: userObjectId,
              favoriteIdSet: favoriteProductIdSet,
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

      if (hasSearch && !!recipeFilter) {
        const normalizedSearchTerms = searchTerms.map((term) =>
          ns.normalizeSearchTerm(term),
        );
        // Ordenar por relevancia sobre todos los candidatos y paginar en memoria
        const sorted = orderByTermsMatched(docs, normalizedSearchTerms);
        return sorted.slice(skipValue, skipValue + limit);
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

  // TAREA (meals pautados) — trainerId opcional: solo lo pasan los flujos
  // controlados por un profesional (prescribeMeal/applyMealToClients/
  // MealProposal aceptada/plan-resolver), nunca el "pegar" que el propio
  // cliente usa para copiar una comida a otro día (meal-controller.js#pasteMeal,
  // que sigue llamando sin este argumento). Estampa assignedByTrainerId en
  // cada CustomProduct/CustomRecipe NUEVO — a nivel de item, no de Meal
  // completa — para que el cliente pueda seguir añadiendo sus propios
  // productos/recetas a la misma comida sin que toda ella quede bloqueada
  // (ver meal-service.js#assertMealEditable, ahora reutilizada por item).
  async pasteMeal(mealClipboard, mealToPaste, merge, trainerId = null) {
    try {
      const normalizeId = (value) => value?._id || value;
      const toPlainObject = (value) =>
        value?.toObject ? value.toObject() : { ...value };
      const cloneCustomProductPayload = (value) => {
        const payload = toPlainObject(value);
        delete payload._id;
        if (trainerId) payload.assignedByTrainerId = trainerId;
        return payload;
      };
      const buildCustomRecipeClonePayload = (customRecipeObj) => ({
        recipe: normalizeId(customRecipeObj.recipe),
        quantity: customRecipeObj.quantity ?? null,
        quantityCooked: customRecipeObj.quantityCooked ?? null,
        ...(trainerId ? { assignedByTrainerId: trainerId } : {}),
        addedCustomProducts: (
          customRecipeObj.addedCustomProducts ||
          customRecipeObj.additionalCustomProducts ||
          []
        ).map(cloneCustomProductPayload),
        modifiedBaseCustomProducts: (
          customRecipeObj.modifiedBaseCustomProducts ||
          customRecipeObj.customProductsOverrides ||
          []
        )
          .map((override) => {
            const payload = cloneCustomProductPayload(override);
            payload.baseCustomProductId = normalizeId(
              payload.baseCustomProductId || payload.customProductId,
            );
            delete payload.customProductId;
            delete payload.removed;
            return payload;
          })
          .filter((override) => override.baseCustomProductId),
        removedBaseCustomProductIds: (
          customRecipeObj.removedBaseCustomProductIds ||
          (customRecipeObj.customProductsOverrides || [])
            .filter((override) => override.removed)
            .map((override) => override.customProductId) ||
          []
        )
          .map((removedId) => normalizeId(removedId))
          .filter(Boolean),
      });

      const clipboardCustomProducts = mealClipboard.customProducts || [];
      const clipboardCustomRecipes = mealClipboard.customRecipes || [];

      const targetCustomProducts = mealToPaste.customProducts || [];
      const targetCustomRecipes = mealToPaste.customRecipes || [];

      const customProductsToCreate = clipboardCustomProducts.map((cp) => {
        const cpObj = toPlainObject(cp);
        delete cpObj._id;
        if (trainerId) cpObj.assignedByTrainerId = trainerId;
        return cpObj;
      });

      const newCustomProducts = customProductsToCreate.length
        ? await customProductSchema.insertMany(customProductsToCreate)
        : [];

      const newCustomRecipes = [];

      for (const customRecipeRef of clipboardCustomRecipes) {
        const customRecipeObj = toPlainObject(customRecipeRef);
        const recipeId = normalizeId(
          customRecipeObj.recipe,
        );

        if (!recipeId) {
          continue;
        }

        const newCustomRecipe = await customRecipeDao.createCustomRecipe(
          buildCustomRecipeClonePayload(customRecipeObj),
        );

        newCustomRecipes.push(newCustomRecipe);
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
            $in: targetCustomRecipes
              .map((customRecipeTemp) => normalizeId(customRecipeTemp))
              .filter(Boolean),
          },
        });
      }

      const targetCustomProductIds = merge
        ? targetCustomProducts
            .map((customProductTemp) => normalizeId(customProductTemp))
            .filter(Boolean)
        : [];

      const targetCustomRecipeIds = merge
        ? targetCustomRecipes
            .map((customRecipeTemp) => normalizeId(customRecipeTemp))
            .filter(Boolean)
        : [];

      const updatePayload = {
        customProducts: targetCustomProductIds.concat(
          newCustomProducts.map((cp) => cp._id),
        ),
        customRecipes: targetCustomRecipeIds.concat(
          newCustomRecipes.map((customRecipe) => customRecipe._id),
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

  // Pautados sobreviven — antes borraba TODOS los customProducts de la
  // comida sin distinción; con items pautados individuales (ver
  // pasteMeal/assignedByTrainerId de arriba), un "vaciar comida" del
  // cliente ya no puede llevarse por delante lo que pautó su profesional
  // (mismo criterio que meal-service.js#assertMealEditable, a nivel de item).
  async deleteMealCustomProducts(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const deletableIds = [];
        const keptIds = [];
        for (const productTemp of doc.customProducts) {
          const productId = productTemp._id || productTemp;
          if (productTemp?.assignedByTrainerId) keptIds.push(productId);
          else deletableIds.push(productId);
        }
        customProductSchema.deleteMany(
          { _id: { $in: deletableIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            mealSchema.findByIdAndUpdate(
              id,
              { $set: { customProducts: keptIds } },
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
    // Prioridad 1: calidad de coincidencia (exacto > empieza por > contiene)
    const scoreA = calculateMatchScore(a.name, searchTerms);
    const scoreB = calculateMatchScore(b.name, searchTerms);

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    // Prioridad 2 (desempate): productos españoles primero
    const isSpanishA = a.code && a.code.startsWith("84") ? 1 : 0;
    const isSpanishB = b.code && b.code.startsWith("84") ? 1 : 0;

    if (isSpanishA !== isSpanishB) {
      return isSpanishB - isSpanishA;
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

module.exports.addMealCustomRecipe = async function (
  idMeal,
  idCustomRecipe,
) {
  return mealSchema.findByIdAndUpdate(
    idMeal,
    { $push: { customRecipes: idCustomRecipe } },
    { new: true },
  );
};

module.exports.deleteMealCustomRecipe = async function (
  idMeal,
  idCustomRecipe,
) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  // Remove from meal
  const meal = await mealSchema.findByIdAndUpdate(
    idMeal,
    { $pull: { customRecipes: idCustomRecipe } },
    { new: true },
  );

  // Delete the customRecipe document
  await CustomRecipe.findByIdAndDelete(idCustomRecipe);

  return meal;
};

// Pautadas sobreviven — mismo criterio que deleteMealCustomProducts de
// arriba (ver ese comentario).
module.exports.deleteMealCustomRecipes = async function (id) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  const meal = await mealSchema.findById(id);
  const deletableIds = [];
  const keptIds = [];
  for (const recipeTemp of meal?.customRecipes || []) {
    const recipeId = recipeTemp._id || recipeTemp;
    if (recipeTemp?.assignedByTrainerId) keptIds.push(recipeId);
    else deletableIds.push(recipeId);
  }

  if (deletableIds.length > 0) {
    await CustomRecipe.deleteMany({ _id: { $in: deletableIds } });
  }

  return mealSchema.findByIdAndUpdate(
    id,
    { $set: { customRecipes: keptIds } },
    { new: true },
  );
};
