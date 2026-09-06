const customProductSchema = require("./custom-product-schema");
const mealSchema = require("../meals/meal-schema");
const userSchema = require("../users/schema");
const productSchema = require("../products/product-schema");
const dietDaySchema = require("../dietDays/diet-days-schema");
const mealModel = require("../meals/meal-service");
const dietDayUtil = require("../dietDays/diet-days-util");
const CUSTOM_PRODUCT_NUTRITION_FIELDS = [
  "energyKcal100g",
  "protein100g",
  "carbohydrates100g",
  "fat100g",
  "saturatedFat100g",
  "sugars100g",
  "fiber100g",
  "salt100g",
  "sodium100g",
  "cholesterol100g",
  "transFat100g",
  "calcium100g",
  "iron100g",
  "magnesium100g",
  "phosphorus100g",
  "potassium100g",
  "zinc100g",
  "copper100g",
  "manganese100g",
  "selenium100g",
  "iodine100g",
  "vitaminA100g",
  "vitaminC100g",
  "vitaminD100g",
  "vitaminE100g",
  "vitaminK100g",
  "vitaminB1100g",
  "vitaminB2100g",
  "vitaminB3100g",
  "vitaminB5100g",
  "vitaminB6100g",
  "vitaminB9100g",
  "vitaminB12100g",
  "biotin100g",
  "omega3100g",
  "omega6100g",
  "omega9100g",
  "caffeine100g",
  "taurine100g",
  "alcohol100g",
];

const isBlankString = (value) =>
  typeof value === "string" && value.trim() === "";

const hasOwn = (object, key) =>
  !!object && Object.prototype.hasOwnProperty.call(object, key);

const areValuesEqual = (left, right, epsilon = 1e-9) => {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) < epsilon;
  }
  return false;
};

const cleanForCreate = (payload = {}) => {
  const cleaned = {};
  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (value === undefined) return;
    if (isBlankString(value)) return;
    cleaned[key] = value;
  });
  return cleaned;
};

const buildCustomProductUpdate = (currentDoc, payload = {}) => {
  const $set = {};
  const $unset = {};

  Object.keys(payload).forEach((key) => {
    if (key === "_id" || CUSTOM_PRODUCT_NUTRITION_FIELDS.includes(key)) {
      return;
    }

    const value = payload[key];

    if (value === undefined) {
      return;
    }

    if (isBlankString(value)) {
      $unset[key] = "";
      return;
    }

    $set[key] = value;
  });

  CUSTOM_PRODUCT_NUTRITION_FIELDS.forEach((field) => {
    if (!hasOwn(payload, field)) {
      $unset[field] = "";
      return;
    }

    const value = payload[field];
    const baseValue = currentDoc?.product?.[field];

    if (value === undefined || isBlankString(value)) {
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
      customProductSchema.findById(_id, (findErr, currentDoc) => {
        if (findErr) return reject(findErr);
        if (!currentDoc) return resolve(null);

        const updateQuery = buildCustomProductUpdate(currentDoc, data);

        if (!updateQuery || (!updateQuery.$set && !updateQuery.$unset)) {
          return resolve(currentDoc);
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

  // Marcar/desmarcar consumido — nunca bloqueado por assignedByTrainerId
  // (ver custom-product-schema.js): seguimiento y composición son
  // conceptos distintos, mismo criterio que Meal.completed.
  async setConsumed(id, consumed) {
    return customProductSchema.findByIdAndUpdate(
      id,
      { $set: { consumed: Boolean(consumed) } },
      { new: true },
    );
  },
};
