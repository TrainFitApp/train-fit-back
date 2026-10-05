const mongoose = require("mongoose");
const { timeZoneOf, todayIsoDate } = require("../util/date-util");

// La zona horaria de OTRO usuario: lo que necesita un entrenador para saber
// qué es "hoy" para su cliente. La del propio usuario ya viene resuelta en
// req.auth.timeZone (middleware/validateAuth.js), sin consulta.
//
// El modelo se pide al llamar, no al cargar: users/schema.js arrastra medio
// proyecto en sus hooks y un require aquí arriba sería un ciclo esperando a
// pasar.
async function timeZoneOfUser(userId) {
  const user = await mongoose.model("User").findById(userId).select("timezone").lean();
  return timeZoneOf(user);
}

async function todayForUser(userId) {
  return todayIsoDate(await timeZoneOfUser(userId));
}

module.exports = { timeZoneOfUser, todayForUser };
