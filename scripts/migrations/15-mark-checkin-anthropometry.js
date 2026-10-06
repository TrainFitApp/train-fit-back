const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

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
// Uso:
//   node scripts/mark-checkin-anthropometry.js --dry-run
//   node scripts/mark-checkin-anthropometry.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[mark-checkin-anthropometry]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);

  const { CHECKIN_FIELDS_BY_KEY } = require("../components/trainerCheckins/checkin-field-catalog");
  const { isoDate } = require("../components/util/date-util");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const Anthropometry = mongoose.models.Anthropometry
    || mongoose.model("Anthropometry", require("../components/anthropometry/anthropometry-schema"));

  const responses = await CheckinResponse.find({}).select("clientId values respondedAt updatedAt").lean();
  let marked = 0;
  let docs = 0;
  for (const response of responses) {
    const fields = Object.entries(response.values || {})
      .map(([key, value]) => [CHECKIN_FIELDS_BY_KEY.get(key), value])
      .filter(([field]) => field?.storage === "anthropometry");
    if (!fields.length) continue;

    const dates = [...new Set([response.respondedAt, response.updatedAt].filter(Boolean).map(isoDate))];
    for (const date of dates) {
      const doc = await Anthropometry.findOne({ userId: response.clientId, date }).lean();
      if (!doc) continue;
      const already = new Set(doc.checkinFields || []);
      const toMark = fields
        .filter(([field, value]) => doc[field.anthropometryField] === value && !already.has(field.anthropometryField))
        .map(([field]) => field.anthropometryField);
      if (!toMark.length) continue;
      docs++;
      marked += toMark.length;
      log(`${DRY_RUN ? "(dry) " : ""}${response.clientId} ${date}: ${toMark.join(", ")}`);
      if (!DRY_RUN) {
        await Anthropometry.updateOne({ _id: doc._id }, { $addToSet: { checkinFields: { $each: toMark } } });
      }
    }
  }
  log(`respuestas revisadas=${responses.length} días=${docs} campos=${marked}${DRY_RUN ? " (sin escribir)" : ""}`);
}

main()
  .catch((error) => {
    console.error(LOG, error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
