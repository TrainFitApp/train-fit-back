const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { windowAt } = require("./cycle-window");

// Ciclos por contenido — "¿en qué ciclo de dieta está este cliente en esta
// fecha?" para la app del cliente y el check-in. Va por la fase que RIGE ese
// día (findCoveringDate), no por el tip de la cadena: si hay otra fase
// programada más adelante, hoy sigue contando la de hoy.
//
// null si no tiene fase (plan "de siempre" sin phaseId, o sin plan).
async function cycleForClientAt(clientId, date) {
  const covering = await dietTemplateDao.findCoveringDate(clientId, date);
  if (!covering?.phaseId) return null;
  const cycles = await dietTemplateDao.findCyclesOfPhase(covering.phaseId);
  const window = windowAt(cycles, date);
  if (!window) return null;
  return {
    phaseId: String(covering.phaseId),
    number: window.number,
    start: window.start,
    end: window.end,
    override: window.override,
  };
}

module.exports = { cycleForClientAt };
