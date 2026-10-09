// Comprueba una base contra los schemas actuales, sin escribir nada: cada
// documento de cada colección con modelo pasa por su schema (validateSync de
// un documento nuevo, que convierte y valida todos los campos) y se cuentan
// los campos de primer nivel que el schema no declara (restos de un modelo
// viejo). Lo lanza `npm run migrate` al terminar.
//
// Un documento que no pasa su schema no se puede editar: al guardar se valida
// el bloque entero que cambia. Con PRO recorre millones de productos (unos
// minutos).

const { modelsByCollection } = require("./rebuild-indexes");

const TOP_ERRORS = 5;

function declaredTopLevel(schema) {
  const declared = new Set(["_id", "__v", schema.options.discriminatorKey]);
  for (const key of [...Object.keys(schema.paths), ...Object.keys(schema.nested || {}), ...Object.keys(schema.virtuals || {})]) {
    declared.add(key.split(".")[0]);
  }
  return declared;
}

// El modelo de un documento: el discriminador que dice su clave, o la base.
function modelFor(base, raw) {
  const key = base.schema.options.discriminatorKey;
  const discriminator = Object.values(base.discriminators || {}).find((model) => model.schema.discriminatorMapping?.value === raw[key]);
  return discriminator || base;
}

const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const top = (map, limit = Infinity) => [...map].sort((a, b) => b[1] - a[1]).slice(0, limit);

async function verifyCollection(db, name, models) {
  const base = models.find((model) => !model.baseModelName);
  const declared = new Map(models.map((model) => [model.modelName, declaredTopLevel(model.schema)]));
  const errors = new Map();
  const undeclared = new Map();
  let docs = 0;
  let invalid = 0;

  for await (const raw of db.collection(name).find({}).batchSize(2000)) {
    docs += 1;
    const Model = modelFor(base, raw);
    const error = new Model(raw).validateSync();
    if (error) {
      invalid += 1;
      for (const [path, detail] of Object.entries(error.errors)) increment(errors, `${path.replace(/\.\d+(?=\.|$)/g, ".N")}: ${detail.kind}`);
    }
    const fields = declared.get(Model.modelName);
    for (const field of Object.keys(raw)) if (!fields.has(field)) increment(undeclared, field);
  }
  return { name, docs, invalid, errors: top(errors, TOP_ERRORS), undeclared: top(undeclared) };
}

function describe({ name, docs, invalid, errors, undeclared }) {
  const lines = [`${name}: ${invalid} de ${docs} no pasan su schema`];
  if (errors.length) lines.push(`  errores: ${errors.map(([label, count]) => `${label} ×${count}`).join("; ")}`);
  if (undeclared.length) lines.push(`  campos sin declarar: ${undeclared.map(([field, count]) => `${field} ×${count}`).join(", ")}`);
  return lines.join("\n");
}

/**
 * Devuelve `{ collections, invalid, undeclared }`: el detalle de cada
 * colección con modelo que existe en la base, cuántos documentos no pasan su
 * schema y cuántos campos sin declarar distintos quedan. `db` es la base de la
 * conexión por defecto de mongoose (la de los modelos).
 */
async function verifySchemas(db, { log = () => {} } = {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name));
  const collections = [];
  for (const [name, models] of [...modelsByCollection()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!existing.has(name)) continue;
    const result = await verifyCollection(db, name, models);
    if (result.invalid || result.undeclared.length) log(describe(result));
    collections.push(result);
  }
  const invalid = collections.reduce((total, result) => total + result.invalid, 0);
  const undeclared = collections.reduce((total, result) => total + result.undeclared.length, 0);
  log(`${collections.length} colecciones: ${invalid} documentos no pasan su schema, ${undeclared} campos sin declarar`);
  return { collections, invalid, undeclared };
}

module.exports = { verifySchemas };
