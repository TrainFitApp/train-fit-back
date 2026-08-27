// Movimiento 5 Coach Pro — la aritmética de los intercambios.
//
// LO QUE ESTO NO HACE, y sigue sin hacer: decidir equivalencias. La regla de
// fondo del componente (ver food-exchange-schema.js) es que el sistema no
// asume que 100 g de pollo equivalen a 120 g de pavo — eso depende del
// criterio del coach.
//
// Lo que SÍ hace: cuando el coach YA ha decidido que su ración de hidratos
// son 15 g, contar cuántas raciones son los 30 g que pone en una etiqueta.
// Eso no es una decisión, es una división — y es la que el coach hace a mano
// veinte veces al montar una dieta.
//
// Puro: entran números, salen números. Ver exchange-math.test.js.

// Bases sobre las que un grupo puede estar definido. Espejo del enum
// `basis` de FoodExchangeGroup.
const EXCHANGE_BASES = [
  { key: "protein", label: "Proteína", unit: "g" },
  { key: "carbs", label: "Hidratos", unit: "g" },
  { key: "fat", label: "Grasa", unit: "g" },
  { key: "kcal", label: "Calorías", unit: "kcal" },
];

const EXCHANGE_BASES_BY_KEY = new Map(EXCHANGE_BASES.map((base) => [base.key, base]));

// Media ración es la unidad más pequeña que un coach pauta de verdad. Se
// redondea a eso y no a decimales libres: "1,37 raciones de pan" no es una
// instrucción que nadie pueda seguir.
const EXCHANGE_STEP = 0.5;

function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundToStep(value) {
  return Math.round(value / EXCHANGE_STEP) * EXCHANGE_STEP;
}

/**
 * Cuántas raciones del grupo son `amount` unidades de su base.
 *
 * Devuelve null si el grupo no tiene base numérica: no es un 0, es que ese
 * grupo se definió como lista escrita a mano y no hay nada que dividir.
 */
function exchangesFor(group, amountOfBasis) {
  if (!group?.basis || !isPositive(group.basisAmount)) return null;
  if (!isPositive(amountOfBasis)) return null;

  const exact = amountOfBasis / group.basisAmount;
  return {
    exact: Math.round(exact * 100) / 100,
    // Lo que el coach va a escribir en la pauta.
    rounded: roundToStep(exact),
    basis: group.basis,
    basisAmount: group.basisAmount,
  };
}

/**
 * Lo contrario: cuánta base hay en N raciones. Es lo que necesita el reparto
 * por comidas para poder decir "el desayuno lleva 30 g de hidratos".
 */
function basisForExchanges(group, count) {
  if (!group?.basis || !isPositive(group.basisAmount)) return null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return Math.round(group.basisAmount * count * 10) / 10;
}

/**
 * Cuánto hay que comer de un ALIMENTO concreto del grupo para cubrir N
 * raciones.
 *
 * Aquí es donde se ve que no se inventa nada: la cantidad de cada alimento
 * la escribió el coach en el grupo (100 g de pollo, 120 g de pavo), y esto
 * solo la multiplica por el número de raciones. Si el coach puso mal la
 * equivalencia, sale mal — y eso es correcto, porque la equivalencia es
 * suya.
 */
function amountForExchanges(item, count) {
  if (!isPositive(item?.quantity)) return null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return {
    quantity: Math.round(item.quantity * count * 10) / 10,
    unit: item.unit || "g",
    name: item.name,
  };
}

/**
 * Suma de la base de todas las raciones de una comida, por grupo.
 *
 * Solo suma los grupos que TIENEN base numérica; los demás cuentan como
 * raciones y punto. Mezclarlos daría un total que parece completo y no lo
 * es, que es peor que no dar ninguno.
 */
function mealBasisTotals(meal, groupsById) {
  const totals = new Map();
  let withoutBasis = 0;

  for (const exchange of meal?.exchanges || []) {
    const group = groupsById.get(String(exchange.groupId));
    const amount = basisForExchanges(group, exchange.count);
    if (amount === null) {
      withoutBasis += 1;
      continue;
    }
    totals.set(group.basis, (totals.get(group.basis) || 0) + amount);
  }

  return {
    totals: [...totals.entries()].map(([basis, amount]) => ({
      basis,
      label: EXCHANGE_BASES_BY_KEY.get(basis)?.label || basis,
      unit: EXCHANGE_BASES_BY_KEY.get(basis)?.unit || "g",
      amount: Math.round(amount * 10) / 10,
    })),
    // Cuántos grupos de esta comida no se han podido sumar. La interfaz lo
    // dice, en vez de dar un total silenciosamente incompleto.
    groupsWithoutBasis: withoutBasis,
  };
}

module.exports = {
  EXCHANGE_BASES,
  EXCHANGE_BASES_BY_KEY,
  EXCHANGE_STEP,
  exchangesFor,
  basisForExchanges,
  amountForExchanges,
  mealBasisTotals,
};
