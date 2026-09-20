// Revisiones de una fase de dieta (docs/plan-revisiones.md). Sustituyen a los
// revisiones: una fase ya no se divide por lo que dura su contenido
// sino por los CHECK-INS que el entrenador ha programado. Cada check-in abre
// una revisión (R1, R2…) que dura hasta la víspera del siguiente.
//
// R1 empieza cuando empieza la fase, aunque el primer check-in caiga más
// tarde: los días anteriores al primer check-in son parte de la primera
// revisión, no un hueco sin número.
//
// PURO: entran fechas "YYYY-MM-DD", salen ventanas. Ni reloj ni BD — quién
// aporta las fechas de check-in es revision-service.js.

const { addDaysToIsoDate } = require("../util/date-util");

/**
 * @param {string} phaseStart inicio de la fase
 * @param {string|null} phaseEnd fin real de la fase (null = abierta)
 * @param {string[]} boundaries fechas de check-in (en cualquier orden)
 * @returns {{number:number,start:string,end:string|null}[]}
 *   `end` null solo en la última cuando la fase sigue abierta y no hay otro
 *   check-in programado por delante: nadie sabe todavía hasta cuándo dura.
 */
function buildRevisions(phaseStart, phaseEnd = null, boundaries = []) {
  if (!phaseStart) return [];
  const cortes = [...new Set(boundaries.filter(Boolean))]
    .filter((d) => d > phaseStart && (!phaseEnd || d <= phaseEnd))
    .sort();

  const revisions = [];
  let start = phaseStart;
  for (const corte of cortes) {
    revisions.push({ number: revisions.length + 1, start, end: addDaysToIsoDate(corte, -1) });
    start = corte;
  }
  revisions.push({ number: revisions.length + 1, start, end: phaseEnd || null });
  return revisions;
}

/** La revisión que contiene `date`, o null si la fecha queda fuera. */
function revisionAt(revisions, date) {
  return (
    revisions.find((r) => r.start <= date && (r.end === null || date <= r.end)) || null
  );
}

/** La revisión en curso hoy; si la fase aún no ha empezado, la primera. */
function currentRevision(revisions, today) {
  if (!revisions.length) return null;
  if (today < revisions[0].start) return revisions[0];
  return revisionAt(revisions, today) || revisions[revisions.length - 1];
}

/** La siguiente a `revision`, si ya se sabe cuándo empieza. */
function nextRevision(revisions, revision) {
  return revisions.find((r) => r.number === revision.number + 1) || null;
}

module.exports = { buildRevisions, revisionAt, currentRevision, nextRevision };
