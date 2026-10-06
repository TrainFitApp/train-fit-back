const { addDaysToIsoDate } = require("./date-util");

// Cadena de fases de un cliente: las de dieta (dietPhases/) y las de rutina
// (routineAssignments/). Una fase rige desde su `startDate` hasta que empieza
// la siguiente o, en las de dieta, hasta su `endDate`. No se guarda ningún
// estado que se pueda deducir de las fechas: qué fase es la última, cuál
// sustituyó a cuál o cuál rige hoy sale siempre del orden.
//
// Orden de la cadena: por inicio y, con el mismo inicio (sustituir una fase
// el día en que empezó), por creación. La última es la más reciente.

const CHAIN_SORT_DESC = Object.freeze({ startDate: -1, createdAt: -1 });

const createdTime = (phase) => new Date(phase.createdAt || 0).getTime();

function compareChain(a, b) {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  return createdTime(a) - createdTime(b);
}

const sortChain = (phases) => [...(phases || [])].sort(compareChain);

const covers = (phase, date) => phase.startDate <= date && (phase.endDate == null || phase.endDate >= date);

// La que rige en `date` (con dos del mismo inicio, la más reciente), o null.
function coveringPhase(phases, date) {
  let found = null;
  for (const phase of phases || []) {
    if (covers(phase, date) && (!found || compareChain(phase, found) > 0)) found = phase;
  }
  return found;
}

function latestPhase(phases) {
  let found = null;
  for (const phase of phases || []) if (!found || compareChain(phase, found) > 0) found = phase;
  return found;
}

// La siguiente en la cadena, o null.
function successorOf(phases, phase) {
  const ordered = sortChain(phases);
  const index = ordered.findIndex((candidate) => String(candidate._id) === String(phase._id));
  return index >= 0 ? ordered[index + 1] || null : null;
}

// Fin de una fase de dieta que corta la que entra en `startDate`: el día
// anterior. Nunca antes de su propio inicio: sustituirla el mismo día en que
// empezó la deja cubriendo ese día (y manda la más reciente).
function cutEndDate(phase, startDate) {
  const eve = addDaysToIsoDate(startDate, -1);
  return eve < phase.startDate ? phase.startDate : eve;
}

/**
 * Estado de una fase hoy, para pintarla: "scheduled" (aún no ha empezado),
 * "current" (rige hoy) o "past". `covering` es la que rige hoy.
 */
function phaseState(phase, today, covering) {
  if (phase.startDate > today) return "scheduled";
  if (covering && String(covering._id) === String(phase._id)) return "current";
  return "past";
}

function withStates(phases, today) {
  const covering = coveringPhase(phases, today);
  return (phases || []).map((phase) => ({ phase, state: phaseState(phase, today, covering) }));
}

module.exports = {
  CHAIN_SORT_DESC,
  compareChain,
  sortChain,
  coveringPhase,
  latestPhase,
  successorOf,
  cutEndDate,
  phaseState,
  withStates,
};
