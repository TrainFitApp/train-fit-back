// Sugerencias de dieta — el objetivo calórico y de macros de un cliente, para
// rankear plantillas contra él y para calcular la progresión ciclo a ciclo.
//
// PORT del cálculo que ya hace la app del cliente (shared-core
// user.service.ts#setUserMacrosAndKcal): Mifflin-St Jeor + factor de gasto +
// reparto de macros por g/kg según el signo de `objetive`. Se replica aquí,
// número a número, porque backend y front son paquetes npm distintos y no
// comparten módulos. El test cruza los
// resultados contra los del front (body-metrics) para que no se
// desincronicen.
//
// TODO PURO: entran números, salen números. Sin mongoose, sin HTTP.

// Atwater (shared-core/models/macros-data.ts#MACROS_VALUES).
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

// shared-ui/constants/sex — female = 0, male = 1.
const SEX_MALE = 1;

// shared-ui/constants/steps — STEPS[notCounted].value.
const STEPS_NOT_COUNTED = 1;

function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Mifflin-St Jeor (1990). Idéntico a body-metrics.util.ts#bmrMifflinStJeor.
 *   Hombres: (10·peso) + (6.25·altura) − (5·edad) + 5
 *   Mujeres: (10·peso) + (6.25·altura) − (5·edad) − 161
 */
function bmrMifflinStJeor({ weightKg, heightCm, age, sex }) {
  if (!isPositive(weightKg) || !isPositive(heightCm) || !isPositive(age)) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === SEX_MALE ? base + 5 : base - 161);
}

/**
 * Peso ajustado si IMC ≥ 30 (user.service.ts#getFinalWeight). Un obeso
 * mórbido no necesita proteína para cada kilo de grasa: se usa un peso
 * corregido hacia el ideal.
 */
function getFinalWeight(weightKg, heightCm, sex) {
  if (!isPositive(weightKg) || !isPositive(heightCm)) return weightKg;
  const imc = weightKg / (heightCm / 100) ** 2;
  if (imc < 30) return weightKg;
  const idealWeight = (sex === SEX_MALE ? 50 : 45.5) + 0.91 * (heightCm - 152.4);
  return idealWeight + 0.4 * (weightKg - idealWeight);
}

/**
 * Gasto energético (user.service.ts#energyExpenditure). El comentario del
 * original avisa: si se cuentan pasos, `training` YA combina NEAT + TEA y
 * `activity`/`steps` no se usan; si no se cuentan, se multiplica por el
 * factor de actividad.
 */
function energyExpenditure(bmr, { activity, steps, training }) {
  const t = isPositive(training) ? training : 1;
  if (steps === STEPS_NOT_COUNTED) {
    return bmr * (isPositive(activity) ? activity : 1.2) * t;
  }
  return bmr * t;
}

/** Proteína g/día (user.service.ts#proteinsGTotal). g/kg por signo de objetive. */
function proteinGrams(objetiveKcalDelta, weightKg) {
  const gPerKg = objetiveKcalDelta > 0 ? 1.4 : objetiveKcalDelta === 0 ? 1.5 : 1.6;
  return gPerKg * weightKg;
}

/** Grasa g/día (user.service.ts#fatGTotal). g/kg por signo de objetive y sexo. */
function fatGrams(objetiveKcalDelta, weightKg, sex) {
  const isFemale = sex !== SEX_MALE;
  let gPerKg;
  if (objetiveKcalDelta > 0) gPerKg = isFemale ? 1.1 : 1.0;
  else if (objetiveKcalDelta === 0) gPerKg = isFemale ? 1.0 : 0.9;
  else gPerKg = isFemale ? 0.9 : 0.75;
  return gPerKg * weightKg;
}

/**
 * El objetivo completo de un cliente para un `objetiveKcalDelta` dado
 * (−déficit, 0 mantenimiento, +superávit — lo elige el entrenador en el
 * cajón de sugerencias, no el cliente).
 *
 * Devuelve null si faltan datos biométricos (mismo criterio que el guard que
 * bloquea la pantalla de objetivo del cliente): "no lo sé" no es "sale 0".
 *
 * @returns {{ kcal, protein, carbs, fat }|null}  kcal redondeadas, macros en g
 */
