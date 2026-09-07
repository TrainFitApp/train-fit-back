const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Limpieza (2026-09) — diettemplates guardaba `null` explícito en campos que
// simplemente no aplican al documento, por los `default: null` del schema.
// Quitados esos defaults, los documentos NUEVOS ya no llevan la clave; esto
// hace lo propio con los que ya estaban guardados.
//
// Las consultas no cambian: en MongoDB `{campo: null}` y `$in: [x, null]`
// casan igual con "null explícito" que con "campo ausente".
//
// Qué se limpia y qué NO:
//   · Plantilla (sin clientId): ninguno de los campos de asignación
//     significa nada ahí, así que se quitan todos los que estén a null.
//   · Asignación (clientId puesto): solo se quitan supersededBy y
//     sourceTemplateId, que se leen por verdadero/falso ("¿la sustituyó
//     algo?", "¿salió de una plantilla?"). startDate/endMode/endDate/status
//     NO se tocan: ahí `endDate: null` significa "indefinido" (ver
//     blocksNewPhase en plan-assignment-service.js), es un valor, no un
//     hueco, y borrarlo cambiaría el significado del documento.
//
// Uso:
//   node scripts/migrate-diet-template-drop-nulls.js --dry-run
//   node scripts/migrate-diet-template-drop-nulls.js

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-diet-template-drop-nulls]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// En una plantilla nada de esto aplica.
const TEMPLATE_FIELDS = [
  "clientId",
  "ownerClientId",
  "startDate",
  "endMode",
  "endDate",
  "status",
  "supersededBy",
  "sourceTemplateId",
];

// En una asignación solo estos dos son "ausencia", no dato.
const ASSIGNMENT_FIELDS = ["ownerClientId", "supersededBy", "sourceTemplateId"];

async function cleanGroup(collection, label, matchStage, fields) {
  let scanned = 0;
  let updated = 0;

  for (const field of fields) {
    const filter = { ...matchStage, [field]: null };
    const count = await collection.countDocuments(filter);
    if (!count) continue;

    scanned += count;
    log(`${label}: ${count} documento(s) con ${field}: null`);
    if (!DRY_RUN) {
      const result = await collection.updateMany(filter, { $unset: { [field]: "" } });
      updated += result.modifiedCount || 0;
    } else {
      updated += count;
    }
  }

  ok(`${label}: ${scanned} campo(s) null encontrados, ${updated} limpiados`);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const collection = mongoose.connection.collection("diettemplates");

  const totalTemplates = await collection.countDocuments({ clientId: null });
  const totalAssignments = await collection.countDocuments({ clientId: { $ne: null } });
  log(`plantillas: ${totalTemplates} · asignaciones: ${totalAssignments}`);

  // Ojo con el orden: limpiar clientId de las plantillas cambiaría a qué
  // grupo pertenecen si se recalculara después, así que las asignaciones se
  // resuelven ANTES con el filtro { clientId: { $ne: null } }, que no se ve
  // afectado por el $unset de las plantillas (ausente y null casan igual).
  await cleanGroup(collection, "asignaciones", { clientId: { $ne: null } }, ASSIGNMENT_FIELDS);
  await cleanGroup(collection, "plantillas", { clientId: null }, TEMPLATE_FIELDS);

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
