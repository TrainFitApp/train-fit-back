// El perfil de macros de UNA ración de un grupo de intercambio.
//
// Por qué existe, y por qué aquí y no en el front como exchange-math.util.ts:
// aquella son las dos divisiones que se ejecutan mientras el entrenador
// teclea (cuántas raciones son 30 g, cuánto hay que comer para 2 raciones), y
// viven donde se ejecutan. Esto es otra cosa — leer las macros reales de los
// productos vinculados y resumirlas — y el primero que lo necesita es la
// migración, que corre en el servidor. El front recibirá el perfil ya
// calculado en el documento.
//
// LO QUE ESTO SIGUE SIN HACER: decidir equivalencias. No convierte un
// alimento en otro ni iguala nada por su cuenta. Lee lo que el entrenador ya
// escribió (qué alimentos, en qué cantidad) contra el catálogo, y dice qué
// macros tiene eso de verdad. Si él igualó mal, esto lo enseña — no lo
// corrige.
//
// El porqué del perfil COMPLETO y no un solo macro: `basis`/`basisAmount`
// declaraban una sola cifra ("1 ración = 20 g de proteína"), y con una sola
// cifra el reparto del día no se puede comparar contra las kcal ni contra los
// otros dos macros del objetivo. El cuadre era imposible por el modelo, no
// por la interfaz.

/** Los cuatro que se comparan contra el objetivo (kcalTotal, proteinsGTotal…). */
const MACROS = ["kcal", "protein", "carbs", "fat"];

/** Qué puede igualar un grupo. Mismo conjunto que el antiguo `basis`. */
const ANCHORS = ["protein", "carbs", "fat", "kcal"];

const PRODUCT_FIELD = {
  kcal: "energyKcal100g",
  protein: "protein100g",
  carbs: "carbohydrates100g",
  fat: "fat100g",
};

// Solo estas dos escalan por 100. Una ración en "ud", "cda" o "taza" no se
// puede contrastar contra un producto que da sus macros por 100 g, y fingir
// que sí sería justo el tipo de cosa al aire que este componente evita.
const WEIGHABLE_UNITS = new Set(["g", "ml"]);

function emptyServing() {
  return { kcal: null, protein: null, carbs: null, fat: null };
}

