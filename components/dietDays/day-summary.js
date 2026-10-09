const { buildTrackingDays } = require("./tracking-days");
const { coveringContent } = require("../dietPhases/week-content");
const { buildWeeks, weekAt } = require("../dietPhases/week-window");
const {
  KCAL_TOLERANCE,
  ingredientMacros,
  macrosForCustomRecipe,
  plannedView,
  sumMacroList,
  computeDayCompletion,
  isItemPlanned,
  isItemConsumed,
} = require("./diet-days-nutrition-util");

// Resumen de UN día de un cliente para la ficha del profesional (Plan ›
// Nutrición › Día): qué tenía pautado, qué marcó como tomado, qué comió
// fuera de pauta, el menú y las opciones que eligió, y cuánto se desvió de
// lo pautado.
//
// Parte del mismo día con el que se mide todo lo demás
// (tracking-days.js#buildTrackingDays): las cifras cuadran con la gráfica de
// Seguimiento y con el calendario, también en un día pasado en el que el
// cliente no eligió menú (se mide con el menú por defecto, sin nada tomado).
//
// PURO: entran el DietDay de esa fecha (o null), las fases que la cubren y
// el "hoy" del cliente. Sin mongoose, sin HTTP.

const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

const round = (macros) => ({
  kcal: Math.round(macros.kcal),
  protein: Math.round(macros.protein),
  carbs: Math.round(macros.carbs),
  fat: Math.round(macros.fat),
});

const macrosOf = (item, kind) => (kind === "recipe" ? macrosForCustomRecipe(item) : ingredientMacros(item));

function itemName(item, kind) {
  const name = kind === "recipe" ? item?.recipe?.name || item?.name : item?.product?.name || item?.name;
  return (name || "").trim();
}

