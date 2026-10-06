const productSchema = require("../products/product-schema");
const mealStore = require("../meals/meal-store");
const { patchCustomProduct } = require("./custom-product-patch");
const { NUTRIENT_FIELDS } = require("../util/nutrient-fields");

// Alimentos del diario, EMBEBIDOS en su comida (2026-10). Las rutas los
// siguen recibiendo por su `_id`; aquí se localiza la comida que los tiene.

const KIND = "customProducts";

const isBlankString = (value) => typeof value === "string" && value.trim() === "";

function cleanForCreate(payload = {}) {
  const cleaned = {};
  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (value === undefined || isBlankString(value)) return;
    cleaned[key] = value;
  });
  return cleaned;
}

module.exports = {
  // Añade el alimento a la comida. Esta vía es siempre la del propio usuario
  // añadiendo comida: nunca nace pautado (eso solo lo estampa
  // meal-dao.js#pasteMeal con el trainerId), aunque lo diga el cuerpo.
  async createCustomProductAndAddToMeal(idMeal, customProduct, idUser) {
    const cleaned = cleanForCreate(customProduct);
    delete cleaned._id;
    delete cleaned.assignedByTrainerId;
    delete cleaned.assignedQuantity;

    // Un producto inline (objeto sin _id) se da de alta en el catálogo del
    // usuario. Un string es el id de un producto que ya existe (antes se
    // trataba como inline y creaba un Product con las letras del id).
    const inlineProduct = cleaned.product;
    if (idUser && inlineProduct && typeof inlineProduct === "object" && !inlineProduct._id) {
      const { verified, ...productData } = inlineProduct;
      const productDoc = await productSchema.create({ ...productData, userId: idUser });
      cleaned.product = productDoc._id;
    } else if (inlineProduct && typeof inlineProduct === "object") {
      cleaned.product = inlineProduct._id;
    }

    const created = { ...cleaned, _id: mealStore.newId() };
    await mealStore.pushToMeal(idMeal, KIND, created);
    return mealStore.readMealItem(created._id, KIND);
  },

  // Solo los valores que difieren del Product se guardan (ver
  // custom-product-patch.js); `data` ya llega sin los campos protegidos.
  async updateCustomProduct(customProduct) {
    const { _id, ...data } = customProduct || {};
    if (data.product && typeof data.product === "object") data.product = data.product._id;
    const found = await mealStore.mutateMealItem(_id, KIND, async (current) => {
      const baseProduct = current.product
        ? await productSchema.findById(current.product).lean()
        : null;
      return patchCustomProduct(current, data, { overrideFields: NUTRIENT_FIELDS, baseProduct, blankUnsets: true });
    });
    return found ? mealStore.readMealItem(_id, KIND) : null;
  },

  // Marcar/desmarcar consumido — nunca bloqueado por assignedByTrainerId:
  // seguimiento y composición son conceptos distintos.
  async setConsumed(id, consumed) {
    await mealStore.mutateMealItem(id, KIND, (current) => ({ ...current, consumed: Boolean(consumed) }));
    return mealStore.readMealItem(id, KIND);
  },

  // Cantidad realmente consumida — mismo criterio que setConsumed.
  // assignedQuantity (la referencia pautada) nunca se escribe aquí.
  async setQuantity(id, quantity) {
    await mealStore.mutateMealItem(id, KIND, (current) => ({ ...current, quantity }));
    return mealStore.readMealItem(id, KIND);
  },
};
