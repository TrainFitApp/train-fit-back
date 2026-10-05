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
//
// "Hoy" NO es el día del servidor ni el día UTC: es el día de calendario del
// usuario, en su zona horaria (`User.timezone`, IANA, que manda la app en la
// cabecera `X-Timezone`; ver middleware/validateAuth.js). Con usuarios en
// varias zonas y servidores en varias regiones, cualquier otro "hoy" se
// equivoca de día cerca de la medianoche. Por eso `todayIsoDate` y
// `isoDateInZone` piden la zona: quien calcula "hoy" tiene que decir de quién.

const MS_PER_DAY = 86400000;

// Usuarios que aún no han mandado su zona (versiones de la app anteriores a
// la cabecera X-Timezone). El público actual está en España.
const DEFAULT_TIME_ZONE = "Europe/Madrid";

const dayFormatters = new Map();

// Lanza RangeError si la zona no existe — normalizeTimeZone se apoya en eso.
function dayFormatter(timeZone) {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** La zona IANA si es válida ("Europe/Madrid"); null si no. */
function normalizeTimeZone(value) {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  try {
    dayFormatter(value);
    return value;
  } catch {
    return null;
  }
}

/** Zona efectiva de un usuario (documento con `timezone`). */
function timeZoneOf(user) {
  return normalizeTimeZone(user?.timezone) || DEFAULT_TIME_ZONE;
}

/**
 * Día de calendario ("YYYY-MM-DD") de un instante en una zona: un
 * entrenamiento a las 00:30 en Madrid es de ese día, aunque en UTC aún sea
 * el anterior.
 */
function isoDateInZone(date, timeZone) {
  const parts = dayFormatter(timeZone || DEFAULT_TIME_ZONE).formatToParts(new Date(date));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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

const offsetFormatters = new Map();

// Cuánto va la zona por delante de UTC en ese instante (negativo si va por
// detrás). Depende del instante por el horario de verano.
function zoneOffsetMs(instantMs, timeZone) {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]));
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallAsUtc - (instantMs - (instantMs % 1000));
}

/**
 * Instante en que empieza el día "YYYY-MM-DD" en esa zona. Para consultar
 * por rango de días campos guardados como instante (Workout.date): el rango
 * UTC de un día de Bogotá empieza a las 05:00Z, no a las 00:00Z.
 */
function startOfDayInZone(isoDay, timeZone) {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const midnightUtc = toUtcDate(isoDay).getTime();
  // Dos pasadas: la primera estimación puede caer al otro lado de un cambio
  // de hora.
  const guess = midnightUtc - zoneOffsetMs(midnightUtc, zone);
  return new Date(midnightUtc - zoneOffsetMs(guess, zone));
}

/** [inicio del primer día, fin del último día] en esa zona, como instantes. */
function dayRangeInZone(fromIso, toIso, timeZone) {
  return {
    start: startOfDayInZone(fromIso, timeZone),
    end: new Date(startOfDayInZone(addDaysToIsoDate(toIso, 1), timeZone).getTime() - 1),
  };
}

/** "Hoy" en la zona del usuario. Ver la cabecera de este fichero. */
function todayIsoDate(timeZone) {
  return isoDateInZone(new Date(), timeZone);
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
  DEFAULT_TIME_ZONE,
  normalizeTimeZone,
  timeZoneOf,
  isoDateInZone,
  startOfDayInZone,
  dayRangeInZone,
  isoDate,
  daysElapsed,
  daysInRange,
  addDaysToIsoDate,
  todayIsoDate,
  startOfIsoWeek,
};
