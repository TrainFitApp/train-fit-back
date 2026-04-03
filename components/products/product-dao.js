const productSchema = require("./product-schema");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const mongoose = require("mongoose");
const { cleanObject, prepareUpdateQuery } = require("../util/clean-data");

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
                  $regexMatch: {
                    input: { $toString: { $ifNull: ["$code", ""] } },
                    regex: "^84",
                  },
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
      const trimmed = (typeof search === "string" ? search : "").trim();
      if (!trimmed) return [];

      const words = trimmed.split(/\s+/).filter(Boolean);

      // La última palabra puede estar incompleta (usuario tecleando) → $regex.
      // Las palabras anteriores ya están completas → $text (índice, acentos, rendimiento).
      const completeWords = words.slice(0, -1);
      const partialWord = words[words.length - 1];

      // Escapar caracteres especiales de regex para evitar inyección
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedFull = escapeRegex(trimmed);
      const escapedPartial = escapeRegex(partialWord);

      const isSpanishExpr = {
        $cond: {
          if: {
            $regexMatch: {
              input: { $toString: { $ifNull: ["$code", ""] } },
              regex: "^84",
            },
          },
          then: 1,
          else: 0,
        },
      };

      // Ranking de coincidencia sobre el término completo buscado:
      //   3 → nombre/marca exactamente igual al término
      //   2 → nombre/marca empieza por el término
      //   1 → nombre/marca contiene el término en cualquier posición
      const buildMatchRank = (escapedTerm) => ({
        $switch: {
          branches: [
            {
              case: {
                $or: [
                  { $regexMatch: { input: { $ifNull: ["$name", ""] }, regex: `^${escapedTerm}$`, options: "i" } },
                  { $regexMatch: { input: { $ifNull: ["$brand", ""] }, regex: `^${escapedTerm}$`, options: "i" } },
                ],
              },
              then: 3,
            },
            {
              case: {
                $or: [
                  { $regexMatch: { input: { $ifNull: ["$name", ""] }, regex: `^${escapedTerm}`, options: "i" } },
                  { $regexMatch: { input: { $ifNull: ["$brand", ""] }, regex: `^${escapedTerm}`, options: "i" } },
                ],
              },
              then: 2,
            },
          ],
          default: 1,
        },
      });

      // ── Caso A: 2+ palabras ─────────────────────────────────────────────────
      // $text busca las palabras completas en el índice (name + brand, con pesos).
      // $or filtra además que la palabra parcial aparezca en name o brand.
      if (completeWords.length > 0) {
        const textQuery = completeWords.map((w) => `"${w}"`).join(" ");
        const partialRegex = { $regex: escapedPartial, $options: "i" };

        return await productSchema.aggregate([
          {
            $match: {
              $text: { $search: textQuery },
              userId: null,
              $or: [{ name: partialRegex }, { brand: partialRegex }],
            },
          },
          {
            $addFields: {
              score: { $meta: "textScore" },
              isSpanish: isSpanishExpr,
              matchRank: buildMatchRank(escapedFull),
            },
          },
          // Orden: exacto primero → empieza por → contiene → españoles → verificados → relevancia → alfabético
          { $sort: { matchRank: -1, isSpanish: -1, verified: -1, score: -1, name: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          { $project: { isSpanish: 0, score: 0, matchRank: 0 } },
        ]);
      }

      // ── Caso B: 1 sola palabra (puede ser parcial) ──────────────────────────
      // $text no es útil para prefijos parciales → $regex en name y brand.
      const partialRegex = { $regex: escapedPartial, $options: "i" };
      return await productSchema.aggregate([
        {
          $match: {
            userId: null,
            $or: [{ name: partialRegex }, { brand: partialRegex }],
          },
        },
        {
          $addFields: {
            isSpanish: isSpanishExpr,
            matchRank: buildMatchRank(escapedFull),
          },
        },
        // Orden: exacto primero → empieza por → contiene → españoles → verificados → alfabético
        { $sort: { matchRank: -1, isSpanish: -1, verified: -1, name: 1 } },
        { $skip: page * limit },
        { $limit: limit },
        { $project: { isSpanish: 0, matchRank: 0 } },
      ]);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Crear un producto. Si se pasa userId, será un producto del usuario.
   */
  async createProduct(product) {
    // Usar utility centralizado para limpiar datos
    const cleanedProduct = cleanObject(product);
    const normalizedUserId = normalizeUserId(cleanedProduct.userId);

    if (normalizedUserId) {
      cleanedProduct.userId = normalizedUserId;
    } else {
      delete cleanedProduct.userId;
    }

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

    const queryUpdate = prepareUpdateQuery(productData, options);

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
