const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Facturación de entrenadores por plazas (2026-10-02). Deja los datos con la forma nueva:
//
//   1. User.professionalPremium que no viene de Stripe (RevenueCat Pro 15, Unlimited, manual):
//      se borra. Los entrenadores solo se suscriben por Stripe.
//   2. Proyecciones de Stripe: tier con los nombres nuevos (trainer_pro → starter,
//      trainer_growth → professional, trainer_scale → scale), plan → interval, seats con las
//      plazas del plan anterior (20, 50, 150) y sin source.
//   3. Cuentas de facturación (trainerbillingaccounts): mismo cambio de tier, extraSeats 0 y sin
//      Checkout a medias del catálogo anterior.
//
// Las suscripciones de Stripe con precios del catálogo anterior no se tocan: la reconciliación las
// marca para revisión. No hay entrenadores pagando; en el sandbox se cancelan a mano.
// Idempotente.
//
// Uso:
//   npm run migrate:trainer-seats:dry-run
//   npm run migrate:trainer-seats

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[migrate-trainer-seats]";
const log = (...a) => console.log(LOG, ...a);
const TIERS = { trainer_pro: "starter", trainer_growth: "professional", trainer_scale: "scale" };
const SEATS = { starter: 20, professional: 50, scale: 150 };

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");
  const users = mongoose.connection.collection("users");
  const accounts = mongoose.connection.collection("trainerbillingaccounts");

  // Solo las que dan o dieron acceso (RevenueCat o manual); el subdocumento vacío por defecto no se toca.
  const legacy = { $or: [{ "professionalPremium.source": { $nin: [null, "stripe"] } },
    { "professionalPremium.tier": "trainer_unlimited" }] };
  log(`proyecciones ajenas a Stripe por borrar: ${await users.countDocuments(legacy)}`);
  if (!DRY_RUN) log(`  borradas: ${(await users.updateMany(legacy, { $unset: { professionalPremium: 1 } })).modifiedCount}`);

  const stripeRows = await users.find({ "professionalPremium.source": "stripe" }).project({ professionalPremium: 1 }).toArray();
  log(`proyecciones de Stripe por convertir: ${stripeRows.length}`);
  for (const row of stripeRows) {
    const premium = row.professionalPremium || {};
    const tier = TIERS[premium.tier] || premium.tier || null;
    const set = { "professionalPremium.tier": tier, "professionalPremium.interval": premium.plan || null,
      "professionalPremium.seats": SEATS[tier] || 3 };
    log(`  ${row._id}: ${premium.tier || "—"} → ${tier || "—"}`);
    if (!DRY_RUN) {
      await users.updateOne({ _id: row._id }, { $set: set, $unset: { "professionalPremium.plan": 1, "professionalPremium.source": 1 } });
    }
  }

  const accountFilter = { $or: [{ tier: { $in: Object.keys(TIERS) } }, { extraSeats: { $exists: false } }, { "checkout.priceId": { $exists: true } }] };
  const accountRows = await accounts.find(accountFilter).project({ tier: 1, checkout: 1 }).toArray();
  log(`cuentas de facturación por convertir: ${accountRows.length}`);
  for (const row of accountRows) {
    const set = { extraSeats: 0 };
    if (TIERS[row.tier]) set.tier = TIERS[row.tier];
    const update = { $set: set };
    if (row.checkout?.priceId) update.$unset = { checkout: 1 };
    if (!DRY_RUN) await accounts.updateOne({ _id: row._id }, update);
  }
  if (DRY_RUN) log("dry-run, sin cambios");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(LOG, error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
