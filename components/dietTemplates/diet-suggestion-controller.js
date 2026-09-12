const dietTemplateDao = require("./diet-template-dao");
const { cycleMacroProfile } = require("./diet-macro-profile");
const { rankTemplates } = require("./diet-suggestion");
const { effectiveSuitability } = require("./diet-suitability");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");

const VALID_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

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

    const [resolved, prefs] = await Promise.all([
      resolveClientNutritionTarget(clientId, objetiveKcalDelta),
      nutritionPreferencesDao.getByClientId(clientId),
    ]);

    if (!resolved.ok) {
      return res.status(422).send({ code: "MISSING_BIOMETRICS", missing: resolved.missing });
    }
    const { target, weightSource, clientObjetive } = resolved;

    const requiredFlags = Array.isArray(req.body?.dietaryFlags)
      ? req.body.dietaryFlags.filter((f) => VALID_FLAGS.includes(f))
      : (prefs?.dietaryFlags || []).filter((f) => VALID_FLAGS.includes(f));

    const VALID_SOURCES = ["general", "client", "verified"];
    const sources = Array.isArray(req.body?.sources)
      ? req.body.sources.filter((s) => VALID_SOURCES.includes(s))
      : null;
    const templates = await dietTemplateDao.listRankableForClient(trainerId, clientId, sources);
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

    const { ranked } = rankTemplates(candidates, target, requiredFlags);

    return res.send({
      target: {
        kcal: target.kcal,
        protein: target.protein,
        carbs: target.carbs,
        fat: target.fat,
        objetiveKcalDelta,
      },
      weightSource,
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
