// Índices y campos derivados de búsqueda de `products` y `recipes`.
// Fuente única de verdad: los schemas NO declaran estos índices.
//
//   npm run rebuild:search-indexes:dry-run   # solo dice qué haría
//   npm run rebuild:search-indexes           # aplica
//
// Flags: --dry-run, --skip-backfill, --skip-indexes, --keep-legacy
//
// Qué hace, en este orden:
//   1. Rellena `nameNormalized`, `brandNormalized` y `searchTokens`, y quita
//      de los documentos `namePrefixes`/`brandPrefixes` (salvo --keep-legacy).
//   2. Crea los índices que falten (los que ya están correctos no se tocan).
//   3. Borra los que ya no se usan, de uno en uno y por nombre.
//
// El backfill va ANTES de crear los índices a propósito: así las escrituras
// no tienen que ir manteniendo un índice multikey a medio construir, y el
// índice se construye de una pasada sobre los datos ya buenos. Dentro de cada
// colección se crea antes de borrar, para no dejar la búsqueda sin índices en
// medio del proceso.
//
// Orden de despliegue con un catálogo grande: ejecutar el script primero y
// desplegar el código después. El código nuevo busca por `searchTokens`, que
// hasta que acabe el paso 1 no existe.
//
// El modelo de datos está explicado en components/util/search-index.js: los
// arrays de prefijos eran ~60 entradas de índice por producto (varios GB en un
// catálogo grande, imposible de mantener en RAM) y ni así resolvían una
// búsqueda de varias palabras.

const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const Recipe = require("../components/recipes/recipe-schema");
const { buildSearchFields } = require("../components/util/search-index");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");
const SKIP_BACKFILL = hasFlag("--skip-backfill");
const SKIP_INDEXES = hasFlag("--skip-indexes");
const KEEP_LEGACY = hasFlag("--keep-legacy");

const LOG_PREFIX = "[rebuild-search-indexes]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BATCH_SIZE = 1000;
const LEGACY_FIELDS = ["namePrefixes", "brandPrefixes"];

