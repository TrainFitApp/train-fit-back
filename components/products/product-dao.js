const productSchema = require("./product-schema");
const userSchema = require("../users/schema");
const aggregateService = require("../util/aggregate-service");
const mongoose = require("mongoose");
const { cleanObject, prepareUpdateQuery } = require("../util/clean-data");

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
      const docs = await productSchema.aggregate([
        { $match: { name: { $regex: search, $options: "i" }, userId: null } },
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
      return docs;
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
    return await productSchema.create(cleanedProduct);
  },

  /**
   * Actualizar producto con lógica robusta ($set/$unset).
   */
  async updateProduct(product) {
    const { _id, ...productData } = product;
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
