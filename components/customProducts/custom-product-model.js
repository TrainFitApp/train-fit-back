const customProductDao = require("./custom-product-dao");

module.exports = {
  async getCustomProductById(id) {
    return customProductDao.findCustomProductById(id);
  },

  //   async getProductByBarCode(barcode) {
  //     return productDao.getProductByBarCode(barcode);
  //   },
  
  //   async getSearchProduct(page, limit, search) {
  //     return productDao.getSearchProduct(page, limit, search);
  //   },

  //   async getProduct(id) {
  //     return productDao.getProduct(id);
  //   },

  async createCustomProductAndAddToMeal(idMeal, customProduct, idUser) {
    return customProductDao.createCustomProductAndAddToMeal(
      idMeal,
      customProduct,
      idUser
    );
  },

  async updateCustomProduct(customProduct) {
    return customProductDao.updateCustomProduct(customProduct);
  },

  async delete(id) {
    return customProductDao.delete(id);
  },
};
