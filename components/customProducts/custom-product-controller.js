const customProductModel = require("./custom-product-model");
// TAREA (meals pautados) — sin esto, un cliente podía saltarse la
// protección de meal-controller.js (assertMealEditable a nivel de comida Y
// de item) llamando directamente a estos endpoints con el _id del
// CustomProduct pautado: esta ruta nunca pasaba por /meals/..., así que
// nunca comprobaba assignedByTrainerId. Reutiliza assertMealEditable/
// handleProtectedError de meal-service.js — mismo criterio que usa
// meal-controller.js, no una copia.
const mealService = require("../meals/meal-service");
const { assertMealEditable, handleProtectedError } = mealService;
const { resolveOwnedMealById } = require("../dietDays/diet-day-resolver");
// const customProductDTO = require("./dto");

const isAdmin = (req) => Boolean(req.auth?.roles?.includes("admin"));

// ¿Es mía la comida? Mismo criterio que meal-controller.js: la comida tiene
// que estar en un DietDay del usuario del token.
async function ownsMeal(req, mealId) {
  if (isAdmin(req)) return true;
  try {
    await resolveOwnedMealById(req.auth.userId, mealId);
    return true;
  } catch (e) {
    if (e.code === "MEAL_NOT_FOUND") return false;
    throw e;
  }
}

// Estas rutas solo las usa el diario (añadir, editar o quitar un alimento de
// una comida): el CustomProduct tiene que colgar de una comida del usuario.
// Antes bastaba con conocer el _id para leer, editar o borrar el alimento de
// cualquiera. Devuelve null (y la ruta responde 404) si no es suyo.
async function findOwnedCustomProduct(req, id) {
  const customProduct = await customProductModel.getCustomProductById(id);
  if (!customProduct) return null;
  if (isAdmin(req)) return customProduct;
  const mealId = await mealService.findMealIdContainingCustomProduct(customProduct._id);
  if (!mealId || !(await ownsMeal(req, mealId))) return null;
  return customProduct;
}

const NOT_FOUND = { message: "Alimento no encontrado", code: "CUSTOM_PRODUCT_NOT_FOUND" };

module.exports = {
  async getCustomProductById(req, res) {
    const customProduct = await findOwnedCustomProduct(req, req.params.id);
    if (!customProduct) return res.status(404).send(NOT_FOUND);
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

  // La comida destino tiene que ser del usuario, y el Product inline se
  // guarda a su nombre (nunca al del idUser del cuerpo).
  async createCustomProductAndAddToMeal(req, res) {
    if (!(await ownsMeal(req, req.body.idMeal))) {
      return res.status(400).send({ message: "La comida indicada no pertenece a tu dieta", code: "MEAL_NOT_FOUND" });
    }
    const customProduct =
      await customProductModel.createCustomProductAndAddToMeal(
        req.body.idMeal,
        req.body.customProduct,
        req.auth.userId
      );
    return res.send(customProduct);
  },

  async updateCustomProduct(req, res) {
    try {
      const existing = await findOwnedCustomProduct(req, req.body._id);
      if (!existing) return res.status(404).send(NOT_FOUND);
      assertMealEditable(existing);
      // Ni la marca de pautado ni la comida a la que cuelga se reescriben por
      // aquí (el front manda mealId porque es parte del objeto).
      const { assignedByTrainerId, assignedQuantity, mealId, customRecipeId, baseCustomProductId, ...changes } = req.body;
      const customProduct = await customProductModel.updateCustomProduct(changes);
      return res.send(customProduct);
    } catch (e) {
      const handled = handleProtectedError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async delete(req, res) {
    try {
      const existing = await findOwnedCustomProduct(req, req.params.id);
      if (!existing) return res.status(404).send(NOT_FOUND);
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
