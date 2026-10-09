// Alimentos genéricos en español para el contenido de fábrica (QA
// 2026-10-09, M8).
//
// La despensa (data/verified-recipes/pantry.js) apunta a productos reales de
// la base por su `_id`, elegidos por sus valores por 100 g; muchos son de
// supermercados de EE. UU. con nombre en inglés y marca («Kroger, plain
// nonfat greek yogurt»), y así salían en las dietas y recetas de fábrica, en
// el diario del cliente y en la lista de la compra.
//
// Ahora cada clave de la despensa se resuelve a un Product genérico: nombre
// en español (el `label` de la despensa), sin marca ni código de barras,
// verificado y sin dueño, con los valores por 100 g del producto de
// referencia. Sus aptitudes salen del `kind` de la despensa (lo vegetal es
// vegano; huevo, lácteo y miel, vegetarianos; lo que no es lácteo no lleva
// lactosa): con eso las dietas de fábrica ya pueden cumplir «Sin lactosa».
// El gluten no se afirma (depende de la marca).
//
// Idempotente: un genérico se reconoce por su nombre (verificado, sin dueño,
// sin marca ni código) y no se reescribe.

const Product = require("../../components/products/product-schema");
const { NUTRIENT_FIELDS } = require("../../components/util/nutrient-fields");

function dietaryFlagsOf(kind) {
  return {
    vegan: kind === "vegetal",
    vegetarian: ["vegetal", "huevo", "lacteo", "miel"].includes(kind),
    lactoseFree: kind !== "lacteo",
  };
}

function genericProductFor(entry, source) {
  const values = {};
  for (const field of NUTRIENT_FIELDS) {
    if (source?.[field] !== undefined && source[field] !== null) values[field] = source[field];
  }
  return { name: entry.label, verified: true, userId: null, ...values, ...dietaryFlagsOf(entry.kind) };
}

const genericFilter = (names) => ({
  name: { $in: names },
  verified: true,
  userId: null,
  code: { $in: [null, ""] },
  brand: { $in: [null, ""] },
});

/**
 * `productsByKey`: el producto de referencia de cada clave disponible (con
 * sus valores por 100 g). Devuelve otro Map clave → genérico (creado si
 * faltaba). En dry-run no crea nada: devuelve los genéricos que ya existen y,
 * para el resto, el de referencia (los valores son los mismos).
 */
async function ensureGenericProducts(pantry, productsByKey, { dryRun = false, log = () => {} } = {}) {
  const keys = [...productsByKey.keys()];
  const existing = await Product.find(genericFilter(keys.map((key) => pantry[key].label))).lean();
  const byName = new Map(existing.map((product) => [product.name, product]));
  const result = new Map();
  let created = 0;
  for (const key of keys) {
    const entry = pantry[key];
    let generic = byName.get(entry.label);
    if (!generic && !dryRun) {
      generic = (await Product.create(genericProductFor(entry, productsByKey.get(key)))).toObject();
      byName.set(entry.label, generic);
      created += 1;
    }
    result.set(key, generic || productsByKey.get(key));
  }
  if (created) log(`crea ${created} alimentos genéricos en español`);
  return result;
}

/** La despensa con cada clave apuntando a su genérico. */
function pantryWithGenerics(pantry, genericsByKey) {
  const next = { ...pantry };
  for (const [key, product] of genericsByKey) next[key] = { ...pantry[key], product: String(product._id) };
  return next;
}

module.exports = { dietaryFlagsOf, ensureGenericProducts, genericProductFor, pantryWithGenerics };
