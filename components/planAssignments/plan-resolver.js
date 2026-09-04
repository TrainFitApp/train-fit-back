const planAssignmentService = require("./plan-assignment-service");
const dietExceptionDao = require("../dietExceptions/diet-exception-dao");

// Fase 7 Coach Pro — antes se llamaba daysBetweenIsoDates, igual que una
// función de trainer-client-data-controller.js que devolvía un día MÁS
// (contaba ambos extremos). Aquí lo que hace falta son días transcurridos
// —el día 0 de un plan es su fecha de inicio—, y ahora el nombre lo dice.
const { daysElapsed } = require("../util/date-util");

// getDay(): 0=domingo … 6=sábado, mismo criterio que DayPattern.appliesTo.
function weekdayOf(isoDate) {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}

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
// Fase 9 — `mode: "choice"` generaliza "recurring" sin día de la semana fijo:
// el propio cliente elige, para ESA fecha, cuál de los `dayPatterns[]` le
// toca (guardado en DietDay.dayTypeName). Sin `chosenPatternName` (nadie ha
// elegido todavía para esa fecha) esta función devuelve null — un día
// "choice" sin elección se crea vacío, exactamente como si no hubiera plan;
// nunca fuerza una elección por el cliente. Además, cada comida puede tener
// varias `alternatives` (antes un único clipboard por slot) — el resultado
// ya no colapsa a un solo `{customProducts, customRecipes}`, sino que expone
// la lista completa para que diet-day-resolver.js decida: 1 alternativa se
// pastea directa, 2+ generan una MealProposal para que el cliente elija.
async function resolvePlanForDate(clientId, date, { chosenPatternName } = {}) {
  // La copia congelada ES el plan (ver diet-template-schema.js) — ya no hace
  // falta un segundo lookup, ni el null-check de "la plantilla referenciada
  // se borró": borrar la copia borra la asignación con ella (cascada en
  // diet-template-schema.js), así que si `assignment` existe, su contenido
  // también.
  const plan = await planAssignmentService.findCoveringDate(clientId, date);
  if (!plan) return null;

  let mealsForDay = null;

  if (plan.mode === "recurring") {
    const weekday = weekdayOf(date);
    const pattern = (plan.dayPatterns || []).find((p) => (p.appliesTo || []).includes(weekday));
    if (pattern) mealsForDay = pattern.meals;
  } else if (plan.mode === "choice") {
    if (chosenPatternName) {
      const pattern = (plan.dayPatterns || []).find((p) => p.name === chosenPatternName);
      if (pattern) mealsForDay = pattern.meals;
    }
  } else {
    // "sequential" (o legado sin mode): días en orden desde el inicio de la
    // asignación, CICLANDO al llegar al final (día 5 de una plantilla de 4
    // vuelve a ser el día 1) — el propio builder lo vende así al trainer
    // ("¿Cómo se repite esta plantilla?" / "Días (1, 2, 3...)"), y aplicar
    // un plan no está acoplado al nº de días de la plantilla (el trainer
    // puede perfectamente asignar "duration: 8 semanas" a una plantilla de
    // 4 días). Sin ciclo, esos días de más quedaban vacíos en silencio, sin
    // aviso en ningún sitio — bug, no comportamiento buscado. `days` vacío
    // (plantilla en borrador, sin validación mínima en el controller) sigue
    // sin resolución, igual que antes — % por longitud 0 rompería.
    const daysCount = (plan.days || []).length;
    const day = daysCount ? plan.days[daysElapsed(plan.startDate, date) % daysCount] : null;
    if (day) mealsForDay = day.meals;
  }

  if (!mealsForDay) return null;

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

  // Las excepciones puntuales de esta fecha ganan sobre lo que diga el plan
  // — override sustituye el contenido de esa comida (siempre con una única
  // alternativa definitiva, sin elección), skip la vacía.
  const exceptions = await dietExceptionDao.findForDate(clientId, date);
  for (const exception of exceptions) {
    if (exception.mealSlot) {
      if (exception.action === "skip") {
        resolved[exception.mealSlot] = { alternatives: [] };
      } else if (exception.action === "override") {
        resolved[exception.mealSlot] = {
          alternatives: [
            {
              label: "",
              customProducts: exception.override?.customProducts || [],
              customRecipes: exception.override?.customRecipes || [],
            },
          ],
        };
      }
    } else {
      // Excepción de día completo (p. ej. "vacaciones"): vacía todas las comidas.
      if (exception.action === "skip") {
        for (const slot of Object.keys(resolved)) {
          resolved[slot] = { alternatives: [] };
        }
      }
    }
  }

  return { resolved, trainerId: plan.trainerId };
}

module.exports = { resolvePlanForDate };
