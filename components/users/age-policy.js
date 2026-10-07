// Edad mínima para tener cuenta en TrainFit: 14 años, la edad a partir de la
// cual se puede consentir el tratamiento de datos sin los padres en España
// (LOPDGDD art. 7). El front la aplica en el registro y en el editor de
// perfil; aquí se repite para que no dependa de él.
//
// `birth` es un día de calendario "YYYY-MM-DD": la fecha que eligió el
// usuario, sin hora ni huso (como instante, cada pantalla la pintaba en su
// zona y el cumpleaños se movía un día). La edad se cuenta contra el "hoy"
// del usuario, también "YYYY-MM-DD", comparando texto: nada pasa por Date.
//
// PURO: sin Mongo.

const { badRequest } = require("../util/http-error");

const MIN_USER_AGE = 14;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es un día de calendario real ("1990-02-31" no)? */
function isBirthDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Años cumplidos en `today`; null si `birth` no es un día válido o es futuro. */
function ageOn(birth, today) {
  if (!isBirthDate(birth) || !ISO_DATE.test(today || "")) return null;
  const years = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  const age = today.slice(5) < birth.slice(5) ? years - 1 : years;
  return age >= 0 ? age : null;
}

/** ¿Tiene `birth` al menos MIN_USER_AGE años en `today`? Fechas inválidas: no. */
function isOldEnough(birth, today) {
  return (ageOn(birth, today) ?? -1) >= MIN_USER_AGE;
}

/** Lanza 400 si viene una fecha de nacimiento mal formada o sin la edad mínima. */
function assertBirth(birth, today) {
  if (birth === undefined || birth === null || birth === "") return;
  if (!isBirthDate(birth)) throw badRequest("Fecha de nacimiento no válida", "USER_BIRTH_INVALID");
  if (!isOldEnough(birth, today)) {
    throw badRequest(`Debes tener al menos ${MIN_USER_AGE} años`, "USER_UNDER_MIN_AGE");
  }
}

module.exports = { MIN_USER_AGE, isBirthDate, ageOn, isOldEnough, assertBirth };
