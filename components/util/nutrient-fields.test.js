const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  NUTRIENT_FIELDS,
  PRODUCT_INFO_FIELDS,
  PRODUCT_VALUE_FIELDS,
  RECIPE_OVERRIDE_FIELDS,
  productValueSchemaFields,
} = require("./nutrient-fields");

test("las listas no repiten campos y se componen unas de otras", () => {
  assert.equal(new Set(NUTRIENT_FIELDS).size, NUTRIENT_FIELDS.length);
  assert.deepEqual(PRODUCT_VALUE_FIELDS, [...NUTRIENT_FIELDS, ...PRODUCT_INFO_FIELDS]);
  assert.deepEqual(RECIPE_OVERRIDE_FIELDS, ["quantity", ...PRODUCT_VALUE_FIELDS]);
  assert.ok(NUTRIENT_FIELDS.every((field) => field.endsWith("100g")));
});

test("el fragmento de schema define todos los valores, con techo en los numéricos", () => {
  const fields = productValueSchemaFields();
  assert.deepEqual(Object.keys(fields).sort(), [...PRODUCT_VALUE_FIELDS].sort());
  for (const field of NUTRIENT_FIELDS) {
    assert.equal(fields[field].type, Number, field);
    assert.equal(fields[field].min, 0, field);
    assert.equal(fields[field].max, 100000, field);
  }
  // Cada llamada devuelve objetos nuevos: dos schemas no comparten validadores.
  assert.notEqual(productValueSchemaFields().allergens, fields.allergens);
});

test("Product y CustomProduct declaran todos los valores del catálogo", () => {
  const Product = require("../products/product-schema");
  const CustomProduct = require("../customProducts/custom-product-schema");
  for (const field of PRODUCT_VALUE_FIELDS) {
    assert.ok(Product.schema.path(field), `Product.${field}`);
    assert.ok(CustomProduct.path(field), `CustomProduct.${field}`);
  }
});

// La copia del front (otro repositorio) no puede importar este módulo; si el
// repositorio está al lado, se comprueba que no se haya separado.
const FRONT_RECIPE_SERVICE = path.resolve(
  __dirname,
  "../../../train-fit-front/packages/shared-core/src/app/core/services/recipe/recipe.service.ts",
);

test("la lista del front coincide con la del back", { skip: !fs.existsSync(FRONT_RECIPE_SERVICE) }, () => {
  const source = fs.readFileSync(FRONT_RECIPE_SERVICE, "utf8");
  const block = source.match(/CUSTOM_PRODUCT_COMPARISON_FIELDS[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "no se encontró CUSTOM_PRODUCT_COMPARISON_FIELDS en el front");
  const frontFields = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...frontFields].sort(), [...RECIPE_OVERRIDE_FIELDS].sort());
});
