// La fecha de nacimiento pasa a día de calendario (2026-10).
//
// Antes:  users.birth era un Date y cada vía lo escribía a su manera:
//           - registro (ruedas): la medianoche del dispositivo pasada a UTC
//             (en España, el 5 de mayo quedaba 1990-05-04T22:00Z);
//           - editor de perfil: "1990-05-05T00:00:00" sin huso, leído en la
//             zona del servidor;
//           - cuestionario de alta: "1990-05-05", medianoche UTC.
//         Cada pantalla lo volvía a pintar en su zona y el cumpleaños se
//         movía un día (y el cuestionario, al reenviarlo, lo guardaba ya
//         movido).
// Ahora:  "YYYY-MM-DD", el día que eligió el usuario (users/age-policy.js).
//
// Para recuperar ese día: la medianoche UTC exacta es el día UTC (cuestionario,
// o editor con el servidor en UTC); cualquier otra hora, el día en la zona del
// usuario (su `timezone` o Madrid), que deshace la conversión del dispositivo.
// Idempotente: solo toca los que siguen siendo Date.

const DEFAULT_TIME_ZONE = "Europe/Madrid";

function dayInZone(date, timeZone) {
  const format = (zone) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  try {
    return format(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return format(DEFAULT_TIME_ZONE);
  }
}

function birthDay(date, timeZone) {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : dayInZone(date, timeZone);
}

async function migrateUserBirthDate(db, { dryRun = false } = {}) {
  const users = db.collection("users");
  const withDate = await users
    .find({ birth: { $type: "date" } }, { projection: { birth: 1, timezone: 1 } })
    .toArray();
  const stats = { users: withDate.length, utcMidnight: 0, inZone: 0, invalid: 0 };

  const operations = [];
  for (const user of withDate) {
    if (Number.isNaN(user.birth.getTime())) {
      stats.invalid += 1;
      operations.push({ updateOne: { filter: { _id: user._id }, update: { $unset: { birth: "" } } } });
      continue;
    }
    if (user.birth.toISOString().endsWith("T00:00:00.000Z")) stats.utcMidnight += 1;
    else stats.inZone += 1;
    operations.push({
      updateOne: { filter: { _id: user._id }, update: { $set: { birth: birthDay(user.birth, user.timezone) } } },
    });
  }
  if (!dryRun && operations.length) await users.bulkWrite(operations, { ordered: false });
  return stats;
}

module.exports = { migrateUserBirthDate };
