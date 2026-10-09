// Índices de toda la base, rehechos desde el código
// (scripts/rebuild-indexes.js, que también se lanza a mano con
// `npm run rebuild:indexes`): se borran todos y se crean los que declaran los
// schemas y los de búsqueda de products y recipes, después de rellenar sus
// campos derivados.
//
// Va siempre el último (por eso el 99): los pasos anteriores dejan los datos
// con su forma definitiva y un paso nuevo se añade antes que este. Si un índice no se
// puede crear (un único con datos duplicados), el paso falla y no se apunta:
// se arreglan los datos y se vuelve a lanzar la migración.

const { rebuildIndexes } = require("../rebuild-indexes");

async function migrateIndexes(db, { dryRun = false, log = () => {} } = {}) {
  const { collections, unmodeled, failed } = await rebuildIndexes(db, { dryRun, log });
  if (failed.length) {
    throw new Error(`Índices sin crear en ${failed.join(", ")}: revisa los datos (duplicados) y vuelve a lanzar la migración.`);
  }
  return {
    collections: collections.length,
    retired: collections.reduce((total, result) => total + result.retired.length, 0),
    added: collections.reduce((total, result) => total + result.added.length, 0),
    unmodeled,
  };
}

module.exports = { migrateIndexes };
