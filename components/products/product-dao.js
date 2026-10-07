const productSchema = require("./product-schema");
const mongoose = require("mongoose");

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
  // Catálogo global paginado (panel de admin). Antes era un $addFields +
  // $sort por `name` sobre la colección entera: con millones de productos eso
  // es un recorrido completo más una ordenación en memoria que revienta el
  // límite de 100MB de $sort. Ahora va por el índice de `nameNormalized`.
  async getProducts(page, limit) {
    const pageValue = Math.max(0, parseInt((page || 0).toString(), 10) || 0);
    const limitValue = Math.max(1, parseInt((limit || 10).toString(), 10) || 10);

    return productSchema
      .find({ userId: null })
      .sort({ nameNormalized: 1, _id: 1 })
      .skip(pageValue * limitValue)
      .limit(limitValue)
      .lean()
      .exec();
  },

  // Varios productos por id, en plano (para comparar contra su base).
  async findManyByIds(ids) {
    if (!ids?.length) return [];
    return productSchema.find({ _id: { $in: ids } }).lean();
  },

  async getProduct(id) {
    return productSchema.findById(id);
  },

  /**
   * Buscar un producto por código de barras.
   * Primero busca en los productos del usuario (userId == idUser), luego en los globales.
   */
  async getProductByCode(userId, barcode) {
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
  },

  async getProductsCount() {
    return await productSchema.countDocuments({ userId: null });
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

    // Los derivados de búsqueda los pone el schema (hook pre-save).
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

    // Los campos derivados de búsqueda los mantiene el schema (hooks de
    // product-schema.js). Aquí solo hay que mantenerlos FUERA del juego
    // genérico de $set/$unset: con `unsetMissingFields` y la lista completa
    // de campos del schema, editar solo las kcal de un producto hacía
    // $unset de nameNormalized y searchTokens y dejaba el producto
    // invisible para la búsqueda.
    const derivedSearchFields = [
      "nameNormalized",
      "brandNormalized",
      "searchTokens",
    ];

    derivedSearchFields.forEach((field) => delete productData[field]);

    const allProductFields = Object.keys(productSchema.schema.paths).filter(
      (field) =>
        field !== "_id" &&
        field !== "__v" &&
        !derivedSearchFields.includes(field),
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
      excludeFields: derivedSearchFields,
      unsetMissingFields: true,
      allFields: allProductFields,
      protectedUnsetFields: ["userId", "verified", ...derivedSearchFields],
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
    return await productSchema.findByIdAndUpdate(
      id,
      { $unset: { userId: "" }, $set: { verified: true } },
      { new: true },
    );
  },

  async deleteProduct(id) {
    return await productSchema.deleteOne({ _id: id });
  },
};
