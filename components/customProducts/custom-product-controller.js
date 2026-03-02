const customProductModel = require("./custom-product-model");
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
    const customProduct = await customProductModel.updateCustomProduct(
      req.body
    );

    return res.send(customProduct);
  },

  async delete(req, res) {
    await customProductModel.delete(req.params.id);
    res.sendStatus(204);
  },
};
