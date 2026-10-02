const productModel = require("./product-model");
const productDTO = require("./product-dto");

function isAdmin(req) {
  const roles = req?.userData?.roles || [];
  return roles.includes("admin");
}

function isOwner(product, req) {
  const ownerId = product?.userId?.toString?.();
  return !!ownerId && ownerId === req?.user?.id;
}

module.exports = {
  async getProducts(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const products = await productModel.getProducts(page, limit);
    return res.send(products);
  },

  // Los productos propios que se buscan por código son los del usuario del
  // token: el :userId de la URL se conserva por compatibilidad y se ignora
  // (antes devolvía el producto privado de otro con ese código de barras).
  async getProductByCode(req, res) {
    const product = await productModel.getProductByCode(
      req.user.id,
      req.params.barcode,
    );
    return res.send(product);
  },

  async getProductsCount(req, res) {
    const count = await productModel.getProductsCount();
    return res.send(count);
  },

  // Replanteamiento MVP (nutrición) — este endpoint nunca funcionó vía HTTP
  // para NINGÚN llamador real: express.json() usa "strict" por defecto
  // (app.js), que RECHAZA con 400 cualquier body JSON cuyo valor raíz no sea
  // un objeto/array — un body de solo texto (`req.body` como string crudo)
  // jamás llega a parsearse. Se corrige aceptando un objeto {search}, mismo
  // patrón ya usado (y ya funcional) por exercise-controller.js#getSearchExercise.
  async searchProduct(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const search = typeof req.body === "string" ? req.body : req.body?.search;
    // El usuario autenticado, para que también encuentre SUS productos: un
    // entrenador que crea un producto tiene que poder volver a buscarlo.
    const products = await productModel.searchProduct(
      page,
      limit,
      search,
      req?.user?.id,
    );
    return res.send(products);
  },

  /**
   * Crear un producto. Si se envía userId en el body, será un producto del usuario.
   */
  async createProduct(req, res) {
    const payload = { ...req.body };

    // Solo un admin crea productos globales (sin userId) o verificados. El
    // resto, siempre a su nombre y sin verificar, diga lo que diga el cuerpo
    // (antes, sin `userId` en el cuerpo, el producto nacía global).
    if (!isAdmin(req)) {
      payload.userId = req.user.id;
      payload.verified = false;
    } else if (Object.prototype.hasOwnProperty.call(payload, "userId")) {
      payload.userId = req.user.id;
    }

    const product = await productModel.createProduct(payload);
    return res.send(product);
  },

  /**
   * Actualizar producto (soporta tanto productos globales como productos de usuario).
   */
  async updateProduct(req, res) {
    const existing = await productModel.getProduct(req.body?._id);
    if (!existing) return res.sendStatus(404);

    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).send({
        message: "No tienes permiso para editar este producto.",
      });
    }

    const updatedProduct = await productModel.updateProduct(req.body);
    return res.send(updatedProduct);
  },

  /**
   * Promueve un producto de usuario a producto global (elimina userId, marca como verified).
   * Equivalente al antiguo "toProduct" de ownProducts.
   */
  async promoteToGlobal(req, res) {
    if (!isAdmin(req)) return res.sendStatus(403);
    const product = await productModel.promoteToGlobal(req.params.id);
    return res.send(product);
  },

  /**
   * Añadir/quitar producto de favoritos del usuario.
   * Ya no distingue entre ownProduct y product — todo va a archivedProducts.
   */
  async addFavoriteProduct(req, res) {
    if (!req.body.idProduct) return res.sendStatus(400);
    // Los favoritos son siempre del usuario del token: el idUser del cuerpo
    // (que las apps siguen mandando) se ignora. Antes se marcaban o quitaban
    // favoritos en nombre de cualquiera.
    const userId = req.user.id;

    const userModel = require("../users/model");
    const user = await userModel.getUserById(userId);

    const productExist = !!user.archivedProducts.find((apTemp) => {
      const id = apTemp.toString().match(/^[0-9a-fA-F]{24}$/);
      return id && id[0] === req.body.idProduct;
    });

    const updatedUser = await productModel.addFavouriteProduct(
      userId,
      req.body.idProduct,
      productExist,
    );

    return res.send({
      isFavorite: !productExist,
      message: !productExist
        ? "Product added to favorites"
        : "Product removed from favorites",
    });
  },

  async deleteProduct(req, res) {
    const existing = await productModel.getProduct(req.params.id);
    if (!existing) return res.sendStatus(404);

    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).send({
        message: "No tienes permiso para borrar este producto.",
      });
    }

    await productModel.deleteProduct(req.params.id);
    res.sendStatus(204);
  },
};