function toGrams(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

// Un alimento de la comida. `status`:
//   eaten     pautado y marcado como tomado
//   unchecked pautado y sin marcar (pasado: no lo tomó; hoy o futuro: aún no)
//   extra     lo añadió el cliente por su cuenta (cuenta como tomado)
// `plannedQuantity` es la cantidad que puso el profesional y `quantity` la
// que registró el cliente: si difieren, lo tomó en otra cantidad.
function summarizeItem(item, kind) {
  const planned = isItemPlanned(item);
  const consumed = isItemConsumed(item);
  const status = !planned ? "extra" : consumed ? "eaten" : "unchecked";
  const plannedMacros = planned ? macrosOf(plannedView(item), kind) : ZERO;
  const consumedMacros = consumed ? macrosOf(item, kind) : ZERO;

  return {
    summary: {
      kind,
      name: itemName(item, kind),
      brand: kind === "product" ? (item?.product?.brand || "").trim() || null : null,
      status,
      plannedQuantity: planned ? toGrams(item?.assignedQuantity ?? item?.quantity) : null,
      quantity: toGrams(item?.quantity),
      kcal: Math.round((status === "unchecked" ? plannedMacros : consumedMacros).kcal),
    },
    planned: plannedMacros,
    consumed: consumedMacros,
    extra: status === "extra" ? consumedMacros : ZERO,
  };
}

function mealStatus(items) {
  const planned = items.filter((item) => item.status !== "extra");
  if (!planned.length) return "extra";
  const eaten = planned.filter((item) => item.status === "eaten").length;
  if (eaten === planned.length) return "done";
  return eaten ? "partial" : "unchecked";
}

// Opciones de la comida: solo cuando el profesional dio a elegir (2+). El
// índice es la que tiene aplicada.
function mealOptions(meal) {
  const alternatives = meal?.alternatives || [];
  if (alternatives.length < 2) return null;
  return {
    chosen: Number.isInteger(meal.chosenAlternativeIndex) ? meal.chosenAlternativeIndex : null,
    labels: alternatives.map((alternative) => (alternative?.label || "").trim()),
  };
}

// Las comidas del día por hueco, en orden. Un día pasado sin menú elegido
// junta las comidas reales del cliente (con lo que anotara por su cuenta) y
// las pautadas por defecto (tracking-days.js): dos entradas con el mismo
// nombre son la misma comida.
function groupMeals(meals) {
  const bySlot = new Map();
  for (const meal of meals || []) {
    const key = meal?.name || "";
    const current = bySlot.get(key);
    if (!current) {
      bySlot.set(key, {
        name: key,
        notes: (meal?.notes || "").trim() || null,
        options: mealOptions(meal),
        products: [...(meal?.customProducts || [])],
        recipes: [...(meal?.customRecipes || [])],
      });
      continue;
    }
    current.notes = current.notes || (meal?.notes || "").trim() || null;
    current.options = current.options || mealOptions(meal);
    current.products.push(...(meal?.customProducts || []));
    current.recipes.push(...(meal?.customRecipes || []));
  }
  return [...bySlot.values()];
}

function summarizeMeal(group) {
  const entries = [
    ...group.products.map((item) => summarizeItem(item, "product")),
    ...group.recipes.map((item) => summarizeItem(item, "recipe")),
  ];
  const items = entries.map((entry) => entry.summary);
  const planned = sumMacroList(entries.map((entry) => entry.planned));
  const consumed = sumMacroList(entries.map((entry) => entry.consumed));
  return {
    meal: {
      name: group.name,
      notes: group.notes,
      options: group.options,
      status: mealStatus(items),
      planned: round(planned),
      consumed: round(consumed),
      items,
    },
    planned,
    consumed,
    extra: sumMacroList(entries.map((entry) => entry.extra)),
  };
}

// Cómo está el día respecto al plan:
//   skipped   el cliente lo saltó (no se pauta)
//   menu      eligió menú
//   planned   tiene algo pautado sin menú (comida pautada a mano)
//   unchosen  día pasado de una fase sin menú elegido: se mide con el
//             menú por defecto, sin nada tomado
//   pending   hoy o un día por venir de una fase, todavía sin menú
//   none      ninguna fase lo cubre
function dayState({ dietDay, covering, date, today }) {
  if (dietDay?.skipped) return "skipped";
  if (dietDay?.menuName) return "menu";
  if (dietDay && computeDayCompletion(dietDay.meals).hasPlan) return "planned";
  if (covering) return date < today ? "unchosen" : "pending";
  return "none";
}

function phaseInfo(covering, date) {
  if (!covering) return null;
  const { phase } = covering;
  const week = weekAt(buildWeeks(phase.startDate, phase.endDate || null, date), date);
  return { _id: String(phase._id), name: phase.name || "", week: week?.number ?? null };
}

// Desviación de lo comido frente a lo pautado, en kcal y en %. Dentro del
// margen = la misma regla que la adherencia calórica (±KCAL_TOLERANCE). Sin
// nada pautado no hay desviación que medir.
function deviation(planned, consumed) {
  if (!(planned.kcal > 0)) return null;
  const kcal = consumed.kcal - planned.kcal;
  return {
    kcal: Math.round(kcal),
    percentage: Math.round((kcal / planned.kcal) * 100),
    withinTolerance: Math.abs(kcal) <= planned.kcal * KCAL_TOLERANCE,
  };
}

/**
 * @param date      "YYYY-MM-DD" del día.
 * @param today     "hoy" del cliente.
 * @param dietDay   su DietDay de esa fecha, poblado, o null.
 * @param phases    sus fases de dieta que cubren la fecha, pobladas.
 */
function summarizeDay({ date, today, dietDay = null, phases = [] }) {
  const covering = coveringContent(phases, date);
  const [tracked] = buildTrackingDays({ from: date, to: date, today, dietDays: dietDay ? [dietDay] : [], phases });
  const meals = groupMeals(tracked?.meals)
    .map(summarizeMeal)
    .filter((entry) => entry.meal.items.length);

  const planned = sumMacroList(meals.map((entry) => entry.planned));
  const consumed = sumMacroList(meals.map((entry) => entry.consumed));
  const extra = sumMacroList(meals.map((entry) => entry.extra));
  const items = meals.flatMap((entry) => entry.meal.items);
  const plannedItems = items.filter((item) => item.status !== "extra");

  return {
    date,
    today,
    state: dayState({ dietDay, covering, date, today }),
    phase: phaseInfo(covering, date),
    menus: (covering?.content?.menus || []).map((menu) => menu.name),
    menuName: dietDay?.menuName || null,
    notes: (dietDay?.notes || "").trim() || null,
    planned: round(planned),
    consumed: round(consumed),
    extra: round(extra),
    deviation: deviation(planned, consumed),
    counts: {
      planned: plannedItems.length,
      eaten: plannedItems.filter((item) => item.status === "eaten").length,
      extra: items.length - plannedItems.length,
    },
    completionPercentage: computeDayCompletion(tracked?.meals).completionPercentage,
    meals: meals.map((entry) => entry.meal),
  };
}

module.exports = { summarizeDay };
