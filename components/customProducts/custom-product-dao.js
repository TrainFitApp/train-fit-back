const customProductSchema = require("./custom-product-schema");
const mealSchema = require("../meals/meal-schema");
const userSchema = require("../users/schema");
const productSchema = require("../products/product-schema");
const dietDaySchema = require("../dietDays/diet-days-schema");
const dietDayModel = require("../dietDays/diet-days-service");
const dietSchema = require("../diets/diet-schema");
const dietModel = require("../diets/diet-model");
const mealModel = require("../meals/meal-service");
const dietDayUtil = require("../dietDays/diet-days-util");
const isUnsettable = (value) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

const cleanForCreate = (payload = {}) => {
  const cleaned = {};
  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (isUnsettable(value)) return;
    cleaned[key] = value;
  });
  return cleaned;
};

const toSetUnsetUpdate = (payload = {}) => {
  const $set = {};
  const $unset = {};

  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (isUnsettable(value)) {
      $unset[key] = "";
      return;
    }
    $set[key] = value;
  });

  const updateQuery = {};
  if (Object.keys($set).length) updateQuery.$set = $set;
  if (Object.keys($unset).length) updateQuery.$unset = $unset;
  return updateQuery;
};

module.exports = {
  async findCustomProductById(id) {
    return new Promise((resolve, reject) =>
      customProductSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  //   async getProductByBarCode(barcode) {
  //     return new Promise((resolve, reject) =>
  //       productSchema
  //         .findOne({ code: barcode })
  //         .exec((err, doc) => {
  //           if (err) return reject(err);
  //           return resolve(doc);
  //         })
  //     );
  //   },

  //   async getProductsByUser(page, limit) {
  //     return new Promise((resolve, reject) =>
  //       productSchema
  //         .find({})
  //         .skip(page * limit)
  //         .limit(limit)
  //         .exec((err, docs) => {
  //           if (err) return reject(err);
  //           return resolve(docs);
  //         })
  //     );
  //   },

  //   async getSearchProduct(page, limit, search) {
  //     return new Promise((resolve, reject) =>
  //       productSchema
  //         .find({ name: { $regex: search, $options: "i" } })
  //         .skip(page * limit)
  //         .limit(limit)
  //         .exec((err, docs) => {
  //           if (err) return reject(err);
  //           return resolve(docs);
  //         })
  //     );
  //   },

  async createCustomProductAndAddToMeal(idMeal, customProduct, idUser) {
    try {
      // Limpiar datos del custom product
      const cleanedCustomProduct = cleanForCreate(customProduct);

      // Si viene un producto inline unificado (product), lo guardamos en Product.
      if (
        idUser &&
        cleanedCustomProduct.product &&
        !cleanedCustomProduct.product._id
      ) {
        const productDoc = await productSchema.create({
          ...cleanedCustomProduct.product,
          userId: idUser,
        });
        cleanedCustomProduct.product = productDoc._id;
      }

      const customProductDoc =
        await customProductSchema.create(cleanedCustomProduct);

      let setCustomProduct = { $set: { mealId: idMeal } };
      if (cleanedCustomProduct.product && cleanedCustomProduct.product._id) {
        setCustomProduct.$set.product = cleanedCustomProduct.product;
      }

      await customProductSchema.findByIdAndUpdate(
        customProductDoc._id,
        setCustomProduct,
      );
      await mealSchema.findByIdAndUpdate(idMeal, {
        $push: { customProducts: customProductDoc._id },
      });

      return customProductDoc;
    } catch (error) {
      throw error;
    }
  },

  async updateCustomProduct(customProduct) {
    return new Promise((resolve, reject) => {
      const { _id, ...data } = customProduct;
      const updateQuery = toSetUnsetUpdate(data);

      if (
        !updateQuery ||
        (!updateQuery.$set && !updateQuery.$unset)
      ) {
        return customProductSchema.findById(_id, (findErr, currentDoc) => {
          if (findErr) return reject(findErr);
          return resolve(currentDoc);
        });
      }

      customProductSchema.findByIdAndUpdate(
        _id,
        updateQuery,
        { new: true },
        (err, doc) => {
          if (err) return reject(err);
          return resolve(doc);
        },
      );
    });
  },

  async delete(id) {
    return new Promise((resolve, reject) =>
      customProductSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve();
      }),
    );
  },
};
