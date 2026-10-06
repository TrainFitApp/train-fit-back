// Favoritos del usuario (2026-10, docs/refactor-modelo-datos-estado.md B5).
//
// Antes:  users.archivedProducts / archivedRecipes / archivedExercises
// Ahora:  users.favorites.{products, recipes, exercises}
//
// Idempotente: une lo viejo con lo que ya hubiera en `favorites` (sin
// repetidos) y quita los campos viejos. Trabaja con la colección en crudo.


const FIELDS = { archivedProducts: "products", archivedRecipes: "recipes", archivedExercises: "exercises" };
const OLD = Object.keys(FIELDS);

async function migrateUserFavorites(db, { dryRun = false } = {}) {
  const users = db.collection("users");
  const filter = { $or: OLD.map((field) => ({ [field]: { $exists: true } })) };
  const stats = { users: await users.countDocuments(filter) };
  if (dryRun || !stats.users) return stats;

  const union = (oldField, kind) => ({
    $setUnion: [{ $ifNull: [`$favorites.${kind}`, []] }, { $ifNull: [`$${oldField}`, []] }],
  });
  await users.updateMany(filter, [
    { $set: Object.fromEntries(OLD.map((field) => [`favorites.${FIELDS[field]}`, union(field, FIELDS[field])])) },
    { $unset: OLD },
  ]);
  return stats;
}

module.exports = { migrateUserFavorites };
