// Catálogo ÚNICO de los valores nutricionales por 100 g que comparten el
// catálogo (`Product`) y cada alimento puesto en un plato (`CustomProduct`).
//
// Antes esta lista estaba copiada a mano en seis sitios (los dos schemas, el
// DAO de CustomProduct, la fusión de recetas, la aritmética de nutrición y el
// borrado de cuentas). Un nutriente nuevo exigía acordarse de los seis; el
// que se olvidaba dejaba de copiarse, de compararse o de sumarse sin ningún
// error visible. Todo lo de aquí abajo sale de esta lista.
//
// Módulo puro (sin mongoose): lo importa también la aritmética de
// diet-days-nutrition-util.js, que no debe arrastrar modelos.

// Valores numéricos por 100 g. Los minerales y vitaminas se guardan en gramos
// (la interfaz los pinta en mg/µg).
const NUTRIENT_FIELDS = Object.freeze([
  // Macros y básicos
  "energyKcal100g",
  "protein100g",
  "carbohydrates100g",
  "fat100g",
  "saturatedFat100g",
  "sugars100g",
  "fiber100g",
  "salt100g",
  "sodium100g",
  "cholesterol100g",
  "transFat100g",
  // Minerales
  "calcium100g",
  "iron100g",
  "magnesium100g",
  "phosphorus100g",
  "potassium100g",
  "zinc100g",
  "copper100g",
  "manganese100g",
  "selenium100g",
  "iodine100g",
  // Vitaminas
  "vitaminA100g",
  "vitaminC100g",
  "vitaminD100g",
  "vitaminE100g",
  "vitaminK100g",
  "vitaminB1100g", // Tiamina
  "vitaminB2100g", // Riboflavina
  "vitaminB3100g", // Niacina
  "vitaminB5100g", // Ácido pantoténico
  "vitaminB6100g",
  "vitaminB9100g", // Folato
  "vitaminB12100g",
  "biotin100g", // Vitamina B7
  // Ácidos grasos y otros
  "omega3100g",
  "omega6100g",
  "omega9100g",
  "caffeine100g",
  "taurine100g",
  "alcohol100g",
]);

// Información del producto que no es un valor por 100 g pero viaja con él:
// ingredientes, alérgenos y aptitudes dietéticas.
const PRODUCT_INFO_FIELDS = Object.freeze([
  "ingredients",
  "allergens",
  "traces",
  "vegan",
  "vegetarian",
  "lactoseFree",
  "glutenFree",
]);

// Lo que un CustomProduct puede tener propio y, si lo tiene, manda sobre su
// Product (`cp.campo ?? cp.product?.campo`): valores y su información.
const PRODUCT_VALUE_FIELDS = Object.freeze([...NUTRIENT_FIELDS, ...PRODUCT_INFO_FIELDS]);

// Lo que una entrada de `modifiedBaseCustomProducts` de una receta puede
// pisar del ingrediente base: la cantidad y cualquier valor. Misma lista que
// shared-core/services/recipe/recipe.service.ts#CUSTOM_PRODUCT_COMPARISON_FIELDS
// del front (otro repositorio: esa copia no puede importar esta).
const RECIPE_OVERRIDE_FIELDS = Object.freeze(["quantity", ...PRODUCT_VALUE_FIELDS]);

// Techo genérico de seguridad, no específico por nutriente.
const NUTRIENT_LIMITS = Object.freeze({ min: 0, max: 100000 });

const textListField = (label) => ({
  type: [String],
  validate: {
    validator: (arr) => !arr || arr.every((s) => (s || "").trim().length <= 200),
    message: `Cada ${label} debe tener 200 caracteres o menos`,
  },
});

/**
 * Definición de schema de Mongoose para todos los valores por 100 g y la
 * información del producto. La usan Product y CustomProduct para no repetir
 * cuarenta y siete campos cada uno.
 */
function productValueSchemaFields() {
  const fields = {};
  for (const field of NUTRIENT_FIELDS) fields[field] = { type: Number, ...NUTRIENT_LIMITS };
  fields.ingredients = { type: String, trim: true, maxlength: 5000 };
  fields.allergens = textListField("alérgeno");
  fields.traces = textListField("traza");
  fields.vegan = Boolean;
  fields.vegetarian = Boolean;
  fields.lactoseFree = Boolean;
  fields.glutenFree = Boolean;
  return fields;
}

module.exports = {
  NUTRIENT_FIELDS,
  PRODUCT_INFO_FIELDS,
  PRODUCT_VALUE_FIELDS,
  RECIPE_OVERRIDE_FIELDS,
  NUTRIENT_LIMITS,
  productValueSchemaFields,
};
