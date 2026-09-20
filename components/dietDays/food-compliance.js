const { groupKey } = require("./shopping-list-service");
const { isItemPlanned, isItemConsumed } = require("./diet-days-nutrition-util");

// Cumplimiento ALIMENTO A ALIMENTO de un rango de días — para el panel de
// resumen de una revisión ("¿qué se come de verdad y qué se salta siempre?").
//
// Lo que ya había se quedaba corto para esa pregunta: computeDayCompletion
// CUENTA items (total vs hechos) tirando los nombres, computeDayTracking suma
// MACROS sin desglose, y buildShoppingList sí agrupa por producto pero ignora
// `consumed` por completo (es una lista de la compra, no un histórico).
//
// TODO PURO: entran días poblados, sale un array. Sin mongoose, sin HTTP.
//
// Dos decisiones con criterio propio:
//
// 1) Solo cuenta lo PAUTADO (isItemPlanned). Lo que el cliente añadió por su
//    cuenta no es cumplimiento de nada: isItemConsumed lo da por consumido
//    siempre (ver su comentario), así que incluirlo solo metería filas al
//    100% que ensucian la lectura.
//
// 2) Las recetas NO se aplanan a ingredientes, a diferencia de la lista de la
//    compra. El cliente marca como hecha la RECETA entera, no cada ingrediente
//    por separado: desmontarla daría filas cuyo "consumido" nadie ha decidido.
function summarizeFoodCompliance(days) {
  const byItem = new Map();

  for (const day of days || []) {
    const date = day?.date;
    for (const meal of day?.meals || []) {
      const entries = [
        ...(meal?.customProducts || []).map((item) => ({ item, kind: "product" })),
        ...(meal?.customRecipes || []).map((item) => ({ item, kind: "recipe" })),
      ];

      for (const { item, kind } of entries) {
        if (!isItemPlanned(item)) continue;

        const identity = identify(item, kind);
        // Un item sin nombre ni referencia no se puede nombrar en el panel:
        // se descarta en vez de pintar una fila en blanco.
        if (!identity) continue;

        if (!byItem.has(identity.key)) {
          byItem.set(identity.key, {
            name: identity.name,
            plannedDays: new Set(),
            consumedDays: new Set(),
            plannedQuantity: 0,
            consumedQuantity: 0,
          });
        }
        const row = byItem.get(identity.key);

        // Pautado: la cantidad ORIGINAL que puso el profesional
        // (assignedQuantity), que es contra la que se compara; `quantity` ya
        // puede haberla cambiado el cliente (ver custom-product-schema.js).
        row.plannedQuantity += toPositive(item?.assignedQuantity ?? item?.quantity);
        if (date) row.plannedDays.add(date);

        if (isItemConsumed(item, meal)) {
          row.consumedQuantity += toPositive(item?.quantity);
          if (date) row.consumedDays.add(date);
        }
      }
    }
  }

  return [...byItem.values()]
    .map((row) => ({
      name: row.name,
      plannedDays: row.plannedDays.size,
      consumedDays: row.consumedDays.size,
      plannedQuantity: Math.round(row.plannedQuantity),
      consumedQuantity: Math.round(row.consumedQuantity),
    }))
    .sort(byWorstComplianceFirst);
}

// Lo que peor se cumple, arriba: es lo accionable. A igualdad de ratio manda
// el que se pautó más días (afecta más), y el nombre solo desempata para que
// el orden sea estable entre llamadas.
function byWorstComplianceFirst(a, b) {
  const ratio = (row) => (row.plannedDays ? row.consumedDays / row.plannedDays : 1);
  const diff = ratio(a) - ratio(b);
  if (diff !== 0) return diff;
  if (b.plannedDays !== a.plannedDays) return b.plannedDays - a.plannedDays;
  return a.name.localeCompare(b.name);
}

// Los productos se agrupan igual que en la lista de la compra (groupKey: por
// id de catálogo si lo hay, por nombre normalizado si no) para que un mismo
// alimento sea "el mismo" en las dos pantallas. Las recetas van por su propia
// referencia, que groupKey no contempla.
function identify(item, kind) {
  if (kind === "recipe") {
    const recipeId = item?.recipe?._id || item?.recipe;
    const name = (item?.recipe?.name || item?.name || "").trim();
    if (recipeId) return { key: `recipe:${String(recipeId)}`, name: name || "Receta" };
    return name ? { key: `recipe-name:${name.toLowerCase()}`, name } : null;
  }

  const key = groupKey(item);
  if (!key) return null;
  return { key, name: (item?.product?.name || item?.name || "").trim() || "Sin nombre" };
}

// Desvíos DÍA A DÍA de un rango — para la sugerencia de la revisión siguiente
// (docs/plan-revisiones.md): qué comió el cliente fuera de pauta y qué
// comidas pautadas no marcó. Solo días con algo que contar; un día sin
// pautado y sin extras no aparece. `hasPlan` false = ese día no tenía nada
// pautado (p. ej. `choice` sin menú elegido): cuenta como no seguido.
function summarizeDailyDeviations(days) {
  const out = [];
  for (const day of days || []) {
    const date = day?.date;
    if (!date) continue;
    const unplanned = [];
    const unchecked = [];
    let hasPlan = false;

    for (const meal of day?.meals || []) {
      const entries = [
        ...(meal?.customProducts || []).map((item) => ({ item, kind: "product" })),
        ...(meal?.customRecipes || []).map((item) => ({ item, kind: "recipe" })),
      ];
      let mealHasPlan = false;
      let mealMissing = false;
      for (const { item, kind } of entries) {
        const identity = identify(item, kind);
        if (!isItemPlanned(item)) {
          unplanned.push({
            meal: meal?.name || "",
            name: identity?.name || "Sin nombre",
            quantity: Math.round(toPositive(item?.quantity)),
          });
          continue;
        }
        mealHasPlan = true;
        if (!isItemConsumed(item, meal)) mealMissing = true;
      }
      if (mealHasPlan) hasPlan = true;
      if (mealMissing) unchecked.push(meal?.name || "");
    }

    if (!hasPlan || unplanned.length || unchecked.length) {
      out.push({ date, hasPlan, unplanned, unchecked });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function toPositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

module.exports = { summarizeFoodCompliance, summarizeDailyDeviations };
