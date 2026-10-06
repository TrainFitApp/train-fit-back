// De dónde salen las semanas de una fase (docs/plan-semanas.md). Une las
// ventanas puras de week-window.js con las fases de dieta.
//
// Antes esto leía las programaciones de check-in del cliente para saber por
// dónde cortar. Ya no: las semanas son de calendario, así que basta con las
// fechas de la propia fase.

const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { buildWeeks, weekAt, currentWeek, nextWeek } = require("./week-window");

/**
 * Semanas de una fase: sus ventanas numeradas y el fin real de la fase.
 * `today` = hoy en la zona horaria del cliente (users/user-time-zone.js).
 */
async function weeksOfPhase(head, members, today) {
  const phaseStart = head.startDate;
  const phaseEnd = members[members.length - 1]?.endDate || null;
  const weeks = buildWeeks(phaseStart, phaseEnd, today);
  return { weeks, phaseEnd };
}

/**
 * ¿En qué semana de qué fase está el cliente en esa fecha? null si ese día
 * no hay fase de dieta. Lo usan el check-in (para sellar la respuesta) y la
 * app del cliente.
 */
async function weekForClientAt(clientId, date) {
  const covering = await dietTemplateDao.findCoveringDate(clientId, date);
  if (!covering?.phaseId) return null;
  const head = await dietTemplateDao.findPhaseHead(covering.phaseId);
  if (!head?.startDate) return null;
  const members = await dietTemplateDao.findPhaseMembers(covering.phaseId);
  const { weeks } = await weeksOfPhase(head, members, date);
  const window = weekAt(weeks, date) || currentWeek(weeks, date);
  if (!window) return null;
  return {
    phaseId: String(head._id),
    phaseName: head.phaseName || head.name || null,
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
