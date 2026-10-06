const productService = require("./product-service");
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
    const products = await productService.getProducts(page, limit);
    return res.send(products);
  },

  // Los productos propios que se buscan por código son los del usuario del
  // token.
  async getProductByCode(req, res) {
    const product = await productService.getProductByCode(
      req.user.id,
      req.params.barcode,
    );
    return res.send(product);
  },

  async getProductsCount(req, res) {
    const count = await productService.getProductsCount();
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
    const products = await productService.searchProduct(
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

    const product = await productService.createProduct(payload);
    return res.send(product);
  },

  /**
   * Actualizar producto (soporta tanto productos globales como productos de usuario).
   */
  async updateProduct(req, res) {
    const existing = await productService.getProduct(req.body?._id);
    if (!existing) return res.sendStatus(404);

    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).send({
        message: "No tienes permiso para editar este producto.",
      });
    }

    const updatedProduct = await productService.updateProduct(req.body);
    return res.send(updatedProduct);
  },

  /**
   * Promueve un producto de usuario a producto global (elimina userId, marca como verified).
   * Equivalente al antiguo "toProduct" de ownProducts.
   */
  async promoteToGlobal(req, res) {
    if (!isAdmin(req)) return res.sendStatus(403);
    const product = await productService.promoteToGlobal(req.params.id);
    return res.send(product);
  },

  async deleteProduct(req, res) {
    const existing = await productService.getProduct(req.params.id);
    if (!existing) return res.sendStatus(404);

    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).send({
        message: "No tienes permiso para borrar este producto.",
      });
    }

    await productService.deleteProduct(req.params.id);
    res.sendStatus(204);
  },
};
