const dietPhaseDao = require("./diet-phase-dao");
const { contentAt } = require("./week-content");
const { isDaySkipped } = require("../dietDays/diet-skips");

// Dada una fecha, ¿qué le toca comer a este cliente? Se llama al crear un
// DietDay y al leer uno que sigue sin nada pautado (nunca reescribe un día
// que ya tiene contenido real, ver diet-day-resolver.js#isDietDayUntouched).
// null si ninguna fase cubre esa fecha (clientes sin profesional, o fechas
// fuera de cualquier fase): el día queda como siempre, vacío.
//
// El cliente elige, para ESA fecha, uno de los menús de la fase (guardado en
// DietDay.menuName). Sin menú elegido devuelve null: nunca se elige por él.
// Cada comida puede tener varias alternativas; diet-day-resolver.js decide:
// 1 se pauta directa, 2+ quedan para que el cliente elija.
async function resolvePlanForDate(clientId, date, { chosenMenuName } = {}) {
  const phase = await dietPhaseDao.findCoveringDate(clientId, date);
  if (!phase) return null;

  // Un día saltado no se pauta aunque la fase lo cubra: es justo lo que
  // significa saltarlo.
  if (await isDaySkipped(clientId, date)) return null;

  if (!chosenMenuName) return null;
  const menu = (contentAt(phase.contents, date)?.menus || []).find((m) => m.name === chosenMenuName);
  if (!menu) return null;

  // slot -> { alternatives: [{label, customProducts, customRecipes}] }
  const resolved = {};
  for (const meal of menu.meals || []) {
    resolved[meal.slot] = {
      alternatives: (meal.alternatives || []).map((alt) => ({
        label: alt.label || "",
        customProducts: alt.customProducts || [],
        customRecipes: alt.customRecipes || [],
      })),
    };
  }

  return { resolved, trainerId: phase.trainerId };
}

module.exports = { resolvePlanForDate };
