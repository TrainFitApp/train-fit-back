// Valores fuera de los límites del schema (2026-10-09, ensayo sobre la copia
// de PRO: 40 sesiones, 1 rutina, 283 productos del catálogo y 1 receta). Al
// guardar se valida el bloque entero que cambia, así que uno solo de estos
// valores impedía editar el documento, y los números absurdos se sumaban en
// totales y gráficas. Los límites se leen de los propios schemas.
//
//   workouts   series: una velocidad que solo cabe como mm/s pasa a m/s
//              (÷1000); el resto de valores imposibles se vacía, y dentro de
//              una lista (RIR, repeticiones previstas) queda null («—») para
//              no mover las posiciones.
//   tables     notas fijadas sin texto: fuera.
//   recipes    cantidad de un ingrediente por encima del máximo: ÷1000 (gramos
//              con la coma mal puesta) si así cabe; si no, se deja y se cuenta.
//   products   negativos de redondeo (entre -1 y 0) a 0, el resto de números
//              fuera de rango fuera, y textos recortados a su máximo (en
//              alérgenos y trazas, cada elemento).
//
// Idempotente: lo que ya cabe en el schema no se toca.

const SetSchema = require("../../components/sets/set-schema");
const CustomProductSchema = require("../../components/customProducts/custom-product-schema");
const Product = require("../../components/products/product-schema");
const { TEXT_LIST_ITEM_MAX } = require("../../components/util/nutrient-fields");

const TEXT_LISTS = ["allergens", "traces"];
const BATCH_SIZE = 500;

// Un número de la base: los que no caben en 53 bits llegan del driver como
// Long (o Decimal128), no como number.
function numberOf(value) {
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (value && ["Long", "Int32", "Double", "Decimal128"].includes(value._bsontype)) return Number(value.toString());
  return null;
}

const outOfRange = (value, { min, max }) => {
  const number = numberOf(value);
  return number !== null && ((min != null && number < min) || (max != null && number > max));
};

// Campos numéricos con límites de un schema: { campo: { min, max, list } }.
function numberLimits(schema) {
  const limits = {};
  schema.eachPath((name, type) => {
    const options = type.instance === "Array" ? type.caster?.options : type.options;
    const instance = type.instance === "Array" ? type.caster?.instance : type.instance;
    if (instance !== "Number" || (options?.min == null && options?.max == null)) return;
    limits[name] = { min: options.min, max: options.max, list: type.instance === "Array" };
  });
  return limits;
}

function stringLimits(schema) {
  const limits = {};
  schema.eachPath((name, type) => {
    if (type.instance === "String" && type.options.maxlength) limits[name] = type.options.maxlength;
  });
  return limits;
}

const SET_LIMITS = numberLimits(SetSchema);

// Devuelve la serie arreglada, o la misma si no había nada que arreglar.
function fixSet(set) {
  const next = { ...set };
  let changed = false;
  for (const [field, limit] of Object.entries(SET_LIMITS)) {
    const value = next[field];
    if (limit.list) {
      // Un valor suelto (`rir: 999`) es una lista de uno para mongoose.
      const items = Array.isArray(value) ? value : [value];
      if (!items.some((item) => outOfRange(item, limit))) continue;
      next[field] = items.map((item) => (outOfRange(item, limit) ? null : item));
      changed = true;
      continue;
    }
    if (!outOfRange(value, limit)) continue;
    const number = numberOf(value);
    if (field === "velocity" && number > 0 && number / 1000 <= limit.max) next[field] = number / 1000;
    else delete next[field];
    changed = true;
  }
  return changed ? next : set;
}

function setsFilter() {
  const clauses = [];
  for (const [field, { min, max }] of Object.entries(SET_LIMITS)) {
    if (max != null) clauses.push({ [`exercises.sets.${field}`]: { $gt: max } });
    if (min != null) clauses.push({ [`exercises.sets.${field}`]: { $lt: min } });
  }
  return { $or: clauses };
}

async function fixWorkouts(db, dryRun) {
  const workouts = db.collection("workouts");
  let fixed = 0;
  for await (const workout of workouts.find(setsFilter(), { projection: { exercises: 1 } })) {
    let changed = false;
    const exercises = (workout.exercises || []).map((exercise) => {
      const sets = (exercise.sets || []).map((set) => {
        const next = fixSet(set);
        if (next !== set) changed = true;
        return next;
      });
      return { ...exercise, sets };
    });
    if (!changed) continue;
    fixed += 1;
    // El entrenamiento lleva contenido embebido con compare-and-swap sobre __v.
    if (!dryRun) await workouts.updateOne({ _id: workout._id }, { $set: { exercises }, $inc: { __v: 1 } });
  }
  return fixed;
}

