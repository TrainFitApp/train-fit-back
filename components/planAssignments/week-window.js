// Semanas de una fase de dieta (docs/plan-semanas.md). Sustituyen a las
// revisiones: una fase ya no se parte por los check-ins que el entrenador
// programe, sino por SEMANAS NATURALES de lunes a domingo.
//
// S1 empieza el día en que empieza la fase y acaba el domingo de esa misma
// semana: una fase que arranca un miércoles tiene una primera semana corta
// (miércoles a domingo), no una ventana de siete días desplazada. A partir de
// ahí, lunes a domingo.
//
// A diferencia de las revisiones, `end` nunca es null: el domingo se conoce
// siempre, aunque la fase siga abierta. Lo único que puede recortar una
// semana es el fin real de la fase.
//
// PURO: entran fechas "YYYY-MM-DD", salen ventanas. Ni reloj ni BD.

const { addDaysToIsoDate, startOfIsoWeek } = require("../util/date-util");

/**
 * @param {string} phaseStart inicio de la fase
 * @param {string|null} phaseEnd fin real de la fase (null = abierta)
 * @param {string|null} until hasta dónde enumerar una fase abierta (hoy)
 * @returns {{number:number,start:string,end:string}[]}
 */
function buildWeeks(phaseStart, phaseEnd = null, until = null) {
  if (!phaseStart) return [];
  const horizon = phaseEnd || (until && until > phaseStart ? until : phaseStart);

  const weeks = [];
  let start = phaseStart;
  while (start <= horizon) {
    const sunday = addDaysToIsoDate(startOfIsoWeek(start), 6);
    weeks.push({
      number: weeks.length + 1,
      start,
      end: phaseEnd && phaseEnd < sunday ? phaseEnd : sunday,
    });
    start = addDaysToIsoDate(sunday, 1);
  }

  // La fase abierta siempre ofrece una semana más: es la que el entrenador
  // prepara. Con la fase cerrada no hay nada después del fin.
  if (!phaseEnd) {
    const last = weeks[weeks.length - 1];
    weeks.push({
      number: weeks.length + 1,
      start: addDaysToIsoDate(last.end, 1),
      end: addDaysToIsoDate(last.end, 7),
    });
  }
  return weeks;
}

/** La semana que contiene `date`, o null si la fecha queda fuera. */
function weekAt(weeks, date) {
  return weeks.find((w) => w.start <= date && date <= w.end) || null;
}

/** La semana en curso hoy; si la fase aún no ha empezado, la primera. */
function currentWeek(weeks, today) {
  if (!weeks.length) return null;
  if (today < weeks[0].start) return weeks[0];
  return weekAt(weeks, today) || weeks[weeks.length - 1];
}

/** La siguiente a `week`, si ya se sabe cuándo empieza. */
function nextWeek(weeks, week) {
  return weeks.find((w) => w.number === week.number + 1) || null;
}

module.exports = { buildWeeks, weekAt, currentWeek, nextWeek };
