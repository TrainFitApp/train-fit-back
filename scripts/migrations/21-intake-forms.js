// El formulario de alta pasa a ser de cada cliente (2026-10).
//
// Antes:  el cuestionario se leía de la configuración del profesional
//         (users.trainerSettings.intake) al abrirlo y al enviarlo, así que
//         cambiarla para una invitación nueva cambiaba también el de los
//         clientes que aún no lo habían rellenado.
// Ahora:  al invitar se copia al par (trainerclients.intakeForm) lo que el
//         profesional tiene activo: campos, preguntas propias, medidas,
//         fotos y vídeos (trainerIntakeConfig/intake-requests.js#intakeFormOf).
//
// Cada par sin copia recibe la de la configuración actual de su
// profesional, que es la que veía hasta ahora. Idempotente: solo toca los
// pares sin `intakeForm`.

const { intakeFormOf } = require("../../components/trainerIntakeConfig/intake-requests");

// Lo último que se le mandó: la invitación más reciente del par.
function lastInvitedAt(pair, now) {
  const times = (pair.scopes || []).map((link) => new Date(link.invitedAt).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : now;
}

async function migrateIntakeForms(db, { dryRun = false, now = new Date() } = {}) {
  const pairs = await db
    .collection("trainerclients")
    .find({ $or: [{ intakeForm: { $exists: false } }, { intakeForm: null }] }, { projection: { trainerId: 1, scopes: 1 } })
    .toArray();
  const stats = { pairs: pairs.length, fromConfig: 0, withoutConfig: 0 };
  if (!pairs.length) return stats;

  const trainerIds = [...new Set(pairs.map((pair) => String(pair.trainerId)))];
  const trainers = await db
    .collection("users")
    .find({ _id: { $in: pairs.map((pair) => pair.trainerId) } }, { projection: { "trainerSettings.intake": 1 } })
    .toArray();
  const configs = new Map(trainers.map((trainer) => [String(trainer._id), trainer.trainerSettings?.intake || null]));
  const forms = new Map(trainerIds.map((id) => [id, intakeFormOf(configs.get(id) || null)]));

  const operations = pairs.map((pair) => {
    if (configs.get(String(pair.trainerId))) stats.fromConfig += 1;
    else stats.withoutConfig += 1;
    return {
      updateOne: {
        filter: { _id: pair._id, $or: [{ intakeForm: { $exists: false } }, { intakeForm: null }] },
        update: { $set: { intakeForm: { ...forms.get(String(pair.trainerId)), sentAt: lastInvitedAt(pair, now) } } },
      },
    };
  });
  if (!dryRun) await db.collection("trainerclients").bulkWrite(operations, { ordered: false });
  return stats;
}

module.exports = { migrateIntakeForms };
