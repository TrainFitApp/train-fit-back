const planAssignmentService = require("./plan-assignment-service");
const { isDaySkipped } = require("../dietDays/diet-skips");

// Auditoría de arquitectura (nutrición) — el corazón del modelo nuevo:
// dada una fecha, ¿qué le toca comer a este cliente? Se llama al crear un
// DietDay que todavía no existe, Y (TASK-006, MASTER_BACKLOG.md) también al
// leer un DietDay ya existente pero que sigue sin ninguna comida pautada
// (autocreado antes de que hubiera plan asignado) — nunca reescribe un día
// que ya tiene contenido real (ver diet-day-resolver.js#isDietDayUntouched).
// Devuelve null si no hay ninguna asignación activa para esa fecha (clientes
// sin entrenador, o cualquier fecha fuera de cualquier plan) — en ese caso
// el día se crea/queda exactamente como siempre (getStandardDietDay, vacío).
//
// El cliente elige, para ESA fecha, cuál de los menús del plan le toca
// (guardado en DietDay.menuName). Sin `chosenMenuName` (nadie ha elegido
// todavía para esa fecha) esta función devuelve null — un día sin menú
// elegido se crea vacío, exactamente como si no hubiera plan; nunca fuerza
// una elección por el cliente. Además, cada comida puede tener
// varias `alternatives` (antes un único clipboard por slot) — el resultado
// ya no colapsa a un solo `{customProducts, customRecipes}`, sino que expone
// la lista completa para que diet-day-resolver.js decida: 1 alternativa se
// pastea directa, 2+ generan una MealProposal para que el cliente elija.
async function resolvePlanForDate(clientId, date, { chosenMenuName } = {}) {
  // La copia congelada ES el plan (ver diet-template-schema.js) — ya no hace
  // falta un segundo lookup, ni el null-check de "la plantilla referenciada
  // se borró": borrar la copia borra la asignación con ella (cascada en
  // diet-template-schema.js), así que si `assignment` existe, su contenido
  // también.
  const plan = await planAssignmentService.findCoveringDate(clientId, date);
  if (!plan) return null;

  // Un día saltado no se pauta aunque el plan lo cubra y el cliente haya
  // elegido menú: es justo lo que significa saltarlo.
  if (await isDaySkipped(clientId, date)) return null;

  if (!chosenMenuName) return null;
  const menu = (plan.menus || []).find((m) => m.name === chosenMenuName);
  if (!menu) return null;
  const mealsForDay = menu.meals || [];

  // slot -> { alternatives: [{label, customProducts, customRecipes}] }, ya
  // en el mismo formato "clipboard" que mealModel.pasteMeal/MealProposal
  // esperan por alternativa.
  const resolved = {};
  for (const meal of mealsForDay) {
    resolved[meal.slot] = {
      alternatives: (meal.alternatives || []).map((alt) => ({
        label: alt.label || "",
        customProducts: alt.customProducts || [],
        customRecipes: alt.customRecipes || [],
      })),
    };
  }

  return { resolved, trainerId: plan.trainerId };
}

module.exports = { resolvePlanForDate };
