const customProductModel = require("./custom-product-model");
const customProductSchema = require("./custom-product-schema");
const mealLock = require("../meals/meal-lock");
// const customProductDTO = require("./dto");

function isAdmin(req) {
  return Boolean(req.user?.roles?.includes("admin"));
}

function handleLockError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  throw error;
}

module.exports = {
  async getCustomProductById(req, res) {
    const customProduct = await customProductModel.getCustomProductById(
      req.params.id
    );
    return res.send(customProduct);
  },

  //   async getProductByBarCode(req, res) {
  //     const products = await productModel.getProductByBarCode(
  //       req.params.barcode
  //     );
  //     return res.send(products);
  //   },

  //   async getSearchProduct(req, res) {
  //     const page = parseInt((req.query.page || 0).toString(), 10);
  //     const limit = parseInt((req.query.limit || 10).toString(), 10);
  //     const products = await productModel.getSearchProduct(
  //       page,
  //       limit,
  //       req.params.search
  //     );
  //     return res.send(products);
  //   },

  // async createCustomProductOnNewDietDay(req, res) {
  //   const customProduct =
  //     await customProductModel.createCustomProductAndAddToMeal(
  //       req.params.idMeal,
  //       req.params.idProduct,
  //       req.body
  //     );
  //   return res.send(customProduct);
  // },

  async createCustomProductAndAddToMeal(req, res) {
    if (!isAdmin(req)) {
      try {
        await mealLock.assertMealEditable(req.body.idMeal, req.user.id);
      } catch (error) {
        return handleLockError(res, error);
      }
    }

    const customProduct =
      await customProductModel.createCustomProductAndAddToMeal(
        req.body.idMeal,
        req.body.customProduct,
        req.body.idUser
      );
    return res.send(customProduct);
  },

  async updateCustomProduct(req, res) {
    if (!isAdmin(req)) {
      try {
        const existing = await customProductSchema.findById(req.body._id).select("mealId");
        await mealLock.assertMealEditable(existing?.mealId, req.user.id);
      } catch (error) {
        return handleLockError(res, error);
      }
    }

    const customProduct = await customProductModel.updateCustomProduct(
      req.body
    );

    return res.send(customProduct);
  },

  async delete(req, res) {
    if (!isAdmin(req)) {
      try {
        const existing = await customProductSchema.findById(req.params.id).select("mealId");
        await mealLock.assertMealEditable(existing?.mealId, req.user.id);
      } catch (error) {
        return handleLockError(res, error);
      }
    }

    await customProductModel.delete(req.params.id);
    res.sendStatus(204);
  },
};
