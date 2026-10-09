const { computeDayCompletion } = require("./diet-days-nutrition-util");
const { coveringContent } = require("../dietPhases/week-content");
const { addDaysToIsoDate } = require("../util/date-util");

// Los días con los que se mide el seguimiento nutricional de un cliente en la
// ficha del profesional: adherencia del Resumen y su serie semanal,
// calendario, gráfica de pautado frente a consumido y cumplimiento por
// alimento.
//
// Un día solo lleva pauta cuando el cliente elige menú (DietDay.menuName): es
// lo que copia en sus comidas lo pautado. Un día PASADO que una fase cubría y
// en el que no eligió menú —ni siquiera abrió el día— no es un día "sin
// plan": tenía plan y no lo siguió. Se mide con lo pautado del menú por
// defecto (el primero, con la primera alternativa de cada comida, que es lo
// que se pauta al elegirlo) sin nada marcado como tomado: 0 % cumplido. Sin
// esto, una fase que el cliente no sigue salía en el Resumen como "sin datos
// de seguimiento" por mucho que llevara semanas asignada.
//
// Hoy y los días por venir no: el cliente todavía puede elegir. Un día
// saltado no se pauta (es lo que significa saltarlo) y un día con menú
// elegido o algo pautado se mide tal cual está.
//
// PURO: entran los DietDay del rango y las fases que lo tocan, pobladas.

const plain = (doc) => (typeof doc?.toObject === "function" ? doc.toObject() : doc);

const hasItems = (alternative) =>
  (alternative?.customProducts || []).length || (alternative?.customRecipes || []).length;

function plannedItem(item, trainerId) {
  return { ...plain(item), assignedByTrainerId: trainerId, consumed: false };
}

// Las comidas de un día con el menú por defecto del contenido, sin tomar.
// Una fase sin profesional (se borró su cuenta) ya no pauta nada.
function defaultPlannedMeals(content, trainerId) {
  if (!trainerId) return [];
  const menu = (content?.menus || [])[0];
  return (menu?.meals || [])
    .map((meal) => ({ slot: meal.slot, alternative: (meal.alternatives || []).find(hasItems) }))
    .filter(({ alternative }) => alternative)
    .map(({ slot, alternative }) => ({
      // El hueco, para que quien nombre las comidas (resumen del día,
      // desvíos de la semana) no las pinte sin nombre.
      name: slot,
      completed: false,
      customProducts: (alternative.customProducts || []).map((item) => plannedItem(item, trainerId)),
      customRecipes: (alternative.customRecipes || []).map((item) => plannedItem(item, trainerId)),
    }));
}

function measuredAsIs(day) {
  return day.skipped || day.menuName || computeDayCompletion(day.meals).hasPlan;
}

/**
 * @param from, to      YYYY-MM-DD, inclusive.
 * @param today         "hoy" del cliente.
 * @param dietDays      sus DietDay de [from, to].
 * @param phases        sus fases de dieta que tocan [from, to], pobladas.
 * @returns los días del rango que tienen algo que medir, por fecha: los
 *          DietDay tal cual y, para los pasados sin menú elegido dentro de
 *          una fase, `{ date, meals }` con lo pautado sin tomar (y lo que el
 *          cliente anotara por su cuenta).
 */
function buildTrackingDays({ from, to, today, dietDays, phases }) {
  const byDate = new Map((dietDays || []).map((day) => [day.date, day]));
  const days = [];

  for (let date = from; date <= to; date = addDaysToIsoDate(date, 1)) {
    const day = byDate.get(date);
    if (day && measuredAsIs(day)) {
      days.push(day);
      continue;
    }

    const covering = date < today ? coveringContent(phases, date) : null;
    const plannedMeals = covering ? defaultPlannedMeals(covering.content, covering.phase.trainerId) : [];
    if (plannedMeals.length) {
      days.push({ date, meals: [...(day?.meals || []), ...plannedMeals] });
    } else if (day) {
      days.push(day);
    }
  }

  return days;
}

module.exports = { buildTrackingDays };
