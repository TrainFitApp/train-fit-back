// Audita y normaliza (trim + lowercase) los emails de usuarios existentes.
//
// - Siempre reporta: total de usuarios, cuántos tienen el email guardado sin
//   normalizar, y cuántos GRUPOS de usuarios colisionan solo por
//   mayúsculas/minúsculas (mismo email normalizado, cuentas distintas).
// - Los conflictos (mismo email normalizado en más de una cuenta) NUNCA se
//   tocan automáticamente — se listan con datos suficientes (roles, premium,
//   hash pendiente de verificar, lastLogin) para decidir manualmente cuál
//   cuenta conservar.
// - Los usuarios sin conflicto cuyo email no está normalizado se corrigen
//   (solo fuera de --dry-run).
const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");
const User = require("../components/users/schema");

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

async function migrate() {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("DRY RUN — no changes will be made");

  const mongoUri = buildMongoUri();
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const users = await User.find({})
    .select("_id email lastLogin roles hash provider premium.entitled")
    .lean();

  console.log(`Total usuarios: ${users.length}`);

  const groups = new Map();
  let nonNormalizedCount = 0;

  for (const user of users) {
    if (typeof user.email !== "string") continue;
    const normalized = normalizeEmail(user.email);
    if (normalized !== user.email) nonNormalizedCount += 1;
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(user);
  }

  const conflictGroups = [...groups.entries()].filter(([, docs]) => docs.length > 1);

  console.log(`Emails guardados sin normalizar (trim/lowercase): ${nonNormalizedCount}`);
  console.log(`Grupos en conflicto (mismo email solo por mayúsculas): ${conflictGroups.length}`);

  if (conflictGroups.length) {
    console.log("\n=== CONFLICTOS — requieren decisión manual, no se tocan ===");
    for (const [normalized, docs] of conflictGroups) {
      console.log(`\n- ${normalized} (${docs.length} cuentas):`);
      for (const doc of docs) {
        console.log(
          `    _id=${doc._id} email="${doc.email}" roles=${JSON.stringify(doc.roles)} ` +
            `premium=${Boolean(doc.premium?.entitled)} pendienteVerificar=${Boolean(doc.hash)} ` +
            `provider=${doc.provider || "email"} lastLogin=${doc.lastLogin || "nunca"}`,
        );
      }
    }
  }

  let migrated = 0;
  let skipped = 0;

  for (const [normalized, docs] of groups.entries()) {
    if (docs.length > 1) continue; // conflicto: no tocar
    const [doc] = docs;
    if (doc.email === normalized) {
      skipped += 1;
      continue;
    }

    if (isDryRun) {
      console.log(`[DRY RUN] Normalizaría ${doc._id}: "${doc.email}" -> "${normalized}"`);
      migrated += 1;
      continue;
    }

    await User.updateOne({ _id: doc._id }, { $set: { email: normalized } });
    migrated += 1;
  }

  console.log(`\nUsuarios ${isDryRun ? "a normalizar" : "normalizados"}: ${migrated}`);
  console.log(`Usuarios ya normalizados (sin cambios): ${skipped}`);
  if (conflictGroups.length) {
    console.log(
      `Usuarios NO tocados por estar en conflicto: ${conflictGroups.reduce((acc, [, docs]) => acc + docs.length, 0)}`,
    );
  }

  await mongoose.disconnect();
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
