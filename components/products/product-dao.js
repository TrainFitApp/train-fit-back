const productSchema = require("./product-schema");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const mongoose = require("mongoose");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
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
      const globalProduct = await productSchema.findOne({ code: barcode, userId: null });
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
      const docs = await productSchema.aggregate([
        { $match: { name: { $regex: search, $options: "i" }, userId: null } },
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
      return docs;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Crear un producto. Si se pasa userId, será un producto del usuario.
   */
  async createProduct(product) {
    // Filtrar campos null, 0 o vacíos
    const cleanedProduct = {};
    Object.keys(product).forEach((key) => {
      const val = product[key];
      if (val !== null && val !== undefined && val !== 0 && val !== "") {
        cleanedProduct[key] = val;
      }
    });

    return await productSchema.create(cleanedProduct);
  },

  /**
   * Actualizar producto con lógica robusta ($set/$unset).
   */
  async updateProduct(product) {
    const { _id, ...productData } = product;

    const criticalFields = ["name", "energyKcal100g", "protein100g", "carbohydrates100g", "fat100g"];
    const booleanFields = ["vegan", "vegetarian", "lactoseFree", "glutenFree", "verified"];

    const toSet = {};
    const toUnset = {};

    Object.keys(productData).forEach((key) => {
      const val = productData[key];

      if (booleanFields.includes(key)) {
        if (val) toSet[key] = true;
        else toUnset[key] = "";
        return;
      }

      if (criticalFields.includes(key)) {
        if (val !== null && val !== undefined && val !== "") toSet[key] = val;
        return;
      }

      if (val === null || val === undefined || val === 0 || val === "") {
        toUnset[key] = "";
      } else {
        toSet[key] = val;
      }
    });

    const queryUpdate = {};
    if (Object.keys(toSet).length > 0) queryUpdate.$set = toSet;
    if (Object.keys(toUnset).length > 0) queryUpdate.$unset = toUnset;

    if (Object.keys(queryUpdate).length === 0) {
      return await productSchema.findById(_id);
    }

    return await productSchema.findByIdAndUpdate(_id, queryUpdate, { new: true });
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
        { new: true }
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
