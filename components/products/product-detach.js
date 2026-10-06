const mongoose = require("mongoose");
const { mutateDocument, mapNodes, idOf } = require("../util/embedded-store");
const { PRODUCT_VALUE_FIELDS } = require("../util/nutrient-fields");

// Qué pasa con los platos que usan un Product cuando el Product se borra
// (decisión 2026-10). Antes la cascada borraba esos alimentos de TODOS los
// diarios, recetas y plantillas: si un entrenador borraba un producto suyo,
// desaparecía de los días pasados de sus clientes. Ahora cada alimento que lo
// usa se convierte en una adición rápida (`quickAdd`): se queda con el nombre
// y los valores de ese momento (lo que ya sobrescribía manda) y pierde la
// referencia. El historial no cambia.
//
// Dónde puede haber alimentos (todos embebidos, ver custom-product-schema.js),
// con el campo de primer nivel que hay que reescribir en cada documento.
// `load` registra el modelo aunque quien llame no lo haya cargado (scripts).
const CONTAINERS = [
  {
    model: "DietDay",
    load: () => require("../dietDays/diet-days-schema"),
    field: "meals",
    paths: [
      "meals.customProducts.product",
      "meals.customRecipes.addedCustomProducts.product",
      "meals.customRecipes.modifiedBaseCustomProducts.product",
    ],
  },
  { model: "Recipe", load: () => require("../recipes/recipe-schema"), field: "customProducts", paths: ["customProducts.product"] },
  {
    model: "MealSnippet",
    load: () => require("../mealSnippets/meal-snippet-schema"),
    fields: ["customProducts", "customRecipes"],
    paths: [
      "customProducts.product",
      "customRecipes.addedCustomProducts.product",
      "customRecipes.modifiedBaseCustomProducts.product",
    ],
  },
  {
    model: "DietTemplate",
    load: () => require("../dietTemplates/diet-template-schema"),
    field: "menus",
    paths: [
      "menus.meals.alternatives.customProducts.product",
      "menus.meals.alternatives.customRecipes.addedCustomProducts.product",
      "menus.meals.alternatives.customRecipes.modifiedBaseCustomProducts.product",
    ],
  },
  {
    model: "DietPhase",
    load: () => require("../dietPhases/diet-phase-schema"),
    field: "contents",
    paths: [
      "contents.menus.meals.alternatives.customProducts.product",
      "contents.menus.meals.alternatives.customRecipes.addedCustomProducts.product",
      "contents.menus.meals.alternatives.customRecipes.modifiedBaseCustomProducts.product",
    ],
  },
];

function toQuickAdd(item, product) {
  const snapshot = { ...item, quickAdd: true, name: item.name ?? product.name };
  for (const field of PRODUCT_VALUE_FIELDS) {
    if ((snapshot[field] === undefined || snapshot[field] === null) && product[field] !== undefined && product[field] !== null) {
      snapshot[field] = product[field];
    }
  }
  delete snapshot.product;
  return snapshot;
}

/**
 * Convierte en adición rápida todo alimento que use alguno de `products`
 * (documentos Product en plano, con sus valores). Devuelve cuántos
 * documentos contenedores se han tocado.
 */
async function detachProductReferences(products) {
  const byId = new Map((products || []).map((product) => [idOf(product), product]));
  if (!byId.size) return 0;
  const ids = [...byId.keys()].map((id) => new mongoose.Types.ObjectId(id));

  const transform = (node) => {
    const product = node.product != null ? byId.get(idOf(node.product)) : null;
    return product ? toQuickAdd(node, product) : node;
  };

  let touched = 0;
  for (const container of CONTAINERS) {
    const Model = container.load();
    const fields = container.fields || [container.field];
    const holders = await Model.find({ $or: container.paths.map((path) => ({ [path]: { $in: ids } })) })
      .select("_id")
      .lean();
    for (const holder of holders) {
      await mutateDocument(Model, { _id: holder._id }, (doc) => {
        const mapped = mapNodes(doc, transform);
        return Object.fromEntries(fields.map((field) => [field, mapped[field] || []]));
      });
      touched += 1;
    }
  }
  return touched;
}

module.exports = { detachProductReferences, toQuickAdd };
