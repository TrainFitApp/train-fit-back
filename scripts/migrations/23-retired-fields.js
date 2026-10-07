// Campos retirados (2026-10-07): ninguna pantalla ni ruta los lee ya.
//
//   coachprotocols.checkinTemplateId   un solo check-in sin cadencia, de antes
//                                      de `checkins`: pasa a `checkins` como
//                                      check-in semanal (lo que programaba).
//   users.nutritionPreferences.mealSlotLabels
//                                      nombres propios de las comidas; los
//                                      formularios dejaron de pedirlos.
//   users.lastPasswordChangeAt         solo se escribía.
//   checkinresponses.seenByTrainer     lo leía el buzón de check-ins que
//                                      sustituyó «Por revisar».
//   anthropometries.checkinSources     lo usaba una fusión de check-ins que
//                                      ya no existe.
//   products.nutriscoreScore / nutriscoreGrade
//                                      de la importación antigua de Open Food
//                                      Facts; no se muestran ni se escriben.
//
// Idempotente: cada filtro solo casa con documentos que aún tienen el campo.

const DEFAULT_CHECKIN = { frequency: "weekly", interval: 1, time: "09:00" };

const UNSETS = [
  // El usuario lleva contenido embebido con compare-and-swap sobre __v.
  { collection: "users", fields: ["nutritionPreferences.mealSlotLabels", "lastPasswordChangeAt"], versioned: true },
  { collection: "checkinresponses", fields: ["seenByTrainer"] },
  { collection: "anthropometries", fields: ["checkinSources"] },
  { collection: "products", fields: ["nutriscoreScore", "nutriscoreGrade"] },
];

async function migrateProtocolCheckins(db, dryRun) {
  const protocols = db.collection("coachprotocols");
  const legacy = await protocols
    .find({ checkinTemplateId: { $exists: true } }, { projection: { checkinTemplateId: 1, checkins: 1 } })
    .toArray();
  const operations = legacy.map((protocol) => {
    const update = { $unset: { checkinTemplateId: 1 } };
    if (protocol.checkinTemplateId && !(protocol.checkins || []).length) {
      update.$set = { checkins: [{ templateId: protocol.checkinTemplateId, ...DEFAULT_CHECKIN }] };
    }
    return { updateOne: { filter: { _id: protocol._id }, update } };
  });
  if (!dryRun && operations.length) await protocols.bulkWrite(operations, { ordered: false });
  return {
    protocols: operations.length,
    protocolCheckinsMoved: operations.filter((operation) => operation.updateOne.update.$set).length,
  };
}

async function migrateRetiredFields(db, { dryRun = false } = {}) {
  const stats = await migrateProtocolCheckins(db, dryRun);
  for (const { collection, fields, versioned } of UNSETS) {
    const filter = { $or: fields.map((field) => ({ [field]: { $exists: true } })) };
    const update = { $unset: Object.fromEntries(fields.map((field) => [field, 1])), ...(versioned ? { $inc: { __v: 1 } } : {}) };
    const target = db.collection(collection);
    stats[collection] = dryRun ? await target.countDocuments(filter) : (await target.updateMany(filter, update)).modifiedCount;
  }
  return stats;
}

module.exports = { migrateRetiredFields };
