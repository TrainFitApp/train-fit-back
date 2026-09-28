// Cobros 2026-09 — migra los cobros planos (amount/dueDate/paidAt) a la forma
// nueva: importes en céntimos, día civil de vencimiento, pagos como
// movimientos y saldo derivable. ADITIVA: no borra ni renombra campos, conserva
// los valores fuente en `legacy.*` y mantiene los _id (endpoints y avisos
// siguen apuntando al mismo cobro).
//
//   npm run migrate:trainer-payments:dry-run   (solo informe)
//   npm run migrate:trainer-payments
//
// Reglas (components/trainerPayments/src/legacy.ts#planMigration):
// - Pagado → un movimiento equivalente, idempotente (operationId
//   legacy-paid:<id>), método "unknown", día derivado de paidAt marcado como
//   "legacy_marked_paid" (cuándo se marcó, no cuándo llegó el dinero) y sin
//   fecha/autor de anotación inventados.
// - Sin pagar → conserva importe, vencimiento, nota y saldo.
// - Nunca crea cuotas recurrentes deducidas del histórico.
// - Otra divisa, decimales anómalos, fechas inválidas o ambiguas y relaciones
//   huérfanas se REPORTAN y no se convierten (siguen leyéndose como antiguos,
//   marcados para revisión).
// - No envía avisos: los cobros migrados abren su ventana de avisos al migrar.
// - Repetible: una segunda ejecución no encuentra nada que convertir.
// - Comprueba antes/después importe, recibido, pendiente y nº de movimientos
//   por entrenador y divisa.
const mongoose = require("mongoose");

function totalsKey(charge) {
  return `${charge.trainerId}|${charge.currency}`;
}

function totalsByOwner(C, charges) {
  const groups = new Map();
  for (const charge of charges) {
    const key = totalsKey(charge);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(charge);
  }
  const result = {};
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key);
    result[key] = C.ledgerTotals(list)[list[0].currency];
  }
  return result;
}

async function runMigration({ dryRun = true, now = new Date(), log = () => {} } = {}) {
  const C = require("../components/trainerPayments/core").load();
  const TrainerPayment = require("../components/trainerPayments/trainer-payment-schema");
  const mapper = require("../components/trainerPayments/trainer-payment-mapper");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const User = require("../components/users/schema");

  const legacyDocs = await TrainerPayment.find({ schemaVersion: { $exists: false } }).lean();
  const alreadyMigrated = await TrainerPayment.countDocuments({ schemaVersion: { $gte: 2 } });
  const report = {
    dryRun,
    scanned: legacyDocs.length,
    alreadyMigrated,
    converted: 0,
    skipped: [],
    orphans: [],
    conflicts: 0,
    totalsBefore: {},
    totalsAfter: {},
    totalsMatch: true,
  };
  if (!legacyDocs.length) return report;

  const trainerIds = [...new Set(legacyDocs.map((doc) => String(doc.trainerId)))];
  const userIds = [...new Set([...trainerIds, ...legacyDocs.map((doc) => String(doc.clientId))])];
  const users = new Set((await User.find({ _id: { $in: userIds } }).select("_id").lean()).map((user) => String(user._id)));
  const relations = await TrainerClient.find({ trainerId: { $in: trainerIds } }).select("trainerId clientId").lean();
  const pairs = new Set(relations.map((relation) => `${relation.trainerId}:${relation.clientId}`));

  const allOfOwners = async () =>
    (await TrainerPayment.find({ trainerId: { $in: trainerIds } }).lean())
      .map((doc) => C.normalizeCharge(mapper.toChargeRecord(doc)))
      .filter((charge) => charge.status !== "void");
  report.totalsBefore = totalsByOwner(C, await allOfOwners());

  for (const doc of legacyDocs) {
    const id = String(doc._id);
    const pair = `${doc.trainerId}:${doc.clientId}`;
    if (!users.has(String(doc.trainerId)) || !users.has(String(doc.clientId)) || !pairs.has(pair)) {
      report.orphans.push({
        id,
        trainerId: String(doc.trainerId),
        clientId: String(doc.clientId),
        missingTrainer: !users.has(String(doc.trainerId)),
        missingClient: !users.has(String(doc.clientId)),
        missingRelation: !pairs.has(pair),
      });
      continue;
    }
    const plan = C.planMigration(mapper.toChargeRecord(doc), now);
    if (plan.action === "skip") {
      if (plan.reason === "anomalies") {
        report.skipped.push({
          id,
          trainerId: String(doc.trainerId),
          anomalies: plan.anomalies,
          amount: doc.amount,
          currency: doc.currency,
          dueDate: doc.dueDate,
          paidAt: doc.paidAt,
        });
      }
      continue;
    }
    if (!dryRun) {
      // Mismo guardado que una escritura del entrenador, condicionado a que
      // el documento siga sin migrar (otra ejecución en paralelo no duplica).
      const result = await TrainerPayment.updateOne(
        { _id: doc._id, schemaVersion: { $exists: false } },
        { $set: { ...mapper.chargeToSet(plan.charge, { syncDueDate: false }), reminderLog: [] } }
      );
      if (result.matchedCount !== 1) {
        report.conflicts += 1;
        continue;
      }
    }
    report.converted += 1;
  }

  report.totalsAfter = dryRun ? report.totalsBefore : totalsByOwner(C, await allOfOwners());
  report.totalsMatch = JSON.stringify(report.totalsBefore) === JSON.stringify(report.totalsAfter);
  log(report);
  return report;
}

module.exports = { runMigration };

if (require.main === module) {
  (async () => {
    require("dotenv").config();
    const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
    const dryRun = process.argv.includes("--dry-run");
    const uri = buildMongoUri();
    console.log(`${dryRun ? "DRY RUN — sin cambios. " : ""}Conectando a ${redactMongoUri(uri)}`);
    await mongoose.connect(uri);
    const report = await runMigration({ dryRun });
    console.log(JSON.stringify(report, null, 2));
    if (!report.totalsMatch) console.error("❌ Los totales antes/después NO coinciden: revisa el informe.");
    if (report.skipped.length || report.orphans.length) {
      console.warn(`⚠️ ${report.skipped.length} con anomalías y ${report.orphans.length} huérfanos: no convertidos, revisar a mano.`);
    }
    await mongoose.disconnect();
    process.exit(report.totalsMatch ? 0 : 1);
  })().catch(async (error) => {
    console.error("❌ Migración fallida:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
