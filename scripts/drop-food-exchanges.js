const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Borra los restos de Intercambios (función retirada 2026-09): la colección
// `foodexchangegroups` y el campo `mealExchanges` de los objetivos
// nutricionales. Va con el driver nativo y no con los modelos: el schema ya
// no declara ninguno de los dos, y con strictQuery un filtro por un campo
// que no está en el schema se vacía y afectaría a TODOS los documentos.
//
//   node scripts/drop-food-exchanges.js --dry-run
//   node scripts/drop-food-exchanges.js

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const uri = buildMongoUri();
  console.log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const hasGroups = (await db.listCollections({ name: "foodexchangegroups" }).toArray()).length > 0;
  const groups = hasGroups ? await db.collection("foodexchangegroups").countDocuments() : 0;
  const goalsFilter = { mealExchanges: { $exists: true } };
  const goals = await db.collection("nutritionalgoals").countDocuments(goalsFilter);
  console.log(`foodexchangegroups: ${hasGroups ? groups + " docs" : "no existe"}`);
  console.log(`nutritionalgoals con mealExchanges: ${goals}`);

  if (!DRY_RUN) {
    if (hasGroups) await db.collection("foodexchangegroups").drop();
    const { modifiedCount } = await db
      .collection("nutritionalgoals")
      .updateMany(goalsFilter, { $unset: { mealExchanges: "" } });
    console.log(`colección borrada: ${hasGroups}, objetivos limpiados: ${modifiedCount}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
