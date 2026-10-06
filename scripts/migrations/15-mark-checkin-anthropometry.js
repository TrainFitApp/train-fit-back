// Marca en Anthropometry.checkinFields las medidas que escribieron los
// check-ins ANTES de que existiera la marca (anthropometry-origin.js). Sin
// ella el cliente las sigue viendo en weight-info como si fueran suyas.
//
// Aditiva: solo añade nombres de campo a `checkinFields`, nunca cambia ni
// borra una medida. Criterio: una respuesta de check-in escribía sus medidas
// en el día en que se respondía (respondedAt) y, si se corrigió, en el de la
// corrección (updatedAt). Se marca el campo si ese día tiene EXACTAMENTE el
// valor respondido; si el cliente lo cambió después, ya es suyo y no se toca.
//

const { CHECKIN_FIELDS_BY_KEY } = require("../../components/trainerCheckins/checkin-field-catalog");
const { isoDate } = require("../../components/util/date-util");

async function markCheckinAnthropometry(db, { dryRun = false, log = () => {} } = {}) {
  const anthropometries = db.collection("anthropometries");
  const responses = await db
    .collection("checkinresponses")
    .find({}, { projection: { clientId: 1, values: 1, respondedAt: 1, updatedAt: 1 } })
    .toArray();
  let marked = 0;
  let days = 0;
  for (const response of responses) {
    const fields = Object.entries(response.values || {})
      .map(([key, value]) => [CHECKIN_FIELDS_BY_KEY.get(key), value])
      .filter(([field]) => field?.storage === "anthropometry");
    if (!fields.length) continue;

    const dates = [...new Set([response.respondedAt, response.updatedAt].filter(Boolean).map(isoDate))];
    for (const date of dates) {
      const doc = await anthropometries.findOne({ userId: response.clientId, date });
      if (!doc) continue;
      const already = new Set(doc.checkinFields || []);
      const toMark = fields
        .filter(([field, value]) => doc[field.anthropometryField] === value && !already.has(field.anthropometryField))
        .map(([field]) => field.anthropometryField);
      if (!toMark.length) continue;
      days += 1;
      marked += toMark.length;
      log(`${response.clientId} ${date}: ${toMark.join(", ")}`);
      if (!dryRun) {
        await anthropometries.updateOne({ _id: doc._id }, { $addToSet: { checkinFields: { $each: toMark } } });
      }
    }
  }
  return { responses: responses.length, days, fields: marked };
}

module.exports = { markCheckinAnthropometry };
