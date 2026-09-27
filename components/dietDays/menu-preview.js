// PURO — preview de solo lectura de cada menú del plan, para que el cliente
// vea qué hay antes de elegir (GET /dietdays/date/:date/menu).
//
// Mismo criterio que diet-day-resolver.js#applyResolvedPlanToDietDay: una
// alternativa sin alimentos no cuenta; con 1 no hay selector (solo se pauta
// esa) y con 2+ el cliente alterna entre ellas una vez elegido el menú.
// `items` sigue siendo la 1ª alternativa: es lo que leen las apps ya
// instaladas, que no conocen `alternatives`.

function round(q) {
  return Number.isFinite(Number(q)) ? Math.round(Number(q) * 10) / 10 : null;
}

function hasFood(alt) {
  return (alt?.customProducts || []).length > 0 || (alt?.customRecipes || []).length > 0;
}

function itemsOf(alt) {
  return [
    ...(alt.customProducts || []).map((cp) => ({
      name: cp?.product?.name || cp?.name || "",
      quantity: round(cp?.quantity),
      unit: cp?.product?.unit || "g",
    })),
    ...(alt.customRecipes || []).map((cr) => ({
      name: cr?.recipe?.name || cr?.name || "",
      quantity: round(cr?.quantity),
      unit: "ración",
    })),
  ];
}

function buildMenuPreviews(menus) {
  return (menus || []).map((menu) => ({
    name: menu.name,
    meals: (menu.meals || []).map((meal) => {
      const alternatives = (meal.alternatives || []).filter(hasFood);
      return {
        name: meal.slot || meal.name || "",
        items: alternatives.length ? itemsOf(alternatives[0]) : [],
        alternatives:
          alternatives.length >= 2
            ? alternatives.map((alt) => ({ label: alt.label || "", items: itemsOf(alt) }))
            : [],
      };
    }),
  }));
}

module.exports = { buildMenuPreviews };
