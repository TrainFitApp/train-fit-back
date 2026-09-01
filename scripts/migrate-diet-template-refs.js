const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[migrate-diet-template-refs]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);
const errLog = (...args) => console.error(LOG_PREFIX, "ERROR", ...args);

// Migración a "las plantillas nunca se asignan directamente, y ya no hace
// falta una colección PlanAssignment aparte":
//
// Antes: PlanAssignment.planId apuntaba EN VIVO a la DietTemplate del
// entrenador — editar o borrar la plantilla después de asignarla afectaba en
// silencio a los clientes que ya la tenían asignada.
//
// Ahora: cada asignación es una COPIA congelada de DietTemplate (clientId
// puesto), con sus propios campos de fecha/estado — la copia ES la
// asignación, ver diet-template-schema.js. La colección "planassignments"
// desaparece.
//
// Este script, para cada PlanAssignment que aún exista en producción:
//   1. Congela una copia de la plantilla que referenciaba, con sus fechas.
//   2. Reapunta supersededBy (que encadenaba PlanAssignment con
//      PlanAssignment) para que encadene copia con copia.
//   3. Reapunta DietException.assignmentId de la asignación vieja a la copia.
//   4. Al final, borra la colección "planassignments" — ya nadie la lee.
//
// Seguro de reejecutar: una plantilla referenciada que YA tiene clientId
// puesto (ya es una copia) se salta sin tocarla.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const db = mongoose.connection.db;
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const DietException = require("../components/dietExceptions/diet-exception-schema");

  const oldAssignments = await db.collection("planassignments").find({}).toArray();
  log(`${oldAssignments.length} PlanAssignment encontradas en la colección vieja`);

  const idMap = new Map(); // oldAssignmentId (string) -> newCopyId (ObjectId)
  let migrated = 0;
  let skippedAlready = 0;
  let skippedMissing = 0;

  // Paso 1 — congelar una copia por cada asignación vieja.
  for (const old of oldAssignments) {
    const plan = await DietTemplate.findById(old.planId);

    if (!plan) {
      skippedMissing += 1;
      errLog(
        `asignación ${old._id} (cliente ${old.clientId}) apunta a una plantilla ${old.planId} ` +
          `que ya no existe — no se puede migrar, revisar a mano`
      );
      continue;
    }

    if (plan.clientId) {
      skippedAlready += 1;
      idMap.set(String(old._id), plan._id);
      continue;
    }

    const frozenCopy = await dietTemplateDao.cloneForAssignment(plan, old.clientId, {
      startDate: old.startDate,
      endMode: old.endMode,
      endDate: old.endDate,
      status: old.status,
    });
    idMap.set(String(old._id), frozenCopy._id);
    migrated += 1;
    log(`asignación ${old._id}: plantilla ${plan._id} -> copia ${frozenCopy._id}`);
  }

  // Paso 2 — reapuntar supersededBy (id de asignación vieja -> id de copia nueva).
  let supersededFixed = 0;
  for (const old of oldAssignments) {
    if (!old.supersededBy) continue;
    const newId = idMap.get(String(old._id));
    const newSupersededBy = idMap.get(String(old.supersededBy));
    if (!newId || !newSupersededBy) continue;
    await DietTemplate.updateOne({ _id: newId }, { $set: { supersededBy: newSupersededBy } });
    supersededFixed += 1;
  }
  ok(`supersededBy reapuntado en ${supersededFixed} copias`);

  // Paso 3 — reapuntar DietException.assignmentId.
  let exceptionsFixed = 0;
  for (const [oldId, newId] of idMap) {
    const result = await DietException.updateMany(
      { assignmentId: new mongoose.Types.ObjectId(oldId) },
      { $set: { assignmentId: newId } }
    );
    exceptionsFixed += result.modifiedCount;
  }
  ok(`DietException reapuntadas: ${exceptionsFixed}`);

  ok(`migradas: ${migrated}, ya migradas: ${skippedAlready}, plantilla borrada (revisar a mano): ${skippedMissing}`);

  // Paso 4 — la colección vieja ya no la lee nadie.
  if (skippedMissing === 0) {
    await db.collection("planassignments").drop();
    ok("colección 'planassignments' eliminada");
  } else {
    log(
      `colección 'planassignments' NO eliminada — hay ${skippedMissing} asignación(es) sin migrar, revísalas y vuelve a correr el script`
    );
  }

  log("migration complete");
  await mongoose.disconnect();
}

main().catch((err) => {
  errLog(err.message);
  process.exit(1);
});
