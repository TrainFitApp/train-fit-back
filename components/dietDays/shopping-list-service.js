const { mergeRecipeIngredients } = require("./diet-days-nutrition-util");

/**
 * Movimiento 5 Coach Pro — la lista de la compra de un rango de días.
 *
 * NO es un modelo nuevo. Es una lectura distinta de los DietDay que ya
 * existen: los mismos días que el cliente ve en su calendario, sumados por
 * producto. Guardarla como entidad la dejaría desfasada en cuanto el
 * entrenador cambiara una comida — y cambiarla es lo normal.
 *
 * Puro: entran los DietDay ya poblados (dietDaysDao#getFullyPopulatedDietDaysForDiet)
 * y sale la lista. Sin BD, sin await.
 */

// Los ingredientes de una receta cuentan como productos sueltos: quien va al
// supermercado compra pollo y arroz, no "arroz con pollo".
function productsOfMeal(meal) {
  const loose = meal?.customProducts || [];
  const fromRecipes = (meal?.customRecipes || []).flatMap((customRecipe) =>
    mergeRecipeIngredients(customRecipe?.recipe, customRecipe)
  );
  return [...loose, ...fromRecipes];
}

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

/**
 * @param days DietDay poblados, del rango que interese.
 * @param options.onlyPlanned true = solo lo que pautó un profesional. Es el
 *        valor por defecto: la lista de la compra sirve para cumplir el
 *        plan, y meter dentro lo que el cliente se comió por su cuenta la
 *        convertiría en un histórico de consumo.
 */
function buildShoppingList(days, { onlyPlanned = true } = {}) {
  const byProduct = new Map();
  const dates = new Set();

  for (const day of days || []) {
    let dayHadItems = false;

    for (const meal of day?.meals || []) {
      for (const item of productsOfMeal(meal)) {
        if (onlyPlanned && !item?.assignedByTrainerId) continue;

        const key = groupKey(item);
        // Un item sin nombre ni producto no se puede comprar: entra en el
        // contador de descartados en vez de aparecer como una fila en
        // blanco en mitad de la lista.
        if (!key) continue;

        const quantity = toPositive(item?.quantity);
        if (!quantity) continue;

        dayHadItems = true;

        if (!byProduct.has(key)) {
          byProduct.set(key, {
            key,
            name: productName(item) || "Sin nombre",
            // Las cantidades de CustomProduct están siempre en gramos (o ml
            // para líquidos, que el catálogo trata igual). No hay unidad que
            // arrastrar: la de origen es la misma para todos.
            quantity: 0,
            days: new Set(),
          });
        }

        const entry = byProduct.get(key);
        entry.quantity += quantity;
        entry.days.add(day.date);
      }
    }

    if (dayHadItems) dates.add(day.date);
  }

  const items = [...byProduct.values()]
    .map((entry) => ({
      name: entry.name,
      // Un decimal: comprar "1234,5 g de arroz" ya es más precisión de la
      // que tiene sentido en un supermercado, pero redondear a entero
      // acumularía error sobre treinta días.
      quantity: Math.round(entry.quantity * 10) / 10,
      // En cuántos días aparece: distingue el pollo de todos los días del
      // aguacate del domingo, que se compran de forma distinta.
      dayCount: entry.days.size,
    }))
    // Por cantidad descendente: lo que más se compra encabeza la lista.
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "es"));

  return {
    items,
    // Días del rango que REALMENTE tenían algo pautado. Sin esto, una lista
    // corta parecería un plan flojo cuando lo que pasa es que solo hay tres
    // días pautados de los treinta pedidos.
    daysWithPlan: dates.size,
  };
}

module.exports = {
  buildShoppingList,
  // Exportadas para test unitario: son las dos decisiones con criterio
  // propio (qué cuenta como un mismo producto, y qué productos tiene una
  // comida cuando hay recetas de por medio).
  groupKey,
  productsOfMeal,
};
