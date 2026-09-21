const dietTemplateDao = require("./diet-template-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { rejectIfReadOnly } = require("../trainerClients/trainer-seat-service");
const { MEALS } = require("../dietDays/diet-days-util");
const { cycleMacroProfile } = require("./diet-macro-profile");

const VALID_SLOTS = new Set(Object.values(MEALS));
const MAX_ALTERNATIVES = 4;

// Mismo criterio que recipe-controller.js#isAdmin — solo un admin puede
// marcar una plantilla como "de fábrica" (verified).
function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

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

// Días por ciclo en mode "choice" (ver diet-template-schema.js). undefined
// si no viene: el dao no toca el campo.
function sanitizeChoiceCycleDays(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
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

    // Sugerencias de dieta — dieta de fábrica (verified). Solo admin, mismo
    // criterio que Recipe (recipe-controller.js#isAdmin && body.verified).
    const verified = isAdmin(req) && req.body?.verified === true;

    // ownerClientId opcional — plantilla exclusiva de ese cliente (ver
    // diet-template-schema.js). Se comprueba la relación activa antes de
    // aceptarlo: sin esto, cualquier profesional podría colgar material de
    // biblioteca del id de un cliente que no es suyo.
    const ownerClientId = req.body?.ownerClientId || null;
    if (ownerClientId) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        req.auth.userId,
        ownerClientId
      );
      if (!relation) return res.status(403).send({ message: "Ese cliente no es tuyo" });
      if (await rejectIfReadOnly(req, res, ownerClientId)) return;
    }

    const template = await dietTemplateDao.create(
      req.auth.userId,
      name,
      sanitizeDays(req.body?.days),
      sanitizeMode(req.body?.mode),
      sanitizeDayPatterns(req.body?.dayPatterns),
      ownerClientId,
      verified,
      sanitizeChoiceCycleDays(req.body?.choiceCycleDays)
    );
    return res.send(template);
  },

  // Sin parámetros: solo plantillas generales (lo que esperan protocolos,
  // plantillas y cualquier selector genérico).
  // ?forClientId=<id> acota al material aplicable a ese cliente;
  // &onlyOwned=true deja SOLO las suyas (filtro activo del selector de
  // "Siguiente fase").
  // ?includeOwned=true las devuelve TODAS — lo usa la biblioteca, para que
  // una dieta propia no quede sin sitio donde volver a editarse.
  async listTemplates(req, res) {
    const forClientId = req.query?.forClientId || null;
    if (forClientId) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        req.auth.userId,
        forClientId
      );
      if (!relation) return res.status(403).send({ message: "Ese cliente no es tuyo" });
    }

    const templates = await dietTemplateDao.listByTrainer(req.auth.userId, {
      forClientId,
      onlyOwned: req.query?.onlyOwned === "true",
      includeOwned: req.query?.includeOwned === "true",
    });
    // Perfil de macros de un día tipo — para pintar las cards con kcal/P/C/G
    // (mismo cálculo que el cajón de sugerencias, sin objetivo de cliente).
    return res.send(
      templates.map((t) => {
        const doc = t.toObject ? t.toObject() : t;
        return { ...doc, macroProfile: cycleMacroProfile(doc) };
      })
    );
  },

  // GET /trainer/diet-templates/:id — una sola plantilla con su contenido
  // completo (days/dayPatterns). listTemplates ya devuelve esto para TODA la
  // lista; este endpoint es para cuando el consumidor solo conoce el id de
  // UNA (p. ej. precargar el builder con la plantilla elegida en el cajón de
  // sugerencias antes de aplicarla — ver diet-suggestion-drawer).
  async getTemplate(req, res) {
    const template = await dietTemplateDao.findOwnedByTrainer(req.auth.userId, req.params.id);
    if (!template) return res.status(404).send({ message: "Plantilla no encontrada" });
    const doc = template.toObject ? template.toObject() : template;
    return res.send({ ...doc, macroProfile: cycleMacroProfile(doc) });
  },

  async updateTemplate(req, res) {
    const existing = await dietTemplateDao.findOwnedByTrainer(req.auth.userId, req.params.id);
    if (!existing) return res.status(404).send({ message: "Plantilla no encontrada" });
    // Esta ruta es solo para plantillas de BIBLIOTECA. La copia congelada de
    // un cliente (clientId puesto) se edita por su propio endpoint
    // (plan-assignment-controller.js#updateContent), que sí exige que
    // pertenezca a ESE cliente concreto — aquí ni siquiera se comprueba eso,
    // así que dejarla pasar podría editar la dieta de un cliente por el
    // camino equivocado.
    if (existing.clientId) return res.status(404).send({ message: "Plantilla no encontrada" });

    const patch = {};
    if (req.body?.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
      patch.name = name;
    }
    if (req.body?.days !== undefined) patch.days = sanitizeDays(req.body.days);
    if (req.body?.mode !== undefined) patch.mode = sanitizeMode(req.body.mode);
    if (req.body?.dayPatterns !== undefined) patch.dayPatterns = sanitizeDayPatterns(req.body.dayPatterns);
    if (req.body?.choiceCycleDays !== undefined) patch.choiceCycleDays = sanitizeChoiceCycleDays(req.body.choiceCycleDays);
    // Sugerencias de dieta — aptitudes que el entrenador fuerza a mano
    // (cuando la deriva no basta por productos sin flag). El array derivado
    // (suitableFor) NUNCA se acepta del body: lo recalcula el dao.
    if (Array.isArray(req.body?.suitableForOverride)) {
      patch.suitableForOverride = req.body.suitableForOverride;
    }
    if (isAdmin(req) && typeof req.body?.verified === "boolean") {
      patch.verified = req.body.verified;
    }

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