function computeNutritionTarget(params) {
  const explained = explainNutritionTarget(params);
  return explained ? explained.target : null;
}

/**
 * Lo mismo que computeNutritionTarget, pero enseñando la cuenta: cada paso
 * intermedio que el entrenador ve en el resumen de ciclo ("cómo se calculó
 * la necesidad"). Es LA implementación — computeNutritionTarget solo se
 * queda con el resultado, así los dos no pueden desincronizarse.
 *
 * @returns {{ target: { kcal, protein, carbs, fat }, breakdown }|null}
 *   breakdown: {
 *     weightKg, adjustedWeightKg (null si IMC < 30), bmr,
 *     usesActivity (true = perfil "no cuenta pasos": entra `activity`),
 *     activityFactor, trainingFactor, factor (el producto que multiplica al BMR),
 *     expenditure, delta, proteinPerKg, fatPerKg
 *   }
 */
function explainNutritionTarget({
  weightKg,
  heightCm,
  age,
  sex,
  activity,
  steps,
  training,
  objetiveKcalDelta = 0,
  // Override manual del cajón de sugerencias (g/kg de peso) — sin esto,
  // proteína/grasa salen de la fórmula por defecto según el signo del
  // delta y el sexo. Los carbohidratos siempre son el resto de las kcal.
  proteinPerKg,
  fatPerKg,
}) {
  const finalWeight = getFinalWeight(weightKg, heightCm, sex);
  const bmr = bmrMifflinStJeor({ weightKg: finalWeight, heightCm, age, sex });
  if (bmr === null) return null;

  const delta = Number.isFinite(objetiveKcalDelta) ? objetiveKcalDelta : 0;
  const expenditure = energyExpenditure(bmr, { activity, steps, training });
  const kcal = Math.round(expenditure + delta);

  const usesActivity = steps === STEPS_NOT_COUNTED;
  const activityFactor = usesActivity ? (isPositive(activity) ? activity : 1.2) : null;
  const trainingFactorUsed = isPositive(training) ? training : 1;

  const effectiveProteinPerKg = isPositive(proteinPerKg)
    ? proteinPerKg
    : proteinGrams(delta, finalWeight) / finalWeight;
  const effectiveFatPerKg = isPositive(fatPerKg) ? fatPerKg : fatGrams(delta, finalWeight, sex) / finalWeight;
  const protein = effectiveProteinPerKg * finalWeight;
  const fat = effectiveFatPerKg * finalWeight;
  const carbsKcal = kcal - (protein * KCAL_PER_G.protein + fat * KCAL_PER_G.fat);
  const carbs = carbsKcal / KCAL_PER_G.carbs;

  return {
    target: {
      kcal,
      protein: round1(protein),
      carbs: round1(Math.max(0, carbs)),
      fat: round1(fat),
    },
    breakdown: {
      weightKg,
      adjustedWeightKg: finalWeight !== weightKg ? round1(finalWeight) : null,
      bmr,
      usesActivity,
      activityFactor,
      trainingFactor: trainingFactorUsed,
      factor: round3(expenditure / bmr),
      expenditure: Math.round(expenditure),
      delta,
      proteinPerKg: round2(effectiveProteinPerKg),
      fatPerKg: round2(effectiveFatPerKg),
    },
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Ritmo de peso esperado (kg/semana) para un déficit/superávit dado.
 * ~7700 kcal por kilo de tejido. Signo: déficit → negativo (baja).
 */
function expectedWeeklyRateKg(objetiveKcalDelta) {
  if (!Number.isFinite(objetiveKcalDelta) || objetiveKcalDelta === 0) return 0;
  return round2((objetiveKcalDelta * 7) / 7700);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  KCAL_PER_G,
  SEX_MALE,
  STEPS_NOT_COUNTED,
  bmrMifflinStJeor,
  getFinalWeight,
  energyExpenditure,
  proteinGrams,
  fatGrams,
  computeNutritionTarget,
  explainNutritionTarget,
  expectedWeeklyRateKg,
};
