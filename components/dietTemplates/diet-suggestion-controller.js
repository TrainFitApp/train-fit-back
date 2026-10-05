const dietTemplateDao = require("./diet-template-dao");
const { contentMacroProfile } = require("./diet-macro-profile");
const { rankTemplates, goalToTarget } = require("./diet-suggestion");
const { effectiveSuitability } = require("./diet-suitability");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const nutritionalGoalDao = require("../nutritionalGoals/nutritional-goal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const userSchema = require("../users/schema");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { stepsFromHabit } = require("../planAssignments/week-need");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");

const VALID_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

// kcal/macros tecleados por el entrenador. Sin kcal válidas no hay override:
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

// El objetivo nutricional en uso del cliente (User.goalInUse), o null si no
// tiene o no llega a tener kcal.
async function currentGoalOf(clientId) {
  const user = await userSchema.findById(clientId).select("goalInUse").lean();
  const goal = user?.goalInUse ? await nutritionalGoalDao.findById(user.goalInUse) : null;
  return goalToTarget(goal);
}

module.exports = {
  // POST /trainer/clients/:clientId/diet-suggestions
  // body: { target?: { kcal, protein, carbs, fat }, dietaryFlags?, sources?, proteinPerKg?, fatPerKg? }
  //
  // Devuelve el objetivo de REFERENCIA calculado con los últimos datos del
  // cliente (último peso, último rango de pasos declarado en un check-in) y
  // la lista de plantillas rankeadas por cercanía. Si el entrenador teclea
  // encima sus propias kcal/macros (`target`), el ranking se hace contra
  // ESOS números y la respuesta lo marca como manual: ya no hay "tipo de
  // fase" ni "ajuste de kcal" que traducir a un objetivo.
  async suggest(req, res) {
    const trainerId = req.auth.userId;
    const { clientId } = req.params;
    // Override manual de g/kg del cajón de sugerencias — 0/negativo/no-numérico
    // se descarta y cae a la fórmula por defecto (ver computeNutritionTarget).
    const proteinPerKg = Number(req.body?.proteinPerKg);
    const fatPerKg = Number(req.body?.fatPerKg);
    const macroOverride = {
      proteinPerKg: proteinPerKg > 0 ? proteinPerKg : undefined,
      fatPerKg: fatPerKg > 0 ? fatPerKg : undefined,
    };

    // Pasos: los de su hábito en las dos últimas semanas (§12). Sin hábito
    // o sin marcarlo, manda el rango de su perfil.
    const today = await todayForUser(clientId);
    const stepsWindow = { start: addDaysToIsoDate(today, -14), end: today };
    const stepsTask = await trainerTaskDao.findActiveStepsTask(clientId);
    const stepsCompletions = stepsTask
      ? await trainerTaskDao.listCompletionsForTasksInRange([stepsTask._id], stepsWindow.start, stepsWindow.end)
      : [];
    const latestSteps = stepsFromHabit(stepsTask, stepsCompletions.length, stepsWindow, today);
    const [resolved, prefs, currentGoal] = await Promise.all([
      resolveClientNutritionTarget(clientId, 0, macroOverride, {
        stepsRangeKey: latestSteps?.key || null,
        useClientObjetive: true,
      }),
      nutritionPreferencesDao.getByClientId(clientId),
      currentGoalOf(clientId),
    ]);

    if (!resolved.ok) {
      return res.status(422).send({ code: "MISSING_BIOMETRICS", missing: resolved.missing });
    }
    const { weightSource, clientObjetive } = resolved;
    const calculated = resolved.target;
    const manual = sanitizeTarget(req.body?.target);
    const target = manual || calculated;

    const requiredFlags = Array.isArray(req.body?.dietaryFlags)
      ? req.body.dietaryFlags.filter((f) => VALID_FLAGS.includes(f))
      : (prefs?.dietaryFlags || []).filter((f) => VALID_FLAGS.includes(f));

    const templates = await dietTemplateDao.listRankableForClient(trainerId, clientId, req.body?.sources);
    const candidates = templates.map((t) => {
      const doc = t.toObject ? t.toObject() : t;
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
    });

    const { ranked } = rankTemplates(candidates, target, requiredFlags);

    return res.send({
      target: {
        kcal: target.kcal,
        protein: target.protein,
        carbs: target.carbs,
        fat: target.fat,
        source: manual ? "manual" : "calculated",
      },
      // El calculado siempre viaja, aunque el entrenador haya tecleado
      // encima: es lo que permite volver atrás de un vistazo.
      calculated,
      // El objetivo que el cliente tiene ahora (null = ninguno): el panel deja
      // alternar entre él y el calculado.
      currentGoal,
      // Qué pasos entraron en el cálculo y de dónde (null = del rango del
      // perfil del cliente).
      stepsFromHabit: latestSteps,
      needBreakdown: { inputs: resolved.inputs, breakdown: resolved.breakdown },
      weightSource,
      // Peso sobre el que se aplican los g/kg: el ajustado si IMC ≥ 30
      // (nutrition-target.js#getFinalWeight), si no el real. El panel lo usa
      // para pasar los gramos que toca el entrenador a proteinPerKg/fatPerKg
      // sin que el backend devuelva otros gramos.
      macroWeightKg: resolved.breakdown?.adjustedWeightKg ?? weightSource?.weightKg ?? null,
      // El objetivo que el cliente eligió al registrarse (delta kcal con
      // signo) — el cajón lo usa para arrancar en Definir/Mantener/Volumen
      // en vez de siempre Definir. El entrenador manda igual.
      clientObjetive,
      // Restricciones que el cliente declaró en el intake — el cajón las
      // pre-marca la primera vez (mismo criterio que clientObjetive).
      clientDietaryFlags: (prefs?.dietaryFlags || []).filter((f) => VALID_FLAGS.includes(f)),
      requiredFlags,
      ranked,
    });
  },
};
