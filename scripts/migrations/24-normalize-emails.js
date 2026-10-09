// Emails con mayúsculas o espacios (2026-10-09, ensayo sobre la copia de PRO:
// 5 cuentas). El schema de User pasa el email a minúsculas en cada consulta,
// así que una cuenta guardada con mayúsculas no la encuentra nadie: ni el
// inicio de sesión ni una invitación.
//
//   - Sin otra cuenta con el mismo email normalizado: se normaliza.
//   - Con otra cuenta que ya lo tiene: la de mayúsculas es inalcanzable (el
//     inicio de sesión entra en la otra) y se borra como cualquier cuenta,
//     con la cascada de util/account-cascade.js.
//
// Se recorren de la más antigua a la más nueva: si dos sin normalizar chocan
// entre sí, se queda la más antigua. Idempotente: el filtro solo casa con
// emails sin normalizar.

const User = require("../../components/users/user-schema");
const { normalizeEmail } = require("../../components/util/normalize-email");

const UNNORMALIZED = { $expr: { $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }] } };

async function migrateNormalizeEmails(db, { dryRun = false, log = () => {} } = {}) {
  const users = db.collection("users");
  const pending = await users.find(UNNORMALIZED, { projection: { email: 1 } }).sort({ _id: 1 }).toArray();
  const stats = { normalized: 0, deletedDuplicates: 0 };

  for (const user of pending) {
    const email = normalizeEmail(user.email);
    const twin = await users.findOne({ _id: { $ne: user._id }, email }, { projection: { _id: 1 } });
    if (twin) {
      stats.deletedDuplicates += 1;
      log(`borrar ${user._id}: duplicada de ${twin._id}`);
      if (!dryRun) await User.deleteOne({ _id: user._id });
      continue;
    }
    stats.normalized += 1;
    // El usuario lleva contenido embebido con compare-and-swap sobre __v.
    if (!dryRun) await users.updateOne({ _id: user._id }, { $set: { email }, $inc: { __v: 1 } });
  }
  return stats;
}

module.exports = { migrateNormalizeEmails };
