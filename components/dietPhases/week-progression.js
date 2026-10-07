// Sugerencias de dieta — la progresión de una SEMANA a la siguiente
// (docs/plan-semanas.md).
//
// Cuando el cliente manda su check-in, esto mira cómo respondió el peso y
// sugiere hacia dónde mover las kcal de la semana siguiente. SIEMPRE es un
// borrador: el entrenador confirma o cambia.
//
// Qué se espera que pase lo dice la propia pauta: la diferencia entre las
// kcal pautadas y la necesidad calculada del cliente con sus últimos datos
// ES el déficit o superávit, y de ahí sale el ritmo semanal esperado. Antes
// eso se tecleaba aparte al crear la fase (enfoque + ajuste de kcal + ritmo
// por ciclo) y podía contradecir a lo que la dieta pautaba de verdad.
//
// PURO. El servicio le pasa números ya calculados y aplica el resultado.

const { expectedWeeklyRateKg } = require("../nutritionalGoals/nutrition-target");

// La banda, el tope y los kcal/kg salen en la ayuda "Qué es el ritmo" del
// modal de la semana siguiente (trainers, CLIENTS.RITMO_INFO_*): si cambian,
// cambia también ese texto.
const ON_TRACK_BAND_KG = 0.1; // dentro de esto se considera "va según plan"
const LOW_ADHERENCE_PCT = 75;
const KCAL_PER_KG = 7700;
const MAX_STEP_KCAL = 400; // tope de un ajuste de una sola semana
const KCAL_FLOOR = 1000; // seguridad dura

function round50(value) {
  return Math.round(value / 50) * 50;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {object} input
 * @param {number} input.currentKcal      kcal pautadas en la semana que acaba
 * @param {number|null} input.needKcal    necesidad calculada con los últimos datos
 * @param {number|null} input.weightStartKg peso de referencia anterior
 * @param {number|null} input.weightEndKg   peso del último check-in
 * @param {number} input.daysElapsed        días reales entre las dos medidas
 * @param {number|null} input.adherencePct  adherencia de la semana (0-100)
 * @returns {{ hasData, deltaKcal, nextKcal, actualWeeklyRateKg,
 *             expectedWeeklyRateKg, flag, reason }}
 */
function suggestNextWeek(input) {
  const {
    currentKcal,
    needKcal = null,
    weightStartKg,
    weightEndKg,
    daysElapsed,
    adherencePct = null,
  } = input || {};

  const base = Number.isFinite(currentKcal) ? currentKcal : 0;
  const delta = Number.isFinite(needKcal) && base ? base - needKcal : 0;
  const expectedRate = expectedWeeklyRateKg(delta);

  const hasWeight = Number.isFinite(weightStartKg) && Number.isFinite(weightEndKg) && daysElapsed > 0;

  // Un ritmo necesita DOS pesos. Con uno solo (o con ninguno) no se inventa
  // nada: la semana siguiente repite, y se dice qué falta exactamente.
  if (!hasWeight) {
    const soloUno = Number.isFinite(weightEndKg) && !Number.isFinite(weightStartKg);
    return {
      hasData: false,
      deltaKcal: 0,
      nextKcal: base,
      actualWeeklyRateKg: null,
      expectedWeeklyRateKg: expectedRate,
      flag: null,
      reason: soloUno
        ? "Solo hay un peso: hasta el próximo check-in no se puede medir el ritmo, así que la semana siguiente repite lo pautado."
        : "Sin peso en los check-ins: la semana siguiente repite lo pautado.",
    };
  }

  const actualWeeklyRateKg = Math.round(((weightEndKg - weightStartKg) / daysElapsed) * 7 * 100) / 100;

  // Adherencia baja → se AVISA, pero se calcula igual: el cliente puede
  // haber comido otras cosas que también le acerquen al objetivo, y la
  // decisión es del entrenador, no de un bloqueo.
  const lowAdherence = adherencePct !== null && Number.isFinite(adherencePct) && adherencePct < LOW_ADHERENCE_PCT;

  const gapKg = actualWeeklyRateKg - expectedRate;

  let deltaKcal = 0;
  let reason;
  if (Math.abs(gapKg) < ON_TRACK_BAND_KG) {
    reason = `Peso según lo esperado (${fmt(actualWeeklyRateKg)} kg/sem): se mantienen las kcal.`;
  } else {
    // Corrige el desvío: cuántas kcal/día cierran ese hueco de kg/semana.
    const correction = round50((-gapKg * KCAL_PER_KG) / 7);
    deltaKcal = clamp(correction, -MAX_STEP_KCAL, MAX_STEP_KCAL);
    const slowFast = gapKg > 0 ? "más lento" : "más rápido";
    reason = `Peso ${fmt(actualWeeklyRateKg)} kg/sem frente a ${fmt(expectedRate)} esperado → va ${slowFast}: ajuste de ${signed(deltaKcal)} kcal.`;
  }

  const nextKcal = Math.max(KCAL_FLOOR, base + deltaKcal);
  const effectiveDelta = nextKcal - base;

  if (lowAdherence) {
    reason = `Adherencia de la semana ${Math.round(adherencePct)} % (por debajo del ${LOW_ADHERENCE_PCT} %): el cálculo puede no ser fiable. ${reason}`;
  }

  return {
    hasData: true,
    deltaKcal: effectiveDelta,
    nextKcal,
    actualWeeklyRateKg,
    expectedWeeklyRateKg: expectedRate,
    flag: lowAdherence ? "low_adherence" : null,
    reason,
  };
}

function fmt(kg) {
  return (kg > 0 ? "+" : "") + kg.toFixed(2);
}
function signed(n) {
  return (n > 0 ? "+" : "") + n;
}

/**
 * Escalado proporcional del contenido para dar en `nextKcal`: multiplica la
 * cantidad de cada CustomProduct por el factor y redondea a gramo. Simple —
 * no trata la proteína distinto.
 */
function scaleFactor(currentKcal, nextKcal) {
  if (!(currentKcal > 0) || !(nextKcal > 0)) return 1;
  return nextKcal / currentKcal;
}

// Aplica el factor a las comidas de un menú en shape "clipboard" (el que
// espera diet-template-dao para materializar). Devuelve una copia nueva.
function scaleMealsContent(meals, factor) {
  return (meals || []).map((meal) => ({
    ...meal,
    alternatives: (meal.alternatives || []).map((alt) => ({
      ...alt,
      customProducts: (alt.customProducts || []).map((cp) => scaleProduct(cp, factor)),
      customRecipes: (alt.customRecipes || []).map((cr) => ({
        ...cr,
        quantity: roundQty((cr.quantity || 0) * factor) || cr.quantity,
      })),
    })),
  }));
}

function scaleProduct(cp, factor) {
  const q = cp?.quantity;
  if (!(q > 0)) return { ...cp };
  return { ...cp, quantity: roundQty(q * factor) };
}

function roundQty(value) {
  return Math.max(1, Math.round(value));
}

module.exports = {
  LOW_ADHERENCE_PCT,
  suggestNextWeek,
  scaleFactor,
  scaleMealsContent,
};
