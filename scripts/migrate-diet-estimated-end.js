const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { addDaysToIsoDate } = require("../components/util/period-util");

// Duración estimada (2026-09) — la fecha de fin de una fase dejó de ser un
// límite duro y pasó a ser una ESTIMACIÓN: la fase corre hasta que el
// entrenador abre la siguiente. Ver diet-template-schema.js#estimatedEndDate.
//
// Para los datos que ya existen:
//   · Copia ACTIVA con endDate en el futuro → ese endDate era la duración que
//     eligió el entrenador, así que pasa a estimatedEndDate y endDate se
//     vacía (la fase sigue viva hasta que algo la corte).
//   · Copia ya SUPERSEDED sin endDate → se estampa su fin REAL: el día
//     anterior al inicio de la copia que la sustituyó (hasta ahora
//     markSuperseded no guardaba ninguna fecha, así que el historial de las
//     fases indefinidas no tenía dónde cerrar).
//   · No se toca nada más: una copia pasada con su endDate real ya es
//     correcta, y las plantillas de biblioteca no tienen estos campos.
//
// Uso:
//   node scripts/migrate-diet-estimated-end.js --dry-run
//   node scripts/migrate-diet-estimated-end.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[migrate-diet-estimated-end]";
const log = (...a) => console.log(LOG, ...a);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  // Mismo motivo que en migrate-diet-phases.js: el autopopulate en cascada de
  // DietTemplate exige tener registrados estos modelos antes de cualquier find.
  require("../components/users/schema");
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");

  const hoy = todayIso();

  // --- 1) Activas con fin futuro: ese fin era la duración elegida ---
  const activas = await DietTemplate.find({
    clientId: { $ne: null },
    status: "active",
    endDate: { $ne: null, $gt: hoy },
  })
    .select("_id name startDate endDate estimatedEndDate")
    .lean();

  log(`activas con fin futuro: ${activas.length}`);
  for (const fase of activas) {
    log(
      `  · ${fase._id} «${fase.name}» ${fase.startDate} → ${fase.endDate}` +
        `   ⇒ estimatedEndDate=${fase.endDate}, endDate=null`
    );
    if (!DRY_RUN) {
      await DietTemplate.updateOne(
        { _id: fase._id },
        { $set: { estimatedEndDate: fase.endDate, endDate: null } }
      );
    }
  }

  // --- 2) Sustituidas sin fin real: se estampa el día antes de su sucesora ---
  const sustituidas = await DietTemplate.find({
    clientId: { $ne: null },
    status: "superseded",
    $or: [{ endDate: null }, { endDate: { $exists: false } }],
    supersededBy: { $ne: null },
  })
    .select("_id name startDate supersededBy")
    .lean();

  log(`sustituidas sin fin real: ${sustituidas.length}`);
  let sinSucesora = 0;
  for (const fase of sustituidas) {
    const sucesora = await DietTemplate.findById(fase.supersededBy).select("startDate").lean();
    if (!sucesora?.startDate) {
      // La sucesora se borró (o nunca tuvo fecha): sin referencia no se puede
      // inventar un fin. Se deja como está — sigue leyéndose como "abierta",
      // que es exactamente lo que se sabe de ella.
      sinSucesora += 1;
      continue;
    }
    // Nunca antes de su propio inicio (sustituida el mismo día en que empezó):
    // un rango invertido no casaría con ninguna fecha.
    const vispera = addDaysToIsoDate(sucesora.startDate, -1);
    const finReal = vispera < fase.startDate ? fase.startDate : vispera;
    log(`  · ${fase._id} «${fase.name}» ${fase.startDate} ⇒ endDate=${finReal}`);
    if (!DRY_RUN) {
      await DietTemplate.updateOne({ _id: fase._id }, { $set: { endDate: finReal } });
    }
  }
  if (sinSucesora) log(`  (${sinSucesora} sin sucesora legible, se dejan intactas)`);

  log(DRY_RUN ? "DRY RUN — no se ha escrito nada" : "hecho");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(LOG, e);
  process.exit(1);
});
