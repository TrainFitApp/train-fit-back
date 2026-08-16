const productSchema = require("./product-schema");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const mongoose = require("mongoose");
const {
  buildSearchFields,
  normalizeSearchText,
  splitSearchTokens,
  hasEditDistanceOneOrLess,
} = require("../util/search-index");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function normalizeUserId(rawUserId) {
  if (!rawUserId) return null;

  if (
    typeof rawUserId === "object" &&
    rawUserId !== null &&
    Object.prototype.hasOwnProperty.call(rawUserId, "_id")
  ) {
    return toObjectId(rawUserId._id);
  }

  return toObjectId(rawUserId);
}

function cleanProductObject(data, excludeFields = []) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const cleaned = {};

  Object.keys(data).forEach((key) => {
    if (excludeFields.includes(key)) {
      cleaned[key] = data[key];
      return;
    }

    const value = data[key];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === false
    ) {
      return;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      const nestedValue = cleanProductObject(value, excludeFields);

      if (
        nestedValue &&
        typeof nestedValue === "object" &&
        !Array.isArray(nestedValue) &&
        Object.keys(nestedValue).length === 0
      ) {
        return;
      }

      cleaned[key] = nestedValue;
      return;
    }

    cleaned[key] = value;
  });

  return cleaned;
}

function prepareProductUpdateQuery(data, options = {}) {
  if (!data || typeof data !== "object") {
    return {};
  }

  const {
    booleanFields = [],
    criticalFields = [],
    excludeFields = [],
    unsetMissingFields = false,
    allFields = [],
    protectedUnsetFields = [],
  } = options;

  const toSet = {};
  const toUnset = {};

  Object.keys(data).forEach((key) => {
    if (excludeFields.includes(key)) return;

    const value = data[key];

    if (booleanFields.includes(key)) {
      if (value) {
        toSet[key] = true;
      } else {
        toUnset[key] = "";
      }
      return;
    }

    if (criticalFields.includes(key)) {
      if (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        value !== false
      ) {
        toSet[key] = value;
      }
      return;
    }

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === false
    ) {
      toUnset[key] = "";
      return;
    }

    toSet[key] = value;
  });

  if (unsetMissingFields && Array.isArray(allFields) && allFields.length > 0) {
    allFields.forEach((field) => {
      if (excludeFields.includes(field)) return;
      if (protectedUnsetFields.includes(field)) return;
      if (criticalFields.includes(field)) return;
      if (Object.prototype.hasOwnProperty.call(data, field)) return;
      toUnset[field] = "";
    });
  }

  const queryUpdate = {};
  if (Object.keys(toSet).length > 0) queryUpdate.$set = toSet;
  if (Object.keys(toUnset).length > 0) queryUpdate.$unset = toUnset;

  return queryUpdate;
}