function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// Las kcal en entero y los macros con un decimal: es la precisión con la que
// se pauta, y arrastrar 20.700000000000003 al documento solo genera diffs.
function round(macro, value) {
  if (value === null || !Number.isFinite(value)) return null;
  return macro === "kcal" ? Math.round(value) : Math.round(value * 10) / 10;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Un producto tal y como lo devuelve `populate` (macros por 100 g), o null.
 *
 * Se acepta tanto `item.product` (lo que puebla listMine) como el objeto
 * dentro de `item.productId` (lo que devuelve un populate sin aplanar), para
 * que la migración pueda leer el documento crudo sin reformatearlo antes.
 */
function productOf(item) {
  const candidate = item?.product || item?.productId;
  if (!candidate || typeof candidate !== "object") return null;
  return MACROS.some((macro) => Number.isFinite(candidate[PRODUCT_FIELD[macro]]))
    ? candidate
    : null;
}

/**
 * Las macros REALES de un alimento en la cantidad que escribió el entrenador.
 *
 * null cuando no se puede saber: sin producto vinculado, sin cantidad, o
 * pautado en una unidad que no escala por 100 g. Cada macro por separado
 * puede ser null si el producto no la trae — un producto sin grasa declarada
 * no es un producto con 0 g de grasa.
 */
function itemMacros(item) {
  const product = productOf(item);
  if (!product) return null;
  if (!isPositive(Number(item?.quantity))) return null;
  if (!WEIGHABLE_UNITS.has(String(item?.unit || "g"))) return null;

  const factor = Number(item.quantity) / 100;
  const macros = {};
  for (const macro of MACROS) {
    const per100 = product[PRODUCT_FIELD[macro]];
    macros[macro] = Number.isFinite(per100) ? round(macro, per100 * factor) : null;
  }
  return macros;
}

/**
 * El perfil de una ración deducido de los alimentos vinculados del grupo.
 *
 * MEDIANA y no media, a propósito: en el grupo de proteína del seed el tofu
 * tiene 12,8 g de grasa contra 0,5-2 g del resto. La media desplazaría el
 * perfil entero por un alimento; la mediana lo deja donde está y el tofu se
 * marca como lo que es, un alimento que se sale del grupo.
 *
 * Devuelve también CUÁNTOS alimentos han podido calcularse: un perfil sacado
 * de 2 de 6 alimentos no merece la misma confianza que uno sacado de 6, y
 * quien lo use tiene que poder decirlo en pantalla.
 */
function computeServing(items) {
  const list = Array.isArray(items) ? items : [];
  const perItem = list.map(itemMacros);
  const usable = perItem.filter(Boolean);

  const serving = emptyServing();
  for (const macro of MACROS) {
    const values = usable.map((macros) => macros[macro]).filter((v) => v !== null);
    serving[macro] = round(macro, median(values));
  }

  return { serving, computedFrom: usable.length, total: list.length };
}

/** Un perfil sirve para cuadrar si tiene al menos un macro declarado. */
function hasServing(serving) {
  return MACROS.some((macro) => isPositive(Number(serving?.[macro])));
}

/**
 * Un perfil cuadra el día entero solo si están los cuatro.
 *
 * `Number(null)` es 0 y `Number.isFinite(0)` es true, así que hay que
 * preguntar por el null ANTES de convertir: si no, un perfil al que le falta
 * un macro se da por completo y el cuadre del día sale bajo sin decir nada.
 */
function isDeclared(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function isCompleteServing(serving) {
  return MACROS.every((macro) => isDeclared(serving?.[macro]));
}

/**
 * Cuánto se desvía un alimento del perfil, medido en el macro que el grupo
 * dice igualar.
 *
 * Solo el anchor: igualar proteína hace que la grasa varíe entre alimentos
 * necesariamente — el propio seed lo dice ("La grasa cambia entre ellos") —
 * y marcar esa variación como error sería marcar el método en sí.
 *
 * null = no comprobable (sin producto, sin anchor, sin perfil). No es un 0:
 * "no se puede saber" y "cuadra exacto" son estados distintos y el segundo no
 * se puede afirmar sin datos.
 */
function itemDeviation(item, serving, anchor) {
  if (!ANCHORS.includes(anchor)) return null;
  const expected = Number(serving?.[anchor]);
  if (!isPositive(expected)) return null;

  const macros = itemMacros(item);
  const actual = macros?.[anchor];
  if (actual === null || actual === undefined) return null;

  return {
    macro: anchor,
    actual,
    expected: round(anchor, expected),
    pct: Math.round(((actual - expected) / expected) * 1000) / 10,
  };
}

/**
 * El cuadre del día: lo que suma un reparto en intercambios.
 *
 * Suma `count × serving` sobre el perfil CONGELADO de cada ración (el que se
 * copió al pautar), no sobre el grupo actual: si el entrenador retoca el
 * grupo mañana, la pauta que el cliente ya tiene no puede cambiar de
 * significado sola.
 *
 * Tres estados, y no dos, porque no significan lo mismo:
 *
 *   - `counted`   suma.
 *   - `free`      NO suma y está bien que no sume ("Verduras libres": el
 *                 entrenador decidió que ese grupo no se pesa).
 *   - `incomplete` NO suma y es un agujero: falta el perfil y nadie sabe
 *                 cuánto aporta.
 *
 * Meter los dos últimos juntos haría que un reparto perfectamente definido se
 * marcara como no cuadrable por tener verduras, y el entrenador aprendería a
 * ignorar el aviso — que es la forma de que un aviso deje de servir. `free`
 * se enseña como nota, `incomplete` impide dar el cuadre por bueno.
 */
function sumReparto(meals) {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const incomplete = [];
  const free = [];
  let counted = 0;

  for (const meal of Array.isArray(meals) ? meals : []) {
    for (const exchange of Array.isArray(meal?.exchanges) ? meal.exchanges : []) {
      const count = Number(exchange?.count);
      const serving = exchange?.serving;
      if (!isPositive(count)) continue;

      const row = { groupName: exchange?.groupName || "", count };
      if (exchange?.freeQuantity) {
        free.push(row);
        continue;
      }
      if (!isCompleteServing(serving)) {
        incomplete.push(row);
        continue;
      }
      counted += 1;
      for (const macro of MACROS) totals[macro] += Number(serving[macro]) * count;
    }
  }

  for (const macro of MACROS) totals[macro] = round(macro, totals[macro]);
  return { totals, counted, free, incomplete };
}

/**
 * En qué estado está un grupo, en una palabra.
 *
 * Un solo sitio porque lo pintan tres pantallas y el informe: si cada una lo
 * dedujera a su manera acabarían discrepando, y el entrenador vería un grupo
 * "listo" en un sitio e "incompleto" en otro.
 */
function groupStatus(group) {
  if (group?.freeQuantity) return "free";
  if (!isCompleteServing(group?.serving)) return "incomplete";
  if (!group?.anchor) return "no-anchor";
  return "ready";
}

module.exports = {
  MACROS,
  groupStatus,
  ANCHORS,
  PRODUCT_FIELD,
  WEIGHABLE_UNITS,
  emptyServing,
  isDeclared,
  itemMacros,
  computeServing,
  hasServing,
  isCompleteServing,
  itemDeviation,
  sumReparto,
};
