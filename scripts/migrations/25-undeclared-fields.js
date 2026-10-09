// Campos que ningún schema declara (2026-10-09, ensayo sobre la copia de PRO).
//
//   products.sugar100g     azúcar de la importación antigua de Open Food Facts
//                          (92.508 productos en PRO). El schema lo llama
//                          `sugars100g`: se mueve ahí si está vacío y, si no,
//                          se quita.
//   users.kcalTotal / proteinsGTotal / carbohydratesGTotal / fatGTotal
//                          objetivo de macros de antes de `nutritionalGoals`;
//                          la app usa el objetivo de `goalInUse`.
//   users.tourTable / tourDiet
//                          tutoriales de bienvenida que ya no existen.
//   dietdays.weight        peso del día; el peso vive en las medidas (paso 16).
//
// Idempotente: cada filtro solo casa con documentos que aún tienen el campo.

const UNSETS = [
  // Usuario y día llevan contenido embebido con compare-and-swap sobre __v.
  {
    collection: "users",
    fields: ["kcalTotal", "proteinsGTotal", "carbohydratesGTotal", "fatGTotal", "tourTable", "tourDiet"],
    versioned: true,
  },
  { collection: "dietdays", fields: ["weight"], versioned: true },
];

async function moveSugar(db, dryRun) {
  const products = db.collection("products");
  const move = { sugar100g: { $exists: true }, $or: [{ sugars100g: { $exists: false } }, { sugars100g: null }] };
  const drop = { sugar100g: { $exists: true }, sugars100g: { $ne: null, $exists: true } };
  if (dryRun) {
    return { sugarMoved: await products.countDocuments(move), sugarDropped: await products.countDocuments(drop) };
  }
  // Pipeline: el valor nuevo sale del propio documento.
  const moved = await products.updateMany(move, [{ $set: { sugars100g: "$sugar100g" } }, { $unset: "sugar100g" }]);
  const dropped = await products.updateMany(drop, { $unset: { sugar100g: 1 } });
  return { sugarMoved: moved.modifiedCount, sugarDropped: dropped.modifiedCount };
}

async function migrateUndeclaredFields(db, { dryRun = false } = {}) {
  const stats = await moveSugar(db, dryRun);
  for (const { collection, fields, versioned } of UNSETS) {
    const filter = { $or: fields.map((field) => ({ [field]: { $exists: true } })) };
    const update = { $unset: Object.fromEntries(fields.map((field) => [field, 1])), ...(versioned ? { $inc: { __v: 1 } } : {}) };
    const target = db.collection(collection);
    stats[collection] = dryRun ? await target.countDocuments(filter) : (await target.updateMany(filter, update)).modifiedCount;
  }
  return stats;
}

module.exports = { migrateUndeclaredFields };