module.exports = {
  async getProducts(page, limit) {
    try {
      return await productSchema.aggregate([
        { $match: { userId: null } }, // Solo productos globales (sin userId)
        {
          $addFields: {
            isSpanish: {
              $cond: {
                if: {
                  $eq: [
                    {
                      $substrCP: [{ $toString: { $ifNull: ["$code", ""] } }, 0, 2],
                    },
                    "84",
                  ],
                },
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
    } catch (err) {
      throw err;
    }
  },

  async getProduct(id) {
    return productSchema.findById(id);
  },

  /**
   * Buscar un producto por código de barras.
   * Primero busca en los productos del usuario (userId == idUser), luego en los globales.
   */
  async getProductByCode(userId, barcode) {
    try {
      const userObjectId = toObjectId(userId);
      // 1. Buscar en productos propios del usuario
      if (userObjectId) {
        const ownProduct = await productSchema.findOne({
          code: barcode,
          userId: userObjectId,
        });
        if (ownProduct) {
          return { product: ownProduct, isOwn: true };
        }
      }

      // 2. Buscar en productos globales
      const globalProduct = await productSchema.findOne({
        code: barcode,
        userId: null,
      });
      return { product: globalProduct || null, isOwn: false };
    } catch (err) {
      throw err;
    }
  },

  async getProductsCount() {
    try {
      return await productSchema.countDocuments({ userId: null });
    } catch (err) {
      throw err;
    }
  },

  async searchProduct(page, limit, search) {
    try {
      // Acepta tanto el string plano histórico (req.body === "término",
      // Content-Type text/plain) como un objeto {search: "término"} — un
      // cliente que envíe application/json con un string en la raíz choca
      // con el modo strict de express.json() y nunca llega aquí, así que en
      // la práctica solo el segundo formato es fiable sobre HTTP.
      const rawSearch =
        typeof search === "string" ? search : search?.search;
      const trimmed = (typeof rawSearch === "string" ? rawSearch : "").trim();
      if (!trimmed) return [];
      const normalizedQuery = normalizeSearchText(trimmed);
      if (!normalizedQuery) return [];

      const skipValue = Math.max(0, parseInt((page || 0).toString(), 10)) * limit;
      const queryTerms = splitSearchTokens(trimmed);
      const typoEnabled = normalizedQuery.length > 2;
      const candidateCap = 250;

      const candidates = new Map();
      const upsertCandidate = (doc, score) => {
        if (!doc?._id) return;
        const key = String(doc._id);
        const current = candidates.get(key);
        if (!current || score > current.score) {
          candidates.set(key, { doc, score });
        }
      };

      const [exactDocs, prefixDocs, textDocs] = await Promise.all([
        productSchema
          .find({
            userId: null,
            $or: [
              { nameNormalized: normalizedQuery },
              { brandNormalized: normalizedQuery },
            ],
          })
          .limit(candidateCap)
          .lean()
          .exec(),
        productSchema
          .find({
            userId: null,
            $or: [{ namePrefixes: normalizedQuery }, { brandPrefixes: normalizedQuery }],
          })
          .limit(candidateCap)
          .lean()
          .exec(),
        productSchema
          .find(
            { userId: null, $text: { $search: trimmed } },
            { score: { $meta: "textScore" } },
          )
          .sort({ score: { $meta: "textScore" } })
          .limit(candidateCap)
          .lean()
          .exec(),
      ]);

      for (const doc of exactDocs) {
        const exactName = doc.nameNormalized === normalizedQuery;
        const score = exactName ? 100000 : 90000;
        upsertCandidate(doc, score);
      }

      for (const doc of prefixDocs) {
        const prefixInName = Array.isArray(doc.namePrefixes)
          ? doc.namePrefixes.includes(normalizedQuery)
          : false;
        const score = prefixInName ? 70000 : 60000;
        upsertCandidate(doc, score);
      }

      for (const doc of textDocs) {
        const textScore = Number(doc.score || 0);
        upsertCandidate(doc, 40000 + textScore * 1000);
      }

      const scored = Array.from(candidates.values()).map(({ doc, score }) => {
        let total = score;
        const nameTokens = splitSearchTokens(doc.nameNormalized || doc.name);
        const brandTokens = splitSearchTokens(doc.brandNormalized || doc.brand);

        for (const term of queryTerms) {
          if (nameTokens.includes(term)) total += 2000;
          else if (nameTokens.some((token) => token.startsWith(term))) total += 800;

          if (brandTokens.includes(term)) total += 1200;
          else if (brandTokens.some((token) => token.startsWith(term))) total += 400;

          if (typoEnabled) {
            if (nameTokens.some((token) => hasEditDistanceOneOrLess(token, term))) {
              total += 500;
            }
            if (brandTokens.some((token) => hasEditDistanceOneOrLess(token, term))) {
              total += 250;
            }
          }
        }

        return { doc, score: total };
      });

      scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const isSpanishA = a.doc.code?.startsWith("84") ? 1 : 0;
        const isSpanishB = b.doc.code?.startsWith("84") ? 1 : 0;
        if (isSpanishA !== isSpanishB) return isSpanishB - isSpanishA;
        const verifiedA = a.doc.verified ? 1 : 0;
        const verifiedB = b.doc.verified ? 1 : 0;
        if (verifiedA !== verifiedB) return verifiedB - verifiedA;
        const nameOrder = (a.doc.name || "").localeCompare(b.doc.name || "");
        if (nameOrder !== 0) return nameOrder;
        return String(a.doc._id).localeCompare(String(b.doc._id));
      });

      return scored.slice(skipValue, skipValue + limit).map((item) => item.doc);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Crear un producto. Si se pasa userId, será un producto del usuario.
   */
  async createProduct(product) {
    // Usar utility centralizado para limpiar datos
    const cleanedProduct = cleanProductObject(product);
    const normalizedUserId = normalizeUserId(cleanedProduct.userId);

    if (normalizedUserId) {
      cleanedProduct.userId = normalizedUserId;
    } else {
      delete cleanedProduct.userId;
    }

    Object.assign(cleanedProduct, buildSearchFields(cleanedProduct));

    return await productSchema.create(cleanedProduct);
  },

  /**
   * Actualizar producto con lógica robusta ($set/$unset).
   */
  async updateProduct(product) {
    const { _id, ...productData } = product;

    if (Object.prototype.hasOwnProperty.call(productData, "userId")) {
      const normalizedUserId = normalizeUserId(productData.userId);
      if (normalizedUserId) {
        productData.userId = normalizedUserId;
      } else {
        delete productData.userId;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(productData, "name") ||
      Object.prototype.hasOwnProperty.call(productData, "brand")
    ) {
      Object.assign(productData, buildSearchFields(productData));
    }

    const allProductFields = Object.keys(productSchema.schema.paths).filter(
      (field) => field !== "_id" && field !== "__v",
    );

    const options = {
      booleanFields: [
        "vegan",
        "vegetarian",
        "lactoseFree",
        "glutenFree",
        "verified",
      ],
      criticalFields: [
        "name",
        "energyKcal100g",
        "protein100g",
        "carbohydrates100g",
        "fat100g",
      ],
      unsetMissingFields: true,
      allFields: allProductFields,
      protectedUnsetFields: ["userId", "verified"],
    };

    const queryUpdate = prepareProductUpdateQuery(productData, options);

    if (Object.keys(queryUpdate).length === 0) {
      return await productSchema.findById(_id);
    }

    return await productSchema.findByIdAndUpdate(_id, queryUpdate, {
      new: true,
    });
  },

  /**
   * Promueve un producto de usuario a producto global (elimina userId).
   * Equivalente al antiguo "toProduct".
   */
  async promoteToGlobal(id) {
    try {
      return await productSchema.findByIdAndUpdate(
        id,
        { $unset: { userId: "" }, $set: { verified: true } },
        { new: true },
      );
    } catch (err) {
      throw err;
    }
  },

  async addFavoriteProduct(idUser, idProduct, productExist) {
    const query = productExist
      ? { $pull: { archivedProducts: idProduct } }
      : { $push: { archivedProducts: idProduct } };
    return await userSchema.findByIdAndUpdate(idUser, query, { new: true });
  },

  async deleteProduct(id) {
    try {
      return await productSchema.deleteOne({ _id: id });
    } catch (err) {
      throw err;
    }
  },
};
