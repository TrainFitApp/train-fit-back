// Gathering de biométricos + guard + cálculo del target de un cliente,
// compartido entre el cajón de sugerencias de dieta
// (dietTemplates/diet-suggestion-controller.js#suggest) y la necesidad por
// ciclo del resumen de fase (planAssignments/cycle-need.js).
// Extraído para no mantener la misma lógica de guard/fallback de peso en
// dos sitios (antes solo vivía en diet-suggestion-controller.js).

const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { explainNutritionTarget } = require("./nutrition-target");
const {
  stepsRangeFromValue,
  stepsRangeFromAverage,
  trainingDaysFromFactors,
  trainingFactor,
} = require("./training-factor");

function ageFromBirth(birth, at = new Date()) {
  if (!birth) return null;
  const ms = at.getTime() - new Date(birth).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
}

// Pasos y factor de entrenamiento que entran en la fórmula. Sin media
// declarada (check-in del ciclo anterior), los del perfil tal cual. Con
// media, se mapea al rango y se recalcula el factor combinado con los días
// de entrenamiento del perfil (ver training-factor.js); si el perfil no
// permite recuperar esos días (rango de pasos desconocido) se cae al perfil
// y se dice por qué.
function resolveSteps(user, stepsAvg) {
  const profileRange = stepsRangeFromValue(user?.steps);
  const profile = {
    stepsValue: user?.steps ?? null,
    stepsLabel: profileRange?.label || null,
    stepsFrom: "profile",
    stepsAvg: null,
    trainingValue: user?.training ?? null,
    trainingDays: profileRange ? trainingDaysFromFactors(profileRange.value, user?.training) : null,
  };

  const avg = Number(stepsAvg);
  if (!Number.isFinite(avg) || stepsAvg === null) return profile;

  const loggedRange = stepsRangeFromAverage(avg);
  if (!loggedRange || !profile.trainingDays) {
    return { ...profile, stepsAvg: Math.round(avg), stepsFallbackReason: "profile_unresolved" };
  }
  return {
    stepsValue: loggedRange.value,
    stepsLabel: loggedRange.label,
    stepsFrom: "logged",
    stepsAvg: Math.round(avg),
    trainingValue: trainingFactor(loggedRange.value, profile.trainingDays.id),
    trainingDays: profile.trainingDays,
  };
}

/**
 * @param {{ proteinPerKg?: number, fatPerKg?: number }} [macroOverride]
 *   Override manual del cajón de sugerencias (g/kg) — ver
 *   nutrition-target.js#computeNutritionTarget.
 * @param {{ asOf?: string, stepsAvg?: number|null }} [options]
 *   asOf: fecha ISO — el peso es el último registrado hasta ese día (y la
 *   edad, la de ese día). Sin él, el último que haya.
 *   stepsAvg: media diaria de pasos que el cliente declaró en el check-in
 *   del ciclo anterior; con ella entra en la fórmula en vez del perfil.
 * @returns {{ ok: true, target, weightSource, clientObjetive, inputs, breakdown }
 *          | { ok: false, missing: string[], inputs }}
 */
async function resolveClientNutritionTarget(clientId, objetiveKcalDelta = 0, macroOverride = {}, options = {}) {
  const [user, anthros] = await Promise.all([
    userSchema.findById(clientId).select("sex height birth activity steps training weight objetive").lean(),
    anthropometryDao.getAllAnthropometriesByUserId(clientId),
  ]);

  // El peso sale de la última antropometría (hasta `asOf` si se pide); si el
  // cliente todavía no tiene ninguna (recién registrado, invitado por un
  // entrenador), se usa el que metió en el registro (`User.weight`).
  const latestAnthroWeight = (anthros || []).find(
    (a) => Number.isFinite(a.weight) && (!options.asOf || !a.date || a.date <= options.asOf)
  );
  const weightKg = latestAnthroWeight?.weight ?? (Number.isFinite(user?.weight) ? user.weight : null);
  const weightSource = latestAnthroWeight
    ? { weightKg: latestAnthroWeight.weight, date: latestAnthroWeight.date, from: "anthropometry" }
    : weightKg !== null
    ? { weightKg, from: "signup" }
    : null;
  const age = ageFromBirth(user?.birth, options.asOf ? new Date(`${options.asOf}T12:00:00`) : new Date());
  const steps = resolveSteps(user, options.stepsAvg);

  const delta = Number.isFinite(objetiveKcalDelta) ? objetiveKcalDelta : 0;
  const inputs = {
    weightKg,
    weightFrom: weightSource?.from || null,
    weightDate: weightSource?.date || null,
    heightCm: user?.height ?? null,
    age,
    sex: user?.sex ?? null,
    activity: user?.activity ?? null,
    ...steps,
    objetiveKcalDelta: delta,
    proteinPerKg: macroOverride.proteinPerKg ?? null,
    fatPerKg: macroOverride.fatPerKg ?? null,
  };

  // Guard — sin biométricos no hay objetivo (mismo criterio que la pantalla
  // de objetivo del cliente).
  const missing = [];
  if (weightKg === null) missing.push("peso");
  if (!user?.height) missing.push("altura");
  if (age === null) missing.push("fecha de nacimiento");
  if (user?.sex === undefined || user?.sex === null) missing.push("sexo");
  if (missing.length) return { ok: false, missing, inputs };

  const explained = explainNutritionTarget({
    weightKg,
    heightCm: user.height,
    age,
    sex: user.sex,
    activity: user.activity,
    steps: steps.stepsValue,
    training: steps.trainingValue,
    objetiveKcalDelta: delta,
    proteinPerKg: macroOverride.proteinPerKg,
    fatPerKg: macroOverride.fatPerKg,
  });

  return {
    ok: true,
    target: explained.target,
    breakdown: explained.breakdown,
    inputs,
    weightSource,
    // El objetivo que el cliente eligió al registrarse (delta kcal con
    // signo) — para que el panel arranque en Definir/Mantener/Volumen en
    // vez de siempre Definir.
    clientObjetive: Number.isFinite(user.objetive) ? user.objetive : null,
  };
}

module.exports = { resolveClientNutritionTarget, resolveSteps };
