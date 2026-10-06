const productDao = require("./product-dao");

module.exports = {
  async getProducts(page, limit) {
    return productDao.getProducts(page, limit);
  },

  async getProductByCode(userId, barcode) {
    return productDao.getProductByCode(userId, barcode);
  },

  async getProduct(id) {
    return productDao.getProduct(id);
  },

  async getProductsCount() {
    return productDao.getProductsCount();
  },

  async searchProduct(page, limit, search, userId) {
    return productDao.searchProduct(page, limit, search, userId);
  },

  async createProduct(product) {
    return productDao.createProduct(product);
  },

  async updateProduct(product) {
    return productDao.updateProduct(product);
  },

  async promoteToGlobal(id) {
    return productDao.promoteToGlobal(id);
  },

  async addFavouriteProduct(idUser, idProduct, productExist) {
    return productDao.addFavoriteProduct(idUser, idProduct, productExist);
  },

  async deleteProduct(id) {
    return productDao.deleteProduct(id);
  },
};
