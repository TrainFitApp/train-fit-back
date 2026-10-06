// Campos derivados e índices de búsqueda de productos y recetas
// (scripts/rebuild-search-indexes.js, que sigue siendo el sitio único de
// esos índices y se puede volver a lanzar a mano). Último paso: los datos ya
// tienen su forma final.

const Product = require("../../components/products/product-schema");
const Recipe = require("../../components/recipes/recipe-schema");
const { PRODUCT_INDEXES, RECIPE_INDEXES, syncIndexes, backfill } = require("../rebuild-search-indexes");

async function rebuildSearchIndexes(db, { dryRun = false } = {}) {
  await backfill(Product, "products", { withBrand: true, dryRun });
  await backfill(Recipe, "recipes", { withBrand: false, dryRun });
  await syncIndexes(Product.collection, "products", PRODUCT_INDEXES, { dryRun });
  await syncIndexes(Recipe.collection, "recipes", RECIPE_INDEXES, { dryRun });
  return {};
}

module.exports = { rebuildSearchIndexes };
