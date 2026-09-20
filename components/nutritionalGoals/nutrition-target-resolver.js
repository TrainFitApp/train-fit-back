// Gathering de biométricos + guard + cálculo del target de un cliente,
// compartido entre el cajón de sugerencias de dieta
// (dietTemplates/diet-suggestion-controller.js#suggest) y la necesidad por
// revisión de una fase (planAssignments/revision-need.js).
// Extraído para no mantener la misma lógica de guard/fallback de peso en
// dos sitios (antes solo vivía en diet-suggestion-controller.js).

const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { explainNutritionTarget } = require("./nutrition-target");
const {
  stepsRangeFromValue,
  stepsRangeFromKey,
  trainingDaysFromFactors,
  trainingFactor,
} = require("./training-factor");

function ageFromBirth(birth, at = new Date()) {
  if (!birth) return null;
  const ms = at.getTime() - new Date(birth).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
}

// Pasos y factor de entrenamiento que entran en la fórmula. Sin rango
// declarado en un check-in, los del perfil tal cual. Con rango declarado, se
// recalcula el factor combinado con los días de entrenamiento del perfil (ver
// training-factor.js); si el perfil no permite recuperar esos días (rango de
// pasos desconocido) se cae al perfil y se dice por qué.
//
// Los pasos salen del HÁBITO de pasos que le pauta su profesional y de los
// días que el cliente lo marcó (docs/plan-revisiones.md §12): la fórmula
// solo usa el rango para elegir un factor, así que pedir un número exacto a
// diario era pedir una precisión que nadie tiene.
function resolveSteps(user, stepsRangeKey) {
  const profileRange = stepsRangeFromValue(user?.steps);
  const profile = {
    stepsValue: user?.steps ?? null,
    stepsLabel: profileRange?.label || null,
    stepsRangeKey: profileRange?.key || null,
    stepsFrom: "profile",
    trainingValue: user?.training ?? null,
    trainingDays: profileRange ? trainingDaysFromFactors(profileRange.value, user?.training) : null,
  };

  if (!stepsRangeKey) return profile;

  const declared = stepsRangeFromKey(stepsRangeKey);
  if (!declared || !profile.trainingDays) {
    return { ...profile, stepsFallbackReason: "profile_unresolved" };
  }
  return {
    stepsValue: declared.value,
    stepsLabel: declared.label,
    stepsRangeKey: declared.key,
    stepsFrom: "habit",
    trainingValue: trainingFactor(declared.value, profile.trainingDays.id),
    trainingDays: profile.trainingDays,
  };
}

/**
 * @param {{ proteinPerKg?: number, fatPerKg?: number }} [macroOverride]
 *   Override manual del cajón de sugerencias (g/kg) — ver
 *   nutrition-target.js#computeNutritionTarget.
 * @param {{ asOf?: string, stepsRangeKey?: string|null, useClientObjetive?: boolean }} [options]
 *   asOf: fecha ISO — el peso es el último registrado hasta ese día (y la
 *   edad, la de ese día). Sin él, el último que haya.
 *   stepsRangeKey: rango de pasos que sale del hábito cumplido; con él
 *   entra en la fórmula en vez del rango del perfil.
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
  const steps = resolveSteps(user, options.stepsRangeKey);

  // `useClientObjetive`: el delta lo pone el propio cliente (el objetivo que
  // eligió al registrarse). Es el valor de REFERENCIA que ve el entrenador
  // antes de tocar nada — ya no hay un "ajuste de kcal" que teclear aparte
  // (docs/plan-revisiones.md §11).
  const delta = options.useClientObjetive
    ? Number.isFinite(user?.objetive)
      ? user.objetive
      : 0
    : Number.isFinite(objetiveKcalDelta)
    ? objetiveKcalDelta
    : 0;
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
