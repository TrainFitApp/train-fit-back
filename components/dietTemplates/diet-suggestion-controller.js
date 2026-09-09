const dietTemplateDao = require("./diet-template-dao");
const { cycleMacroProfile } = require("./diet-macro-profile");
const { rankTemplates } = require("./diet-suggestion");
const { effectiveSuitability } = require("./diet-suitability");
const { computeNutritionTarget } = require("../nutritionalGoals/nutrition-target");
const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");

const VALID_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

function ageFromBirth(birth) {
  if (!birth) return null;
  const ms = Date.now() - new Date(birth).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
}

module.exports = {
  // POST /trainer/clients/:clientId/diet-suggestions
  // body: { objetiveKcalDelta, dietaryFlags?: string[] }
  //
  // Devuelve el objetivo calculado del cliente + la lista de plantillas
  // rankeadas por cercanía + las ocultas por el filtro dietético.
  async suggest(req, res) {
    const trainerId = req.auth.userId;
    const { clientId } = req.params;
    const objetiveKcalDelta = Number(req.body?.objetiveKcalDelta) || 0;

    const [user, anthros, prefs] = await Promise.all([
      userSchema.findById(clientId).select("sex height birth activity steps training").lean(),
      anthropometryDao.getAllAnthropometriesByUserId(clientId),
      nutritionPreferencesDao.getByClientId(clientId),
    ]);

    const latestWeight = (anthros || []).find((a) => Number.isFinite(a.weight));
    const age = ageFromBirth(user?.birth);

    // Guard — sin biométricos no hay objetivo (mismo criterio que la pantalla
    // de objetivo del cliente). El front pide una antropometría primero.
    const missing = [];
    if (!latestWeight) missing.push("peso");
    if (!user?.height) missing.push("altura");
    if (age === null) missing.push("fecha de nacimiento");
    if (user?.sex === undefined || user?.sex === null) missing.push("sexo");
    if (missing.length) {
      return res.status(422).send({ code: "MISSING_BIOMETRICS", missing });
    }

    const target = computeNutritionTarget({
      weightKg: latestWeight.weight,
      heightCm: user.height,
      age,
      sex: user.sex,
      activity: user.activity,
      steps: user.steps,
      training: user.training,
      objetiveKcalDelta,
    });

    const requiredFlags = Array.isArray(req.body?.dietaryFlags)
      ? req.body.dietaryFlags.filter((f) => VALID_FLAGS.includes(f))
      : (prefs?.dietaryFlags || []).filter((f) => VALID_FLAGS.includes(f));

    const templates = await dietTemplateDao.listRankableForClient(trainerId, clientId);
    const candidates = templates.map((t) => {
      const doc = t.toObject ? t.toObject() : t;
      const profile = cycleMacroProfile(doc);
      return {
        _id: doc._id,
        name: doc.name,
        verified: !!doc.verified,
        ownerClientId: doc.ownerClientId || null,
        mode: doc.mode,
        suitableFor: doc.suitableFor || [],
        suitableForOverride: doc.suitableForOverride || [],
        effectiveSuitableFor: effectiveSuitability(doc.suitableFor, doc.suitableForOverride),
        profile,
        basedOnDays: profile.basedOnDays,
      };
    });

    const { ranked, hidden } = rankTemplates(candidates, target, requiredFlags);

    return res.send({
      target: {
        kcal: target.kcal,
        protein: target.protein,
        carbs: target.carbs,
        fat: target.fat,
        objetiveKcalDelta,
      },
      weightSource: { weightKg: latestWeight.weight, date: latestWeight.date },
      requiredFlags,
      ranked,
      hidden,
    });
  },
};
