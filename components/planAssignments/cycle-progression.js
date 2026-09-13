// Sugerencias de dieta — la progresión ciclo a ciclo.
//
// Cuando llega un check-in nuevo (o el entrenador pulsa "Siguiente ciclo"),
// esto mira cómo respondió el peso y sugiere hacia dónde mover las kcal del
// siguiente ciclo. SIEMPRE es un borrador: el entrenador confirma o cambia.
//
// PURO. El servicio de arriba le pasa números ya calculados (tendencia de
// peso, adherencia de la fase) y aplica el resultado.

const ON_TRACK_BAND_KG = 0.1; // dentro de esto se considera "va según plan"
const LOW_ADHERENCE_PCT = 75;
const KCAL_PER_KG = 7700;
const MAX_STEP_KCAL = 400; // tope de un ajuste de un solo ciclo
const KCAL_FLOOR = 1000; // seguridad dura (el "suelo por sexo" es fase 2)

function round50(value) {
  return Math.round(value / 50) * 50;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {object} input
 * @param {number} input.previousCycleKcal   kcal objetivo del ciclo que acaba
 * @param {number|null} input.weightStartKg  peso al empezar el ciclo
 * @param {number|null} input.weightEndKg    peso del check-in nuevo
 * @param {number} input.daysElapsed         días reales entre las dos medidas
 * @param {number} input.expectedWeeklyRateKg  ritmo esperado (de nutrition-target)
 * @param {number|null} input.adherencePct   adherencia de la FASE (0-100) o null
 * @param {number} input.targetRatePerCycle  paso por defecto de la rampa (kcal)
 * @returns {{
 *   hasData: boolean, deltaKcal: number, nextCycleKcal: number,
 *   actualWeeklyRateKg: number|null, flag: string|null, reason: string
 * }}
 */
function suggestNextCycle(input) {
  const {
    previousCycleKcal,
    weightStartKg,
    weightEndKg,
    daysElapsed,
    expectedWeeklyRateKg = 0,
    adherencePct = null,
    targetRatePerCycle = 0,
  } = input || {};

  const base = Number.isFinite(previousCycleKcal) ? previousCycleKcal : 0;

  const hasWeight =
    Number.isFinite(weightStartKg) && Number.isFinite(weightEndKg) && daysElapsed > 0;

  // Sin datos → el ciclo siguiente repite lo mismo. No se inventa nada.
  if (!hasWeight) {
    return {
      hasData: false,
      deltaKcal: 0,
      nextCycleKcal: base,
      actualWeeklyRateKg: null,
      flag: null,
      reason: "El cliente no ha metido check-ins con peso: se repite el ciclo anterior tal cual.",
    };
  }

  const actualWeeklyRateKg =
    Math.round(((weightEndKg - weightStartKg) / daysElapsed) * 7 * 100) / 100;

  // Adherencia baja → se AVISA, pero se calcula igual (plan §7): el cliente
  // puede haber comido otras cosas que también le acerquen al objetivo, y
  // la decisión es del entrenador, no de un bloqueo.
  const lowAdherence =
    adherencePct !== null && Number.isFinite(adherencePct) && adherencePct < LOW_ADHERENCE_PCT;

  const gapKg = actualWeeklyRateKg - expectedWeeklyRateKg;

  let deltaKcal;
  let reason;

  if (Math.abs(gapKg) < ON_TRACK_BAND_KG) {
    // Va según plan → se aplica el paso de la rampa que puso el entrenador.
    deltaKcal = round50(targetRatePerCycle);
    reason = deltaKcal
      ? `Peso según lo esperado (${fmt(actualWeeklyRateKg)} kg/sem): se aplica el paso previsto de ${signed(deltaKcal)} kcal.`
      : `Peso según lo esperado (${fmt(actualWeeklyRateKg)} kg/sem): se mantienen las kcal.`;
  } else {
    // Corrige el desvío: cuántas kcal/día cierran ese hueco de kg/semana.
    const correction = round50((-gapKg * KCAL_PER_KG) / 7);
    deltaKcal = clamp(correction, -MAX_STEP_KCAL, MAX_STEP_KCAL);
    const slowFast = gapKg > 0 ? "más lento" : "más rápido";
    reason = `Peso ${fmt(actualWeeklyRateKg)} kg/sem, esperabas ${fmt(expectedWeeklyRateKg)} → vas ${slowFast}: ajuste de ${signed(deltaKcal)} kcal.`;
  }

  const nextCycleKcal = Math.max(KCAL_FLOOR, base + deltaKcal);
  // Si el suelo recorta el ajuste, el delta efectivo cambia.
  const effectiveDelta = nextCycleKcal - base;

  if (lowAdherence) {
    reason = `Adherencia del ciclo ${Math.round(adherencePct)} % (por debajo del ${LOW_ADHERENCE_PCT} %): el cálculo puede no ser fiable. ${reason}`;
  }

  return {
    hasData: true,
    deltaKcal: effectiveDelta,
    nextCycleKcal,
    actualWeeklyRateKg,
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
 * Escalado proporcional del contenido de un ciclo para dar en `nextCycleKcal`.
 * Multiplica la cantidad de cada CustomProduct por el factor y redondea a
 * gramo. Simple (MVP) — no trata la proteína distinto.
 *
 * @param {number} previousCycleKcal
 * @param {number} nextCycleKcal
 * @returns {number} factor a aplicar (1 si no se puede calcular)
 */
function scaleFactor(previousCycleKcal, nextCycleKcal) {
  if (!(previousCycleKcal > 0) || !(nextCycleKcal > 0)) return 1;
  return nextCycleKcal / previousCycleKcal;
}

// Aplica el factor a un árbol days[] / dayPatterns[] "clipboard" (el shape
// que espera diet-template-dao para materializar). Devuelve una copia nueva.
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
  suggestNextCycle,
  scaleFactor,
  scaleMealsContent,
};
