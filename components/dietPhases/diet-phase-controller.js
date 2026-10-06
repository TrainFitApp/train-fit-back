const dietPhaseService = require("./diet-phase-service");
const dto = require("./diet-phase-dto");
const { badRequest } = require("../util/http-error");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value, field) {
  if (!ISO_DATE.test(value || "")) throw badRequest(`${field} inválida (YYYY-MM-DD)`);
  return value;
}

const positiveOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

// Con qué kcal y macros se pauta la fase. Sin kcal válidas no hay objetivo.
function sanitizeTarget(target) {
  const kcal = Number(target?.kcal);
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  return {
    kcal: Math.round(kcal),
    protein: Math.round(Number(target?.protein) || 0),
    carbs: Math.round(Number(target?.carbs) || 0),
    fat: Math.round(Number(target?.fat) || 0),
    source: target?.source === "manual" ? "manual" : "calculated",
  };
}

const optionalName = (value) => (value == null ? undefined : String(value).trim().slice(0, 100) || undefined);

function requiredName(value) {
  const name = optionalName(value);
  if (!name) throw badRequest("El nombre es obligatorio");
  return name;
}

const params = (req) => ({ clientId: req.params.clientId, phaseId: req.params.phaseId });

module.exports = {
  // POST /trainer/clients/:clientId/diet-phases
  // body: { startDate, templateId? | menus?, name?, target?, proteinPerKg?, fatPerKg?, reason? }
  // Con `templateId`, copia esa plantilla de la biblioteca (el nombre, si no
  // llega, es el suyo); sin él, `name` y `menus` construidos para el cliente.
  // 409 PLAN_OVERLAP si pisa una fase programada.
  async createPhase(req, res) {
    const body = req.body || {};
    const phase = await dietPhaseService.createPhase({
      trainerId: req.auth.userId,
      clientId: req.params.clientId,
      startDate: isoDate(body.startDate, "startDate"),
      templateId: body.templateId || null,
      name: optionalName(body.name),
      menus: body.menus,
      target: sanitizeTarget(body.target) || undefined,
      proteinPerKg: positiveOrNull(body.proteinPerKg),
      fatPerKg: positiveOrNull(body.fatPerKg),
      reason: body.reason,
    });
    return res.status(201).send(dto.summary(phase));
  },

  // GET /trainer/clients/:clientId/diet-phases — de la más reciente a la más
  // antigua, cada una con su estado hoy.
  async listPhases(req, res) {
    const phases = await dietPhaseService.listWithStates(req.params.clientId);
    return res.send(phases.map(({ phase, state }) => dto.summary(phase, state)));
  },

  // GET /trainer/clients/:clientId/diet-phases/current — la que rige hoy (o
  // null), con `stuckDaysCount`: días de ella en los que el cliente nunca
  // eligió menú.
  async getCurrent(req, res) {
    const current = await dietPhaseService.getCurrent(req.params.clientId);
    return res.send(current ? { ...dto.summary(current.phase, "current"), stuckDaysCount: current.stuckDaysCount } : null);
  },

  // GET /trainer/clients/:clientId/diet-phases/:phaseId — con los menús.
  async getPhase(req, res) {
    const { clientId, phaseId } = params(req);
    return res.send(dto.full(await dietPhaseService.getPhase(clientId, phaseId)));
  },

  // PATCH /trainer/clients/:clientId/diet-phases/:phaseId
  // body: { name?, startDate?, endDate? (null = abierta) }
  async updatePhase(req, res) {
    const body = req.body || {};
    const phase = await dietPhaseService.updatePhase({
      ...params(req),
      name: body.name === undefined ? undefined : requiredName(body.name),
      startDate: body.startDate === undefined ? undefined : isoDate(body.startDate, "startDate"),
      endDate: body.endDate === undefined || body.endDate === null ? body.endDate : isoDate(body.endDate, "endDate"),
    });
    return res.send(dto.summary(phase));
  },

  // DELETE /trainer/clients/:clientId/diet-phases/:phaseId — body: { reason? }
  async cancelPhase(req, res) {
    await dietPhaseService.cancelPhase({ ...params(req), trainerId: req.auth.userId, reason: req.body?.reason });
    return res.sendStatus(204);
  },

  // PUT /trainer/clients/:clientId/diet-phases/:phaseId/contents/:contentId — body: { menus }
  async updateContent(req, res) {
    const phase = await dietPhaseService.updateContent({
      ...params(req),
      contentId: req.params.contentId,
      menus: req.body?.menus,
    });
    return res.send(dto.full(phase));
  },

  // --- Semanas (docs/plan-semanas.md) ---

  // GET /trainer/clients/:clientId/diet-phases/:phaseId/weeks
  async getPhaseWeeks(req, res) {
    const { clientId, phaseId } = params(req);
    return res.send(await dietPhaseService.getPhaseWeeks(clientId, phaseId));
  },

  // GET /trainer/clients/:clientId/diet-phases/:phaseId/weeks/:number/need
  async getWeekNeed(req, res) {
    const { clientId, phaseId } = params(req);
    const number = Number(req.params.number);
    if (!Number.isInteger(number) || number < 1) throw badRequest("Número de semana inválido");
    return res.send(await dietPhaseService.getWeekNeed(clientId, phaseId, number));
  },

  // POST /trainer/clients/:clientId/diet-phases/:phaseId/weeks/next/scale — body: { kcal }
  // Contenido vigente escalado a esas kcal, para abrir el constructor
  // precargado. No escribe nada.
  async scaleNextWeek(req, res) {
    const { clientId, phaseId } = params(req);
    const kcal = Number(req.body?.kcal);
    if (!Number.isFinite(kcal) || kcal <= 0) throw badRequest("kcal debe ser mayor que 0");
    return res.send(await dietPhaseService.scaleNextWeek(clientId, phaseId, kcal));
  },

  // PUT /trainer/clients/:clientId/diet-phases/:phaseId/weeks/next — body: { menus }
  // La fecha es el lunes en que empieza la semana. 204 = el contenido no
  // cambia nada y no se guarda.
  async prepareNextWeek(req, res) {
    const phase = await dietPhaseService.prepareNextWeek({ ...params(req), menus: req.body?.menus });
    if (!phase) return res.sendStatus(204);
    return res.send(dto.summary(phase));
  },

  // DELETE /trainer/clients/:clientId/diet-phases/:phaseId/weeks/next
  async discardNextWeek(req, res) {
    const { clientId, phaseId } = params(req);
    await dietPhaseService.discardNextWeek(clientId, phaseId);
    return res.sendStatus(204);
  },

  // GET /trainer/clients/:clientId/diet-timeline?from&to
  async getDietTimeline(req, res) {
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      throw badRequest("from y to (YYYY-MM-DD) son obligatorios");
    }
    return res.send(await dietPhaseService.getDietTimeline(req.params.clientId, from, to));
  },

  // GET /trainer/clients/:clientId/nutrition-history
  async getNutritionHistory(req, res) {
    return res.send(await dietPhaseService.getNutritionHistory(req.params.clientId));
  },

  // POST /trainer/clients/:clientId/skipped-days — body: { date }
  async skipDay(req, res) {
    const skipped = await dietPhaseService.skipDay(req.params.clientId, isoDate(req.body?.date, "date"));
    return res.status(201).send(skipped);
  },
};
