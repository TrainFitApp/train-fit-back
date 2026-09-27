const { mergeRecipeIngredients } = require("./diet-days-nutrition-util");
const { addDaysToIsoDate, todayIsoDate } = require("../util/date-util");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PURO — la lista de la compra de un rango de días, calculada desde el PLAN.
 *
 * Antes sumaba los DietDay materializados, pero con el modelo de menús un
 * día solo se materializa cuando el cliente elige menú: la lista de "2
 * semanas" salía casi vacía. Ahora cada día del rango se cubre con la copia
 * de dieta que le toca (la misma regla que findCoveringDate) y la compra es
 * cantidad-por-día × días, por eso 2 semanas es el doble que 1.
 *
 * Como el cliente elige menú cada día y cada comida puede tener
 * alternativas, la lista depende de un reparto: cuántos días de cada menú y
 * qué alternativa de cada comida. El servidor da la estructura (`segments`)
 * con un reparto por defecto y la lista ya sumada con él (`items`, lo único
 * que leen las apps ya instaladas). La app recalcula al cambiar el reparto
 * con la misma suma (shared-core shopping-list.util.ts#aggregateShopping):
 * si tocas una, toca la otra.
 *
 * Sin BD, sin await: entran las copias pobladas y las marcas de DietDay.
 */

// El nombre que el cliente va a leer en el supermercado. El del catálogo si
// lo hay; si no, el que quedara guardado en el propio item.
function productName(item) {
  return (item?.product?.name || item?.name || "").trim();
}

// La clave de agrupación es el producto del catálogo cuando existe, y el
// nombre normalizado cuando no. Agrupar solo por nombre juntaría dos
// productos distintos que se llaman igual; agrupar solo por id dejaría
// sueltos los que el cliente escribió a mano.
function groupKey(item) {
  const productId = item?.product?._id || item?.product;
  if (productId) return `id:${String(productId)}`;
  const name = productName(item).toLowerCase();
  return name ? `name:${name}` : null;
}

function toPositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Los ingredientes de una receta cuentan como productos sueltos (se compra
// pollo y arroz, no "arroz con pollo"), escalados a la ración pautada: misma
// regla que diet-days-nutrition-util#macrosForCustomRecipe. Sin cantidad
// pautada se compra la receta entera: para las kcal cuenta 0, pero dejarla
// fuera de la compra sería peor que comprar de más.
function recipeIngredients(customRecipe) {
  const ingredients = mergeRecipeIngredients(customRecipe?.recipe, customRecipe);
  const rawWeight = ingredients.reduce((acc, ing) => acc + toPositive(ing?.quantity), 0);
  const baseline = toPositive(customRecipe?.quantityCooked) || rawWeight;
  const portion = toPositive(customRecipe?.quantity);
  const ratio = baseline > 0 && portion > 0 ? portion / baseline : 1;
  return ingredients.map((ing) => ({ item: ing, quantity: toPositive(ing?.quantity) * ratio }));
}

/** Lo que hay que comprar para UN día de esa alternativa, sumado por producto. */
function itemsOfAlternative(alternative) {
  const entries = [
    ...(alternative?.customProducts || []).map((cp) => ({ item: cp, quantity: toPositive(cp?.quantity) })),
    ...(alternative?.customRecipes || []).flatMap(recipeIngredients),
  ];
  const byKey = new Map();
  for (const { item, quantity } of entries) {
    const key = groupKey(item);
    // Sin nombre ni producto no se puede comprar; con cantidad 0 tampoco.
    if (!key || !quantity) continue;
    const current = byKey.get(key) || { key, name: productName(item) || "Sin nombre", quantity: 0 };
    current.quantity += quantity;
    byKey.set(key, current);
  }
  return [...byKey.values()].map((entry) => ({ ...entry, quantity: round1(entry.quantity) }));
}

// La copia que cubre `date`: la que empieza más tarde de las que la
// contienen (findCoveringDate ordena igual). Una semana preparada empieza
// después que el contenido abierto de su fase y lo tapa desde su lunes.
function coveringPlan(plans, date) {
  let best = null;
  for (const plan of plans) {
    if (!plan?.startDate || plan.startDate > date) continue;
    if (plan.endDate && plan.endDate < date) continue;
    if (!best || plan.startDate > best.startDate) best = plan;
  }
  return best;
}

function enumerateDates(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDaysToIsoDate(date, 1)) dates.push(date);
  return dates;
}

// Reparto por defecto de los días entre menús: los que el cliente ya eligió
// cuentan para su menú y el resto se reparte a partes iguales (el sobrante,
// uno a uno desde el primero). Días enteros: es lo que enseña el selector.
function defaultMenuDays(menus, days) {
  const result = {};
  let pending = days;
  for (const menu of menus) {
    result[menu.name] = menu.chosenDays;
    pending -= menu.chosenDays;
  }
  if (!menus.length || pending <= 0) return result;
  const share = Math.floor(pending / menus.length);
  menus.forEach((menu, index) => {
    result[menu.name] += share + (index < pending % menus.length ? 1 : 0);
  });
  return result;
}

/**
 * @param from, to    YYYY-MM-DD, inclusive.
 * @param plans       copias de dieta del cliente que tocan el rango, pobladas.
 * @param marks       [{date, menuName, skipped}] de los DietDay del rango.
 * @returns segments: un tramo por copia (una semana nueva o una fase nueva
 *          dentro del rango abre tramo, porque cambia el contenido), cada uno
 *          con sus días y sus menús → comidas → alternativas con lo de 1 día.
 */
function buildShoppingSegments({ from, to, plans, marks }) {
  const markByDate = new Map((marks || []).map((mark) => [mark.date, mark]));
  const byPlan = new Map();

  for (const date of enumerateDates(from, to)) {
    const mark = markByDate.get(date);
    // Un día saltado por el profesional no se come del plan: no se compra.
    if (mark?.skipped) continue;
    const plan = coveringPlan(plans || [], date);
    if (!plan || !(plan.menus || []).length) continue;

    const planId = String(plan._id);
    if (!byPlan.has(planId)) byPlan.set(planId, { plan, dates: [], chosen: {} });
    const entry = byPlan.get(planId);
    entry.dates.push(date);
    if (mark?.menuName) entry.chosen[mark.menuName] = (entry.chosen[mark.menuName] || 0) + 1;
  }

  return [...byPlan.entries()].map(([planId, { plan, dates, chosen }]) => {
    const menus = plan.menus.map((menu) => ({
      name: menu.name,
      chosenDays: chosen[menu.name] || 0,
      meals: (menu.meals || [])
        .map((meal) => ({
          slot: meal.slot || meal.name || "",
          alternatives: (meal.alternatives || [])
            .map((alt) => ({ label: alt.label || "", items: itemsOfAlternative(alt) }))
            .filter((alt) => alt.items.length),
        }))
        .filter((meal) => meal.alternatives.length),
    }));
    const defaults = defaultMenuDays(menus, dates.length);
    return {
      planId,
      name: plan.name || plan.phaseName || "",
      from: dates[0],
      to: dates[dates.length - 1],
      days: dates.length,
      menus: menus.map((menu) => ({ ...menu, defaultDays: defaults[menu.name] })),
    };
  });
}

/**
 * Suma la compra con un reparto. `selection[planId]` =
 * { menuDays: {menú: días}, alternatives: {"menú|slot": índice} }; lo que
 * falte cae al defecto (defaultDays y la 1ª alternativa, que es la que se
 * pauta al elegir menú).
 */
function aggregateShopping(segments, selection = {}) {
  const byKey = new Map();
  for (const segment of segments || []) {
    const chosen = selection[segment.planId] || {};
    for (const menu of segment.menus || []) {
      const days = chosen.menuDays?.[menu.name] ?? menu.defaultDays ?? 0;
      if (!(days > 0)) continue;
      for (const meal of menu.meals || []) {
        const index = chosen.alternatives?.[`${menu.name}|${meal.slot}`] ?? 0;
        const alternative = meal.alternatives[index] || meal.alternatives[0];
        for (const item of alternative?.items || []) {
          const current = byKey.get(item.key) || { name: item.name, quantity: 0, dayCount: 0, lastDays: null };
          current.quantity += item.quantity * days;
          // En cuántos días aparece: distingue el pollo de todos los días
          // del aguacate del domingo. Un producto en dos comidas del mismo
          // menú cuenta sus días una vez.
          const dayKey = `${segment.planId}|${menu.name}`;
          if (current.lastDays !== dayKey) current.dayCount += days;
          current.lastDays = dayKey;
          byKey.set(item.key, current);
        }
      }
    }
  }
  return [...byKey.values()]
    .map(({ name, quantity, dayCount }) => ({ name, quantity: round1(quantity), dayCount }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "es"));
}

// Rango pedido por query: una semana desde hoy por defecto (es como se hace
// la compra) y tope de 62 días, que se recorren uno a uno. null = inválido.
function shoppingRange(query = {}) {
  const from = query.from || todayIsoDate();
  const to = query.to || addDaysToIsoDate(from, 6);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return null;
  if (to > addDaysToIsoDate(from, 61)) return null;
  return { from, to };
}

function buildShoppingList({ from, to, plans, marks }) {
  const segments = buildShoppingSegments({ from, to, plans, marks });
  return {
    items: aggregateShopping(segments),
    // Días del rango que REALMENTE tienen plan (sin saltados ni huecos entre
    // fases): sin esto una lista corta parecería un plan flojo.
    daysWithPlan: segments.reduce((acc, segment) => acc + segment.days, 0),
    segments,
  };
}

module.exports = {
  buildShoppingList,
  buildShoppingSegments,
  aggregateShopping,
  defaultMenuDays,
  itemsOfAlternative,
  shoppingRange,
  // food-compliance.js agrupa con la misma clave.
  groupKey,
};
