const dietTemplateDao = require("./diet-template-dao");
const { MEALS } = require("../dietDays/diet-days-util");

const VALID_SLOTS = new Set(Object.values(MEALS));
const MAX_ALTERNATIVES = 4;

// Fase 9 — 0 alternativas = comida vacía, 1 = sin elección, 2+ = el cliente
// elige (ver diet-day-resolver.js#applyResolvedPlanToDietDay).
function sanitizeAlternatives(alternatives) {
  return (Array.isArray(alternatives) ? alternatives : [])
    .slice(0, MAX_ALTERNATIVES)
    .map((alt) => ({
      label: (alt?.label || "").toString().trim().slice(0, 100),
      customProducts: Array.isArray(alt?.customProducts) ? alt.customProducts : [],
      customRecipes: Array.isArray(alt?.customRecipes) ? alt.customRecipes : [],
    }));
}

function sanitizeMeals(meals) {
  return (Array.isArray(meals) ? meals : [])
    .filter((meal) => VALID_SLOTS.has(meal?.slot))
    .map((meal) => ({
      slot: meal.slot,
      alternatives: sanitizeAlternatives(meal?.alternatives),
    }));
}

function sanitizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map((day) => ({
    dayLabel: (day?.dayLabel || "").toString().trim().slice(0, 50) || "Día",
    meals: sanitizeMeals(day?.meals),
  }));
}

// Auditoría de arquitectura (Fase 8) — "recurring" son patrones por día de
// la semana (appliesTo, 0=domingo..6=sábado, igual que Date#getDay()) en vez
// de una secuencia Día 1..N. Un valor fuera de 0-6 o repetido se descarta:
// nunca debe llegar al resolver un patrón ambiguo o inválido.
function sanitizeDayPatterns(dayPatterns) {
  if (!Array.isArray(dayPatterns)) return [];
  return dayPatterns.map((pattern) => ({
    name: (pattern?.name || "").toString().trim().slice(0, 50) || "Patrón",
    appliesTo: Array.from(
      new Set((Array.isArray(pattern?.appliesTo) ? pattern.appliesTo : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    ),
    meals: sanitizeMeals(pattern?.meals),
  }));
}

function sanitizeMode(mode) {
  return mode === "recurring" || mode === "choice" ? mode : "sequential";
}

module.exports = {
  // Funciones puras exportadas para test (diet-template-controller.test.js)
  // — mismo criterio que assertMealEditable en meal-service.js.
  sanitizeAlternatives,
  sanitizeMeals,
  sanitizeDays,
  sanitizeDayPatterns,
  sanitizeMode,

  // --- Lado profesional: biblioteca de plantillas propias ---
  async createTemplate(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const template = await dietTemplateDao.create(
      req.auth.userId,
      name,
      sanitizeDays(req.body?.days),
      sanitizeMode(req.body?.mode),
      sanitizeDayPatterns(req.body?.dayPatterns)
    );
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
    if (req.body?.mode !== undefined) patch.mode = sanitizeMode(req.body.mode);
    if (req.body?.dayPatterns !== undefined) patch.dayPatterns = sanitizeDayPatterns(req.body.dayPatterns);

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
};
