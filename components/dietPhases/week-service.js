// De dónde salen las semanas de una fase (docs/plan-semanas.md): ventanas de
// calendario (week-window.js) entre el inicio de la fase y su fin real.

const dietPhaseDao = require("./diet-phase-dao");
const { buildWeeks, weekAt, currentWeek, nextWeek } = require("./week-window");

/**
 * Semanas de una fase: sus ventanas numeradas hasta su fin (o, si sigue
 * abierta, hasta `today`, el de la zona horaria del cliente).
 */
function weeksOfPhase(phase, today) {
  return buildWeeks(phase.startDate, phase.endDate || null, today);
}

/**
 * ¿En qué semana de qué fase está el cliente en esa fecha? null si ese día
 * no hay fase de dieta. Lo usan el check-in (para sellar la respuesta) y la
 * app del cliente.
 */
async function weekForClientAt(clientId, date) {
  const phase = await dietPhaseDao.findCoveringDate(clientId, date);
  if (!phase) return null;
  const weeks = weeksOfPhase(phase, date);
  const window = weekAt(weeks, date) || currentWeek(weeks, date);
  if (!window) return null;
  return {
    phaseId: String(phase._id),
    phaseName: phase.name,
    number: window.number,
    start: window.start,
    end: window.end,
  };
}

module.exports = {
  weeksOfPhase,
  weekForClientAt,
  weekAt,
  currentWeek,
  nextWeek,
};
