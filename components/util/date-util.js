// Fase 7 Coach Pro — los helpers de fecha del proyecto, en un solo sitio.
//
// Existían tres copias de lo mismo con nombres que no distinguían lo que
// hacían:
//   - plan-resolver.js#daysBetweenIsoDates -> días TRANSCURRIDOS (mismo día = 0)
//   - trainer-client-data-controller.js#daysBetweenIsoDates -> días DEL RANGO
//     contando ambos extremos (mismo día = 1)
//   - clientProgress/progress-service.js#isoDate
//
// Dos funciones con el mismo nombre y resultados que difieren en 1 es la
// clase de duplicación que no da error nunca: simplemente hace que un cálculo
// salga un día corrido. Aquí se llaman distinto porque SON distintas.
//
// Todas las fechas "YYYY-MM-DD" se construyen en UTC a mediodía-cero
// (`T00:00:00.000Z`) para que el desfase horario del servidor no mueva un día
// arriba o abajo — mismo criterio que ya seguía todo el proyecto.

const MS_PER_DAY = 86400000;

function toUtcDate(isoDay) {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

/** "YYYY-MM-DD" de un Date o de algo parseable como fecha. */
function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Días TRANSCURRIDOS entre dos fechas. El mismo día da 0.
 * Es lo que se quiere para "cuántos días lleva sin...".
 */
function daysElapsed(fromIso, toIso) {
  return Math.round((toUtcDate(toIso).getTime() - toUtcDate(fromIso).getTime()) / MS_PER_DAY);
}

/**
 * Días QUE ABARCA un rango, contando ambos extremos. El mismo día da 1.
 * Es lo que se quiere como denominador de "X de N días".
 */
function daysInRange(fromIso, toIso) {
  return Math.max(1, daysElapsed(fromIso, toIso) + 1);
}

/** Suma (o resta, con negativo) días a una fecha "YYYY-MM-DD". */
function addDaysToIsoDate(isoDay, deltaDays) {
  const date = toUtcDate(isoDay);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * El LUNES de la semana de `isoDay`. Domingo pertenece a la semana que
 * empezó el lunes anterior, no a la que empieza al día siguiente.
 */
function startOfIsoWeek(isoDay) {
  const weekday = toUtcDate(isoDay).getUTCDay(); // 0 = domingo … 6 = sábado
  return addDaysToIsoDate(isoDay, -((weekday + 6) % 7));
}

module.exports = {
  MS_PER_DAY,
  isoDate,
  daysElapsed,
  daysInRange,
  addDaysToIsoDate,
  todayIsoDate,
  startOfIsoWeek,
};
