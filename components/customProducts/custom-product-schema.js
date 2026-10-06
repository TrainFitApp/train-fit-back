const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { productValueSchemaFields } = require("../util/nutrient-fields");
// `product` se autopuebla también al guardar el documento que lo contiene:
// el modelo Product tiene que estar registrado aunque nadie lo haya pedido.
require("../products/product-schema");

// Un alimento puesto en un plato: la cantidad y lo que difiere de su Product.
// Desde 2026-10 vive EMBEBIDO allí donde se usa (no hay colección propia):
//
//   DietDay.meals[].customProducts[]                       diario del cliente
//   DietDay.meals[].customRecipes[].addedCustomProducts[]  ingrediente añadido a una receta
//   DietDay.meals[].customRecipes[].modifiedBaseCustomProducts[]  ingrediente de la receta, cambiado
//   Recipe.customProducts[]                                ingredientes de una receta
//   DietTemplate.menus[].meals[].alternatives[]...         plantillas de dieta
//   DietPhase.contents[].menus[].meals[].alternatives[]... fases de dieta de un cliente
//   MealSnippet.customProducts[]                           comidas guardadas del entrenador
//
// En el diario se direcciona por su comida: /meals/:id/customproducts/:itemId.
const CustomProductSchema = new Schema({
  quantity: { type: Number, min: 0, max: 100000 },
  order: Number,
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    autopopulate: true,
  },
  // Adición rápida (2026-10) — línea suelta que el cliente apunta con sus
  // macros a mano, sin crear un Product en el catálogo: `product` queda
  // vacío y el nombre vive aquí. Cuando hay `product` manda el nombre del
  // producto base, así que quien pinte un CustomProduct lee siempre
  // `product?.name || name` (mismo orden que shopping-list-service.js).
  // También es en lo que se convierte un alimento cuyo Product se borra
  // (products/product-detach.js): el historial no pierde lo que se comió.
  name: { type: String, trim: true, maxlength: 100 },
  // Marca explícita de esa adición rápida: distingue una línea escrita a
  // mano de un alimento al que le falte la referencia por un dato corrupto,
  // y es lo que mira el cliente para abrir el editor correcto.
  quickAdd: { type: Boolean, default: false },

  // Valores propios de este plato (solo los que difieren de su Product, o
  // todos en una adición rápida). Catálogo único en util/nutrient-fields.js.
  ...productValueSchemaFields(),

  // Pautado por el profesional: presente si lo pautó él
  // (meal-dao.js#pasteMeal). Permanente; protege de borrado/edición directa
  // del cliente (meal-service.js#assertMealEditable, a nivel de item).
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Cantidad ORIGINAL pautada (gramos): se estampa una vez junto con
  // assignedByTrainerId y no se vuelve a tocar. `quantity` pasa a ser la
  // cantidad REALMENTE consumida, editable por el cliente. null en lo que
  // nunca fue pautado.
  assignedQuantity: { type: Number, min: 0, max: 100000, default: null },
  // El cliente lo marca como tomado — nunca bloqueado por
  // assignedByTrainerId (seguimiento y composición son cosas distintas).
  consumed: { type: Boolean, default: false },
  // En modifiedBaseCustomProducts: el ingrediente de la Recipe que cambia
  // (un `_id` de Recipe.customProducts[]).
  baseCustomProductId: { type: Schema.Types.ObjectId },
});

module.exports = CustomProductSchema;
