// Todos los índices de la base, rehechos desde el código.
//
//   npm run rebuild:indexes:dry-run   # informe: qué se borra y qué se crea
//   npm run rebuild:indexes           # pide teclear el nombre de la base y aplica
//
// Flags: --dry-run, --skip-backfill, --confirm=<base> (sin preguntar)
//
// Qué hace, en este orden:
//   1. En cada colección con modelo, borra TODOS sus índices (menos `_id_`).
//   2. Rellena los campos derivados de búsqueda de `products` y `recipes`
//      (`nameNormalized`, `brandNormalized`, `searchTokens`) y quita de los
//      documentos los arrays viejos `namePrefixes`/`brandPrefixes`.
//   3. Colección a colección, crea los índices que declara el código:
//      - los de los schemas de mongoose, creados por el propio mongoose
//        (`Model.createIndexes`): mismos nombres y opciones que al arrancar la
//        API, discriminadores y facturación de trainers incluidos;
//      - los de búsqueda de `products` y `recipes`, que se declaran SOLO aquí
//        (PRODUCT_INDEXES y RECIPE_INDEXES), nunca en los schemas.
//   Las colecciones sin modelo (restos de un modelo viejo) no se tocan: se
//   informa de ellas.
//
// Un índice que no se puede crear (un único con datos duplicados) no para el
// resto: se informa al final y el script sale con error.
//
// Mientras dura no hay índices, ni los únicos ni los de búsqueda. Con la API
// sirviendo, lanzarlo en mantenimiento: en PRO, `products` (millones de
// documentos) tarda minutos. Es también el último
// paso de `npm run migrate` (scripts/migrations/99-indexes.js).
//
// El backfill va sin ningún índice puesto a propósito: las escrituras no
// tienen que mantener ni los multikey viejos de prefijos ni los nuevos a
// medio construir, y cada índice se construye de una pasada sobre los datos
// ya buenos. El modelo de búsqueda está explicado en
// components/util/search-index.js.

const path = require("path");

const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const Recipe = require("../components/recipes/recipe-schema");
const { loadAllSchemas } = require("../components/util/account-cascade");
const { buildSearchFields } = require("../components/util/search-index");

const LOG_PREFIX = "[rebuild-indexes]";
const BATCH_SIZE = 1000;
const LEGACY_FIELDS = ["namePrefixes", "brandPrefixes"];

// Colecciones sin modelo que no son restos: el registro de pasos de
// scripts/migrate-modelo-datos.js.
const KNOWN_UNMODELED = new Set(["schemamigrations"]);

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
  // 2026-10 — ingredientes embebidos: qué recetas usan un producto (borrar
  // un producto convierte esos ingredientes en adición rápida) y localizar
  // un ingrediente por su id.
  { keys: { "customProducts.product": 1 }, options: { name: "idx_recipes_customProducts_product" } },
  { keys: { "customProducts._id": 1 }, options: { name: "idx_recipes_customProducts_id" } },
  {
    keys: { name: "text" },
    options: {
      name: "idx_recipes_text_name",
      default_language: "spanish",
      weights: { name: 10 },
    },
  },
];

const SEARCH_INDEXES = {
  [Product.collection.collectionName]: PRODUCT_INDEXES,
  [Recipe.collection.collectionName]: RECIPE_INDEXES,
};

// Todos los modelos de la API, agrupados por colección (un discriminador
// comparte la de su base; la base va primero).
function modelsByCollection() {
  loadAllSchemas();
  // Modelos que no viven en un `*-schema.js`.
  require("../components/media/media-purge");
  // Facturación de trainers: TypeScript compilado (npm run build:trainer-billing).
  require("../.build/trainer-billing/mongo-repository");

  const groups = new Map();
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const collection = model.collection.collectionName;
    if (!groups.has(collection)) groups.set(collection, []);
    groups.get(collection).push(model);
  }
  for (const models of groups.values()) {
    models.sort((a, b) => Number(Boolean(a.baseModelName)) - Number(Boolean(b.baseModelName)));
  }
  return groups;
}

// Nombre que MongoDB pone a un índice sin nombre explícito (el mismo que
// usan mongoose y el driver).
function indexName(keys, options = {}) {
  return options.name || Object.entries(keys).map(([field, type]) => `${field}_${type}`).join("_");
}

function declaredIndexNames(collectionName, models) {
  const names = new Set();
  for (const model of models) {
    for (const [keys, options] of model.schema.indexes()) names.add(indexName(keys, options));
  }
  for (const { keys, options } of SEARCH_INDEXES[collectionName] || []) names.add(indexName(keys, options));
  return [...names].sort();
}

