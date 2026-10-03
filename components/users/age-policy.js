// Edad mínima para tener cuenta en TrainFit: 14 años, la edad a partir de la
// cual se puede consentir el tratamiento de datos sin los padres en España
// (LOPDGDD art. 7). El front la aplica en el registro y en el editor de
// perfil; aquí se repite para que no dependa de él.
//
// PURO: sin Mongo.

const MIN_USER_AGE = 14;

/** ¿Tiene `birth` al menos MIN_USER_AGE años en `now`? Fechas inválidas: no. */
function isOldEnough(birth, now = new Date()) {
  const date = new Date(birth);
  if (Number.isNaN(date.getTime())) return false;
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() - MIN_USER_AGE);
  return date <= limit;
}

/** Lanza 400 si viene una fecha de nacimiento y no llega a la edad mínima. */
function assertMinAge(birth, now = new Date()) {
  if (birth === undefined || birth === null || birth === "") return;
  if (isOldEnough(birth, now)) return;
  const error = new Error(`Debes tener al menos ${MIN_USER_AGE} años`);
  error.status = 400;
  error.code = "USER_UNDER_MIN_AGE";
  error.publicMessage = error.message;
  throw error;
}

module.exports = { MIN_USER_AGE, isOldEnough, assertMinAge };
