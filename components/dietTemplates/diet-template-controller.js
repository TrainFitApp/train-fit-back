const dietTemplateDao = require("./diet-template-dao");
const mealModel = require("../meals/meal-service");
const notificationDao = require("../notifications/notification-dao");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");
const { MEALS } = require("../dietDays/diet-days-util");

const VALID_SLOTS = new Set(Object.values(MEALS));

function addDaysToIsoDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function sanitizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map((day) => ({
    dayLabel: (day?.dayLabel || "").toString().trim().slice(0, 50) || "Día",
    meals: (Array.isArray(day?.meals) ? day.meals : [])
      .filter((meal) => VALID_SLOTS.has(meal?.slot))
      .map((meal) => ({
        slot: meal.slot,
        customProducts: Array.isArray(meal.customProducts) ? meal.customProducts : [],
        customRecipes: Array.isArray(meal.customRecipes) ? meal.customRecipes : [],
      })),
  }));
}

module.exports = {
  // --- Lado profesional: biblioteca de plantillas propias ---
  async createTemplate(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const template = await dietTemplateDao.create(req.auth.userId, name, sanitizeDays(req.body?.days));
    return res.send(template);
  },

  async listTemplates(req, res) {
    const templates = await dietTemplateDao.listByTrainer(req.auth.userId);
    return res.send(templates);
  },

  async updateTemplate(req, res) {
    const existing = await dietTemplateDao.findOwnedByTrainer(req.auth.userId, req.params.id);
    if (!existing) return res.status(404).send({ message: "Plantilla no encontrada" });

    const patch = {};
    if (req.body?.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
      patch.name = name;
    }
    if (req.body?.days !== undefined) patch.days = sanitizeDays(req.body.days);

    const template = await dietTemplateDao.update(req.auth.userId, req.params.id, patch);
    return res.send(template);
  },

  async deleteTemplate(req, res) {
    const result = await dietTemplateDao.delete(req.auth.userId, req.params.id);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Plantilla no encontrada" });
    }
    res.sendStatus(204);
  },

  // POST /trainer/clients/:clientId/diet-templates/:templateId/apply —
  // requireActiveClient("nutrition"). body: { startDate: "YYYY-MM-DD" }.
  // Recorre los días de la plantilla aplicando cada comida con la MISMA
  // lógica que prescribeMeal (F12) — nunca duplica el clonado de
  // customProducts/customRecipes, solo la orquesta en bucle.
  async applyToClient(req, res) {
    try {
      const trainerId = req.auth.userId;
      const { clientId, templateId } = req.params;
      const startDate = (req.body?.startDate || "").toString();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return res.status(400).send({ message: "startDate inválida (YYYY-MM-DD)" });
      }

      const template = await dietTemplateDao.findOwnedByTrainer(trainerId, templateId);
      if (!template) return res.status(404).send({ message: "Plantilla no encontrada" });

      const appliedDays = [];
      for (let i = 0; i < template.days.length; i++) {
        const templateDay = template.days[i];
        const date = addDaysToIsoDate(startDate, i);
        const dietDay = await resolveOwnedDietDay(clientId, date);

        for (const templateMeal of templateDay.meals || []) {
          const targetMeal = (dietDay.meals || []).find((m) => m.name === templateMeal.slot);
          if (!targetMeal) continue;

          const mealClipboard = {
            customProducts: templateMeal.customProducts || [],
            customRecipes: templateMeal.customRecipes || [],
          };
          await mealModel.pasteMeal(mealClipboard, targetMeal, false);
          await mealModel.markAssignedByTrainer(targetMeal._id, trainerId);
        }

        appliedDays.push({ dayLabel: templateDay.dayLabel, date });
      }

      if (appliedDays.length) {
        await notificationDao.create(clientId, trainerId, "meal_prescribed", {
          date: appliedDays[0].date,
          mealName: template.name,
        });
      }

      return res.send({ appliedDays });
    } catch (e) {
      console.error("Error en applyToClient (diet template):", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },
};