const PRODUCT_INDEXES = [
  // Código de barras: lectura del escáner.
  { keys: { code: 1, userId: 1 }, options: { name: "idx_products_code_userId" } },
  // Igualdad y prefijo de nombre, globales y acotados al dueño. El `_id`
  // final hace el orden estable para paginar.
  {
    keys: { nameNormalized: 1, _id: 1 },
    options: { name: "idx_products_nameNormalized_id" },
  },
  {
    keys: { userId: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_products_userId_nameNormalized_id" },
  },
  {
    keys: { verified: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_products_verified_nameNormalized_id" },
  },
  // Marca.
  {
    keys: { brandNormalized: 1, _id: 1 },
    options: { name: "idx_products_brandNormalized_id" },
  },
  // Palabras: el AND de prefijos de la búsqueda. Multikey (un solo array por
  // índice, por eso `userId` va delante y no detrás).
  { keys: { searchTokens: 1, _id: 1 }, options: { name: "idx_products_searchTokens_id" } },
  {
    keys: { userId: 1, searchTokens: 1 },
    options: { name: "idx_products_userId_searchTokens" },
  },
  // Índice de texto: solo se consulta como rescate (stemming) cuando la
  // búsqueda literal no llena la página. En español, que es el idioma de los
  // nombres que escribe el usuario; por defecto Mongo usa inglés y aplica el
  // stemmer y las stopwords equivocadas.
  {
    keys: { name: "text", brand: "text" },
    options: {
      name: "idx_products_text_name_brand",
      default_language: "spanish",
      weights: { name: 10, brand: 4 },
    },
  },
];

const RECIPE_INDEXES = [
  {
    keys: { nameNormalized: 1, _id: 1 },
    options: { name: "idx_recipes_nameNormalized_id" },
  },
  {
    keys: { userId: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_recipes_userId_nameNormalized_id" },
  },
  {
    keys: { verified: 1, nameNormalized: 1, _id: 1 },
    options: { name: "idx_recipes_verified_nameNormalized_id" },
  },
  { keys: { searchTokens: 1, _id: 1 }, options: { name: "idx_recipes_searchTokens_id" } },
  {
    keys: { userId: 1, searchTokens: 1 },
    options: { name: "idx_recipes_userId_searchTokens" },
  },
  // TASK-046 — las etiquetas se filtran con $in.
  { keys: { tags: 1 }, options: { name: "idx_recipes_tags" } },
  {
    keys: { name: "text" },
    options: {
      name: "idx_recipes_text_name",
      default_language: "spanish",
      weights: { name: 10 },
    },
  },
];

function sameKeys(left, right) {
  const leftEntries = Object.entries(left || {});
  const rightEntries = Object.entries(right || {});
  if (leftEntries.length !== rightEntries.length) return false;

  for (let i = 0; i < leftEntries.length; i += 1) {
    const [leftField, leftValue] = leftEntries[i];
    const [rightField, rightValue] = rightEntries[i];
    if (leftField !== rightField) return false;
    if (String(leftValue) !== String(rightValue)) return false;
  }

  return true;
}

// Un índice de texto se reconoce por su nombre, no por sus claves: Mongo lo
// guarda como `_fts/_ftsx` y además solo admite UNO por colección.
function isTextIndex(definition) {
  return Object.values(definition.keys || {}).includes("text");
}

function matchesExisting(definition, existing) {
  if (isTextIndex(definition)) {
    const existingIsText = !!existing.key?._fts || existing.textIndexVersion;
    if (!existingIsText) return false;
    return (
      existing.name === definition.options.name &&
      (existing.default_language || "english") ===
        (definition.options.default_language || "english")
    );
  }

  return sameKeys(definition.keys, existing.key);
}

async function syncIndexes(collection, label, definitions) {
  const existing = await collection.indexes();
  const keep = new Set(["_id_"]);
  const toCreate = [];

  for (const definition of definitions) {
    const found = existing.find((index) => matchesExisting(definition, index));

    if (found) {
      keep.add(found.name);
      log(`${label}: ${definition.options.name} ya existe (${found.name})`);
      continue;
    }

    toCreate.push(definition);
  }

  const obsolete = existing.filter((index) => !keep.has(index.name));

  // Un índice que estorba hay que borrarlo ANTES de crear el nuevo: crear con
  // un nombre ya ocupado falla (IndexOptionsConflict) y de índice de texto
  // solo se admite UNO por colección.
  const blocking = obsolete.filter((index) =>
    toCreate.some(
      (definition) =>
        definition.options.name === index.name ||
        (isTextIndex(definition) && (!!index.key?._fts || !!index.textIndexVersion)),
    ),
  );

  for (const index of blocking) {
    log(`${label}: borrar ${index.name} (estorba a uno nuevo)`);
    if (!DRY_RUN) await collection.dropIndex(index.name);
  }

  for (const definition of toCreate) {
    log(`${label}: crear ${definition.options.name} ${JSON.stringify(definition.keys)}`);
    if (!DRY_RUN) await collection.createIndex(definition.keys, definition.options);
  }

  const blockingNames = new Set(blocking.map((index) => index.name));
  const rest = obsolete.filter((index) => !blockingNames.has(index.name));

  if (!rest.length) {
    ok(`${label}: índices al día`);
    return;
  }

  log(`${label}: borrar ${rest.length} índices que ya no se usan -> ${rest
    .map((index) => index.name)
    .join(", ")}`);

  if (!DRY_RUN) {
    for (const index of rest) {
      await collection.dropIndex(index.name);
    }
  }

  ok(`${label}: índices al día`);
}

function areStringArraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function backfill(model, label, { withBrand }) {
  log(`${label}: rellenando campos de búsqueda`);

  const projection = {
    _id: 1,
    name: 1,
    nameNormalized: 1,
    searchTokens: 1,
    ...(withBrand ? { brand: 1, brandNormalized: 1 } : {}),
    ...(KEEP_LEGACY ? {} : { namePrefixes: 1, brandPrefixes: 1 }),
  };

  const cursor = model.find({}, projection).lean().cursor();

  let ops = [];
  let scanned = 0;
  let updated = 0;

  const flush = async () => {
    if (!ops.length) return;
    if (DRY_RUN) {
      updated += ops.length;
    } else {
      // Por la colección cruda, no por el modelo: mongoose castea el update
      // contra el schema y, al haber quitado de él `namePrefixes`/
      // `brandPrefixes`, se comía el $unset que los borra.
      const result = await model.collection.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    }
    ops = [];
  };

  for await (const doc of cursor) {
    scanned += 1;
    const next = buildSearchFields(doc);

    const set = {};
    if (doc.nameNormalized !== next.nameNormalized) {
      set.nameNormalized = next.nameNormalized;
    }
    if (withBrand && doc.brandNormalized !== next.brandNormalized) {
      set.brandNormalized = next.brandNormalized;
    }
    if (!areStringArraysEqual(doc.searchTokens, next.searchTokens)) {
      set.searchTokens = next.searchTokens;
    }

    const unset = {};
    if (!KEEP_LEGACY) {
      for (const field of LEGACY_FIELDS) {
        if (doc[field] !== undefined) unset[field] = "";
      }
    }

    if (!Object.keys(set).length && !Object.keys(unset).length) continue;

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    ops.push({ updateOne: { filter: { _id: doc._id }, update } });

    if (ops.length >= BATCH_SIZE) {
      await flush();
      if (scanned % (BATCH_SIZE * 25) === 0) {
        log(`${label}: ${scanned} revisados, ${updated} escritos`);
      }
    }
  }

  await flush();
  ok(`${label}: revisados=${scanned} escritos=${updated}`);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`conectando ${redactMongoUri(mongoUri)}`);
  log(
    `flags dryRun=${DRY_RUN} skipBackfill=${SKIP_BACKFILL} skipIndexes=${SKIP_INDEXES} keepLegacy=${KEEP_LEGACY}`,
  );

  await mongoose.connect(mongoUri);
  ok("conectado");

  if (!SKIP_BACKFILL) {
    await backfill(Product, "products", { withBrand: true });
    await backfill(Recipe, "recipes", { withBrand: false });
  } else {
    log("backfill omitido");
  }

  if (!SKIP_INDEXES) {
    await syncIndexes(Product.collection, "products", PRODUCT_INDEXES);
    await syncIndexes(Recipe.collection, "recipes", RECIPE_INDEXES);
  } else {
    log("índices omitidos");
  }

  await mongoose.disconnect();
  ok("listo");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // da igual: ya estamos saliendo
  }
  process.exitCode = 1;
});