async function indexNames(collection) {
  try {
    return (await collection.indexes()).map((index) => index.name).sort();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

// Lo que hay y lo que declara el código; con `dryRun` falso, borra ya todos
// sus índices (menos `_id_`).
async function dropCollectionIndexes(db, collectionName, models, { dryRun }) {
  const collection = db.collection(collectionName);
  const before = await indexNames(collection);
  const declared = declaredIndexNames(collectionName, models);
  const result = {
    name: collectionName,
    dropped: before.filter((name) => name !== "_id_"),
    declared,
    retired: before.filter((name) => name !== "_id_" && !declared.includes(name)),
    added: declared.filter((name) => !before.includes(name)),
    missing: [],
    errors: [],
  };
  if (!dryRun && result.dropped.length) await collection.dropIndexes();
  return result;
}

async function createCollectionIndexes(db, result, models) {
  const collection = db.collection(result.name);
  for (const model of models) {
    await model.createIndexes().catch((error) => result.errors.push(error.message));
  }
  const search = SEARCH_INDEXES[result.name];
  if (search) {
    // Un solo comando: MongoDB recorre la colección una vez para todos.
    await collection
      .createIndexes(search.map(({ keys, options }) => ({ key: keys, ...options })))
      .catch((error) => result.errors.push(error.message));
  }
  const after = await indexNames(collection);
  result.missing = result.declared.filter((name) => !after.includes(name));
}

function describe(result, dryRun) {
  const verbs = dryRun ? ["se borrarían", "se crearían"] : ["borrados", "creados"];
  const parts = [`${verbs[0]} ${result.dropped.length}, ${verbs[1]} ${result.declared.length}`];
  if (result.retired.length) parts.push(`ya no se usan: ${result.retired.join(", ")}`);
  if (result.added.length) parts.push(`nuevos: ${result.added.join(", ")}`);
  return `${result.name}: ${parts.join(" · ")}`;
}

function areStringArraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function backfill(model, label, { withBrand, dryRun = false, log = () => {} }) {
  log(`${label}: rellenando campos de búsqueda`);

  const projection = {
    _id: 1,
    name: 1,
    nameNormalized: 1,
    searchTokens: 1,
    ...(withBrand ? { brand: 1, brandNormalized: 1 } : {}),
    namePrefixes: 1,
    brandPrefixes: 1,
  };

  const cursor = model.find({}, projection).lean().cursor();

  let ops = [];
  let scanned = 0;
  let updated = 0;

  const flush = async () => {
    if (!ops.length) return;
    if (dryRun) {
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
    for (const field of LEGACY_FIELDS) {
      if (doc[field] !== undefined) unset[field] = "";
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
  log(`${label}: revisados=${scanned} ${dryRun ? "por escribir" : "escritos"}=${updated}`);
  return { scanned, updated };
}

/**
 * Rehace los índices de todas las colecciones con modelo. `db` es la base de
 * la conexión por defecto de mongoose (la de los modelos).
 *
 * Devuelve `{ collections, unmodeled, failed }`: el detalle de cada colección,
 * las colecciones sin modelo (no tocadas) y las que se quedaron sin algún
 * índice declarado.
 */
async function rebuildIndexes(db, { dryRun = false, skipBackfill = false, log = () => {} } = {}) {
  const groups = modelsByCollection();
  const sorted = [...groups].sort(([a], [b]) => a.localeCompare(b));

  // Primero fuera todos los índices, también antes del backfill: en una base
  // vieja los productos llevan `namePrefixes`/`brandPrefixes` con índices
  // multikey (~60 entradas por producto, varios GB en PRO), y quitarlos con
  // esos índices puestos obliga a MongoDB a mantenerlos documento a documento.
  const collections = [];
  for (const [collectionName, models] of sorted) {
    collections.push(await dropCollectionIndexes(db, collectionName, models, { dryRun }));
  }

  if (!skipBackfill) {
    await backfill(Product, "products", { withBrand: true, dryRun, log });
    await backfill(Recipe, "recipes", { withBrand: false, dryRun, log });
  }

  for (const [index, [collectionName, models]] of sorted.entries()) {
    const result = collections[index];
    if (!dryRun) await createCollectionIndexes(db, result, models);
    log(describe(result, dryRun));
    if (result.missing.length) {
      log(`${collectionName}: FALLO, sin crear ${result.missing.join(", ")} -> ${result.errors.join(" | ")}`);
    }
  }

  const unmodeled = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .filter((name) => !groups.has(name) && !KNOWN_UNMODELED.has(name) && !name.startsWith("system."))
    .sort();
  if (unmodeled.length) log(`sin modelo, no se tocan: ${unmodeled.join(", ")}`);

  return {
    collections,
    unmodeled,
    failed: collections.filter((result) => result.missing.length).map((result) => result.name),
  };
}

async function main() {
  // Solo al ejecutarlo como script: los tests importan rebuildIndexes() sin
  // cargar el .env real.
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const { SCRIPT_CONNECT_OPTIONS, buildMongoUri, redactMongoUri } = require("./_mongo-uri");
  const { confirmTarget, confirmArg } = require("./lib/confirm-target");
  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const dryRun = process.argv.includes("--dry-run");
  const skipBackfill = process.argv.includes("--skip-backfill");

  const mongoUri = buildMongoUri();
  log(`conectando ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${dryRun} skipBackfill=${skipBackfill}`);
  await mongoose.connect(mongoUri, SCRIPT_CONNECT_OPTIONS);
  if (!dryRun) {
    await confirmTarget(mongoose.connection.db, { uri: redactMongoUri(mongoUri), action: "Rehacer todos los índices", confirm: confirmArg(process.argv), log });
  }

  const { failed } = await rebuildIndexes(mongoose.connection.db, { dryRun, skipBackfill, log });
  await mongoose.disconnect();

  if (failed.length) {
    log(`FALLO: colecciones con índices sin crear: ${failed.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  log(dryRun ? "dry-run: no se ha escrito nada" : "listo");
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(LOG_PREFIX, "fatal", error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { PRODUCT_INDEXES, RECIPE_INDEXES, rebuildIndexes, declaredIndexNames, modelsByCollection };
