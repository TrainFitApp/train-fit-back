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

const TIERS = { trainer_pro: "starter", trainer_growth: "professional", trainer_scale: "scale" };
const SEATS = { starter: 20, professional: 50, scale: 150 };

async function migrateTrainerBillingSeats(db, { dryRun = false, log = () => {} } = {}) {
  const users = db.collection("users");
  const accounts = db.collection("trainerbillingaccounts");
  const stats = { removedProjections: 0, convertedProjections: 0, convertedAccounts: 0 };

  // Solo las que dan o dieron acceso (RevenueCat o manual); el subdocumento vacío por defecto no se toca.
  const legacy = {
    $or: [{ "professionalPremium.source": { $nin: [null, "stripe"] } }, { "professionalPremium.tier": "trainer_unlimited" }],
  };
  stats.removedProjections = await users.countDocuments(legacy);
  if (!dryRun && stats.removedProjections) await users.updateMany(legacy, { $unset: { professionalPremium: 1 } });

  const stripeRows = await users.find({ "professionalPremium.source": "stripe" }).project({ professionalPremium: 1 }).toArray();
  for (const row of stripeRows) {
    const premium = row.professionalPremium || {};
    const tier = TIERS[premium.tier] || premium.tier || null;
    log(`${row._id}: ${premium.tier || "—"} → ${tier || "—"}`);
    stats.convertedProjections += 1;
    if (!dryRun) {
      await users.updateOne(
        { _id: row._id },
        {
          $set: {
            "professionalPremium.tier": tier,
            "professionalPremium.interval": premium.plan || null,
            "professionalPremium.seats": SEATS[tier] || 3,
          },
          $unset: { "professionalPremium.plan": 1, "professionalPremium.source": 1 },
        },
      );
    }
  }

  const accountFilter = {
    $or: [{ tier: { $in: Object.keys(TIERS) } }, { extraSeats: { $exists: false } }, { "checkout.priceId": { $exists: true } }],
  };
  const accountRows = await accounts.find(accountFilter).project({ tier: 1, checkout: 1 }).toArray();
  for (const row of accountRows) {
    stats.convertedAccounts += 1;
    const set = { extraSeats: 0 };
    if (TIERS[row.tier]) set.tier = TIERS[row.tier];
    const update = { $set: set };
    if (row.checkout?.priceId) update.$unset = { checkout: 1 };
    if (!dryRun) await accounts.updateOne({ _id: row._id }, update);
  }
  return stats;
}

module.exports = { migrateTrainerBillingSeats };
