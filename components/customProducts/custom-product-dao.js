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
const { cleanObject } = require("../util/clean-data");

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
      const cleanedCustomProduct = cleanObject(customProduct);

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
      const cleanedData = cleanObject(data);
      customProductSchema.findByIdAndUpdate(
        _id,
        cleanedData,
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
