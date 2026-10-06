const dietTemplateService = require("./diet-template-service");
const { contentMacroProfile } = require("./diet-macro-profile");
const { rankTemplates, goalToTarget } = require("./diet-suggestion");
const { effectiveSuitability } = require("./diet-suitability");
const { DIETARY_FLAGS } = require("./diet-template-schema");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { stepsFromHabit } = require("../dietPhases/week-need");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");
const { httpError } = require("../util/http-error");

// Cajón "Empezar fase": el objetivo de REFERENCIA del cliente (calculado con
// sus últimos datos) y las plantillas de biblioteca ordenadas por cercanía.

const validFlags = (flags) => (Array.isArray(flags) ? flags.filter((flag) => DIETARY_FLAGS.includes(flag)) : []);

// kcal/macros tecleados por el profesional. Sin kcal válidas no hay override:
// vale el calculado.
function sanitizeTarget(target) {
  const kcal = Number(target?.kcal);
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  return {
    kcal: Math.round(kcal),
    protein: Math.round(Number(target?.protein) || 0),
    carbs: Math.round(Number(target?.carbs) || 0),
    fat: Math.round(Number(target?.fat) || 0),
  };
}

// g/kg tocados en el cajón; 0, negativo o no numérico = fórmula por defecto.
const positiveOrUndefined = (value) => {
  const number = Number(value);
  return number > 0 ? number : undefined;
};

// Pasos: los de su hábito en las dos últimas semanas. Sin hábito o sin
// marcarlo, manda el rango de su perfil.
async function latestStepsOf(clientId) {
  const today = await todayForUser(clientId);
  const window = { start: addDaysToIsoDate(today, -14), end: today };
  const task = await trainerTaskDao.findActiveStepsTask(clientId);
  const completions = task ? await trainerTaskDao.listCompletionsForTasksInRange([task._id], window.start, window.end) : [];
  return stepsFromHabit(task, completions.length, window, today);
}

function toCandidate(template) {
  const doc = template.toObject ? template.toObject() : template;
  const profile = contentMacroProfile(doc);
  return {
    _id: doc._id,
    name: doc.name,
    verified: !!doc.verified,
    ownerClientId: doc.ownerClientId || null,
    suitableFor: doc.suitableFor || [],
    suitableForOverride: doc.suitableForOverride || [],
    effectiveSuitableFor: effectiveSuitability(doc.suitableFor, doc.suitableForOverride),
    profile,
    basedOnDays: profile.basedOnDays,
  };
}

module.exports = {
  /**
   * `options`: { target?, dietaryFlags?, sources?, proteinPerKg?, fatPerKg? }.
   * Si el profesional teclea encima sus kcal/macros (`target`), el ranking se
   * hace contra ESOS números y la respuesta lo marca como manual.
   */
  async suggest(trainerId, clientId, options = {}) {
    const macroOverride = {
      proteinPerKg: positiveOrUndefined(options.proteinPerKg),
      fatPerKg: positiveOrUndefined(options.fatPerKg),
    };
    const latestSteps = await latestStepsOf(clientId);
    const [resolved, prefs, currentGoal] = await Promise.all([
      resolveClientNutritionTarget(clientId, 0, macroOverride, {
        stepsRangeKey: latestSteps?.key || null,
        useClientObjetive: true,
      }),
      nutritionPreferencesDao.getByClientId(clientId),
      nutritionalGoalService.getCurrentForUser(clientId),
    ]);
    if (!resolved.ok) {
      throw httpError(422, "Faltan datos del cliente para calcular su necesidad", "MISSING_BIOMETRICS", {
        missing: resolved.missing,
      });
    }

    const calculated = resolved.target;
    const manual = sanitizeTarget(options.target);
    const target = manual || calculated;
    const clientDietaryFlags = validFlags(prefs?.dietaryFlags);
    const requiredFlags = Array.isArray(options.dietaryFlags) ? validFlags(options.dietaryFlags) : clientDietaryFlags;

    const templates = await dietTemplateService.listRankableForClient(trainerId, clientId, options.sources);
    const { ranked } = rankTemplates(templates.map(toCandidate), target, requiredFlags);

    return {
      target: { kcal: target.kcal, protein: target.protein, carbs: target.carbs, fat: target.fat, source: manual ? "manual" : "calculated" },
      // El calculado siempre viaja, aunque el profesional haya tecleado
      // encima: es lo que permite volver atrás de un vistazo.
      calculated,
      // El objetivo que el cliente tiene ahora (null = ninguno): el panel deja
      // alternar entre él y el calculado.
      currentGoal: goalToTarget(currentGoal),
      // Qué pasos entraron en el cálculo y de dónde (null = del rango del
      // perfil del cliente).
      stepsFromHabit: latestSteps,
      needBreakdown: { inputs: resolved.inputs, breakdown: resolved.breakdown },
      weightSource: resolved.weightSource,
      // Peso sobre el que se aplican los g/kg: el ajustado si IMC ≥ 30
      // (nutrition-target.js#getFinalWeight), si no el real.
      macroWeightKg: resolved.breakdown?.adjustedWeightKg ?? resolved.weightSource?.weightKg ?? null,
      // El objetivo que eligió el cliente al registrarse (delta kcal con
      // signo): el cajón arranca en Definir/Mantener/Volumen según él.
      clientObjetive: resolved.clientObjetive,
      // Restricciones que el cliente declaró: el cajón las pre-marca.
      clientDietaryFlags,
      requiredFlags,
      ranked,
    };
  },
};