const blank = (note) => typeof note.notes !== "string" || !note.notes.trim();

async function fixPinnedNotes(db, dryRun) {
  const tables = db.collection("tables");
  const filter = { pinnedNotes: { $elemMatch: { $or: [{ notes: { $not: { $type: "string" } } }, { notes: { $regex: "^\\s*$" } }] } } };
  let fixed = 0;
  for await (const table of tables.find(filter, { projection: { pinnedNotes: 1 } })) {
    const pinnedNotes = table.pinnedNotes.filter((note) => !blank(note));
    fixed += 1;
    if (!dryRun) await tables.updateOne({ _id: table._id }, { $set: { pinnedNotes }, $inc: { __v: 1 } });
  }
  return fixed;
}

async function fixRecipeQuantities(db, dryRun) {
  const recipes = db.collection("recipes");
  const { max } = CustomProductSchema.path("quantity").options;
  let fixed = 0;
  let unfixable = 0;
  for await (const recipe of recipes.find({ "customProducts.quantity": { $gt: max } }, { projection: { customProducts: 1 } })) {
    let changed = false;
    const customProducts = recipe.customProducts.map((item) => {
      if (!(item.quantity > max)) return item;
      if (item.quantity / 1000 > max) {
        unfixable += 1;
        return item;
      }
      changed = true;
      return { ...item, quantity: item.quantity / 1000 };
    });
    if (!changed) continue;
    fixed += 1;
    // La receta lleva sus ingredientes embebidos con compare-and-swap sobre __v.
    if (!dryRun) await recipes.updateOne({ _id: recipe._id }, { $set: { customProducts }, $inc: { __v: 1 } });
  }
  return { fixed, unfixable };
}

const PRODUCT_NUMBERS = numberLimits(Product.schema);
const PRODUCT_STRINGS = stringLimits(Product.schema);

function productFilter() {
  const clauses = [];
  for (const [field, { min, max }] of Object.entries(PRODUCT_NUMBERS)) {
    if (max != null) clauses.push({ [field]: { $gt: max } });
    if (min != null) clauses.push({ [field]: { $lt: min } });
  }
  for (const [field, maxlength] of Object.entries(PRODUCT_STRINGS)) {
    clauses.push({ [field]: { $regex: `^[\\s\\S]{${maxlength + 1}}` } });
  }
  for (const field of TEXT_LISTS) {
    clauses.push({ [field]: { $regex: `^[\\s\\S]{${TEXT_LIST_ITEM_MAX + 1}}` } });
  }
  return { $or: clauses };
}

// { $set, $unset } que deja el producto dentro de su schema, o null.
function productUpdate(product) {
  const set = {};
  const unset = {};
  for (const [field, limit] of Object.entries(PRODUCT_NUMBERS)) {
    const value = product[field];
    if (!outOfRange(value, limit)) continue;
    const number = numberOf(value);
    if (limit.min === 0 && number < 0 && number > -1) set[field] = 0;
    else unset[field] = "";
  }
  for (const [field, maxlength] of Object.entries(PRODUCT_STRINGS)) {
    const value = product[field];
    if (typeof value !== "string" || value.trim().length <= maxlength) continue;
    set[field] = value.trim().slice(0, maxlength).trim();
  }
  for (const field of TEXT_LISTS) {
    const list = product[field];
    if (!Array.isArray(list) || !list.some((item) => typeof item === "string" && item.trim().length > TEXT_LIST_ITEM_MAX)) continue;
    set[field] = list.map((item) => (typeof item === "string" && item.trim().length > TEXT_LIST_ITEM_MAX ? item.trim().slice(0, TEXT_LIST_ITEM_MAX).trim() : item));
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return null;
  return { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
}

async function fixProducts(db, dryRun) {
  const products = db.collection("products");
  let fixed = 0;
  let ops = [];
  const flush = async () => {
    if (!dryRun && ops.length) await products.bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for await (const product of products.find(productFilter())) {
    const update = productUpdate(product);
    if (!update) continue;
    fixed += 1;
    ops.push({ updateOne: { filter: { _id: product._id }, update } });
    if (ops.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return fixed;
}

async function migrateOutOfRangeValues(db, { dryRun = false } = {}) {
  const recipes = await fixRecipeQuantities(db, dryRun);
  return {
    workouts: await fixWorkouts(db, dryRun),
    tables: await fixPinnedNotes(db, dryRun),
    recipes: recipes.fixed,
    recipeQuantitiesLeft: recipes.unfixable,
    products: await fixProducts(db, dryRun),
  };
}

module.exports = { migrateOutOfRangeValues, fixSet, productUpdate };
