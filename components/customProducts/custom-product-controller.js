const customProductModel = require("./custom-product-model");
// TAREA (meals pautados) — sin esto, un cliente podía saltarse la
// protección de meal-controller.js (assertMealEditable a nivel de comida Y
// de item) llamando directamente a estos endpoints con el _id del
// CustomProduct pautado: esta ruta nunca pasaba por /meals/..., así que
// nunca comprobaba assignedByTrainerId. Reutiliza assertMealEditable/
// handleProtectedError de meal-service.js — mismo criterio que usa
// meal-controller.js, no una copia.
const { assertMealEditable, handleProtectedError } = require("../meals/meal-service");
// const customProductDTO = require("./dto");

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
    const customProduct =
      await customProductModel.createCustomProductAndAddToMeal(
        req.body.idMeal,
        req.body.customProduct,
        req.body.idUser
      );
    return res.send(customProduct);
  },

  async updateCustomProduct(req, res) {
    try {
      const existing = await customProductModel.getCustomProductById(req.body._id);
      assertMealEditable(existing);
      const customProduct = await customProductModel.updateCustomProduct(
        req.body
      );
      return res.send(customProduct);
    } catch (e) {
      const handled = handleProtectedError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async delete(req, res) {
    try {
      const existing = await customProductModel.getCustomProductById(req.params.id);
      assertMealEditable(existing);
      await customProductModel.delete(req.params.id);
      res.sendStatus(204);
    } catch (e) {
      const handled = handleProtectedError(res, e);
      if (handled) return handled;
      throw e;
    }
  },
};
