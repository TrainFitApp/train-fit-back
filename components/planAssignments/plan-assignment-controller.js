const planAssignmentService = require("./plan-assignment-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const {
  sanitizeDays,
  sanitizeMode,
  sanitizeDayPatterns,
} = require("../dietTemplates/diet-template-controller");
const dietExceptionDao = require("../dietExceptions/diet-exception-dao");
const dietDaysService = require("../dietDays/diet-days-service");
const userSchema = require("../users/schema");
const planChangeService = require("../planChanges/plan-change-service");
const { contentCycleDays } = require("./cycle-window");
const { resyncPlannedDays } = require("../dietDays/diet-day-resolver");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Compartida por applyPlan y createDirect: solo hace falta saber CUÁNDO
// empieza. No hay fin ni duración (una fase acaba cuando empieza otra).
function validateScheduleFields({ startDate }) {
  if (!ISO_DATE.test(startDate || "")) return "startDate inválida (YYYY-MM-DD)";
  return null;
}

const PHASE_FOCUS = ["cut", "maintain", "bulk"];

// El bloque `phase` con el que nace toda fase (objetivo elegido en el
// builder al crear el C1, o en el cajón de sugerencias). Sin él la copia es
// un plan "de siempre", sin ciclos.
function sanitizePhase(body) {
  const p = body?.phase;
  if (!p) return { phase: null };
  return {
    phase: {
      name: String(p.name || "").trim().slice(0, 100) || null,
      focus: PHASE_FOCUS.includes(p.focus) ? p.focus : null,
      targetKcalDelta: Number.isFinite(Number(p.targetKcalDelta)) ? Number(p.targetKcalDelta) : 0,
      ratePerCycle: Number.isFinite(Number(p.ratePerCycle)) ? Number(p.ratePerCycle) : 0,
      // g/kg tocados en el cajón (null = fórmula por defecto), ver
      // docs/plan-info-calculo-fase.md.
      proteinPerKg: positiveOrNull(p.proteinPerKg),
      fatPerKg: positiveOrNull(p.fatPerKg),
    },
  };
}

function positiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeChoiceCycleDays(value) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
}

// La copia congelada de DietTemplate ES la asignación (ver
// diet-template-schema.js), así que trae days/dayPatterns con todo su
// contenido de comidas — nadie en el frontend necesita eso para pintar "qué
// plan tiene este cliente y desde cuándo", solo lo engordaría. Esta
// proyección es la única que sale por la red, usada por los 3 endpoints que
// devuelven una asignación.
function toAssignmentResponse(doc, extra = {}) {
  return {
    _id: doc._id,
    clientId: doc.clientId,
    trainerId: doc.trainerId,
    startDate: doc.startDate,
    endDate: doc.endDate,
    status: doc.status,
    daysCount: (doc.days || []).length,
    // Días que dura un ciclo de ESTE doc (contenido, ver cycle-window.js).
    cycleDays: contentCycleDays(doc),
    choiceCycleDays: doc.choiceCycleDays ?? null,
    supersededBy: doc.supersededBy,
    sourceTemplateId: doc.sourceTemplateId,
    createdAt: doc.createdAt,
    planName: doc.name,
    mode: doc.mode,
    // La fase a la que pertenece este ciclo (phaseId = self en el head).
    phaseId: doc.phaseId || null,
    phaseName: doc.phaseName || null,
    phaseFocus: doc.phaseFocus || null,
    ...extra,
  };
}

module.exports = {
  // POST /trainer/clients/:clientId/nutrition-plans/:planId/apply
  // body: { startDate, phase? }
  // Crea UNA copia-asignación — no recorre días. Si el cliente ya tenía una
  // activa, esta la sustituye (encadenado de fases).
  async applyPlan(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, planId } = req.params;
    const { startDate } = req.body || {};

    const scheduleError = validateScheduleFields(req.body || {});
    if (scheduleError) return res.status(400).send({ message: scheduleError });

    const plan = await dietTemplateDao.findOwnedByTrainer(trainerId, planId);
    if (!plan) return res.status(404).send({ message: "Plan no encontrado" });

    // Fase 4 Coach Pro — la asignación que regía antes, leída ANTES de
    // aplicar: applyPlan la marca "superseded" por dentro, así que después
    // ya no se distingue de cualquier otra del histórico.
    const previousAssignment = await planAssignmentService.getActiveForClient(clientId);

    let assignment;
    try {
      assignment = await planAssignmentService.applyPlan({
        trainerId,
        clientId,
        template: plan,
        startDate,
        ...sanitizePhase(req.body),
      });
    } catch (error) {
      // 409 y no 400: la petición está bien formada, lo que falla es el
      // estado actual del cliente. El frontend necesita distinguirlo para
      // señalar las fechas en vez de dar un error genérico de formulario.
      if (error.code === "PLAN_OVERLAP") {
        return res
          .status(409)
          .send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment,
      newAssignment: assignment,
      planName: plan.name,
      reason: req.body?.reason,
    });

    await resyncPlannedDays(clientId, assignment.startDate, assignment.endDate);
    return res.status(201).send(toAssignmentResponse(assignment));
  },

  // POST /trainer/clients/:clientId/nutrition-plans
  // body: { name, days, mode, dayPatterns, choiceCycleDays?, startDate, phase? }
  // "Crear dieta" — igual que applyPlan pero sin plantilla de origen: el
  // contenido lo construye el trainer aquí mismo, directo para este cliente.
  async createDirect(req, res) {
    const trainerId = req.auth.userId;
    const { clientId } = req.params;
    const { name, days, mode, dayPatterns, choiceCycleDays, startDate } = req.body || {};

    const trimmedName = (name || "").trim();
    if (!trimmedName) return res.status(400).send({ message: "El nombre es obligatorio" });

    const scheduleError = validateScheduleFields(req.body || {});
    if (scheduleError) return res.status(400).send({ message: scheduleError });

    const previousAssignment = await planAssignmentService.getActiveForClient(clientId);

    let assignment;
    try {
      assignment = await planAssignmentService.createDirectPlan({
        trainerId,
        clientId,
        name: trimmedName,
        days: sanitizeDays(days),
        mode: sanitizeMode(mode),
        dayPatterns: sanitizeDayPatterns(dayPatterns),
        choiceCycleDays: sanitizeChoiceCycleDays(choiceCycleDays),
        startDate,
        ...sanitizePhase(req.body),
      });
    } catch (error) {
      if (error.code === "PLAN_OVERLAP") {
        return res
          .status(409)
          .send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment,
      newAssignment: assignment,
      planName: assignment.name,
      reason: req.body?.reason,
    });

    await resyncPlannedDays(clientId, assignment.startDate, assignment.endDate);
    return res.status(201).send(toAssignmentResponse(assignment));
  },

  // GET /trainer/clients/:clientId/nutrition-plans/active
  // TASK-044 (MASTER_BACKLOG.md) — expone `mode` y, solo para planes
  // "choice", `stuckDaysCount`: cuántos días desde que empezó a regir esta
  // asignación el cliente nunca eligió menú (DietDay.dayTypeName sigue
  // null). Antes de esto no había ninguna forma de que el trainer se
  // enterase de un plan "choice" atascado.
  async getActive(req, res) {
    const assignment = await planAssignmentService.getActiveForClient(req.params.clientId);
    if (!assignment) return res.send(null);

    let stuckDaysCount = null;
    if (assignment.mode === "choice") {
      {
        stuckDaysCount = await dietDaysService.countDaysWithoutChoice(
          assignment.clientId,
          assignment.startDate,
          todayIsoDate()
        );
      }
    }

    // F20-quinquies — qué días de la semana cubre este plan "recurring",
    // para pintar las píldoras L/M/X/J/V/S/D en la ficha del cliente. Unión
    // de CADA dayPattern por separado (no solo la unión): un plan puede
    // tener un patrón para Lun/Mié/Sáb y otro distinto para Mar/Dom, y en
    // la ficha del cliente interesa distinguir cuál cubre cuáles días, no
    // solo "qué días tienen algo pautado" (ver TASK del 2026-08-24,
    // "si tiene varios patrones habría que indicarlos").
    const recurringPatterns =
      assignment.mode === "recurring"
        ? (assignment.dayPatterns || [])
            .filter((p) => (p.appliesTo || []).length)
            .map((p) => ({ name: p.name, appliesTo: [...(p.appliesTo || [])].sort() }))
        : null;

    return res.send(toAssignmentResponse(assignment, { stuckDaysCount, recurringPatterns }));
  },

  // GET /trainer/clients/:clientId/nutrition-plans/:planId
  // Editor de fase/ciclo ya asignado — contenido completo (days/dayPatterns)
  // de ESTA copia, para precargar el builder. Distinto de getActive/getHistory
  // (toAssignmentResponse), que solo devuelven el resumen para listas.
  async getPlanContent(req, res) {
    const { clientId, planId } = req.params;
    const plan = await planAssignmentService.getPlanContent(req.auth.userId, clientId, planId);
    if (!plan) return res.status(404).send({ message: "Plan no encontrado" });
    return res.send(plan);
  },

  // PUT /trainer/clients/:clientId/nutrition-plans/:planId
  // body: { name?, mode?, days?, dayPatterns? } — mismo shape "clipboard" que
  // PUT /trainer/diet-templates/:id, pero editando la copia de ESTE cliente,
  // nunca una plantilla de biblioteca. Funciona igual para el ciclo 1 que
  // para cualquier ciclo posterior (sin sourceTemplateId).
  async updateContent(req, res) {
    const { clientId, planId } = req.params;
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
      patch.name = name;
    }
    if (req.body?.mode !== undefined) patch.mode = sanitizeMode(req.body.mode);
    if (req.body?.days !== undefined) patch.days = sanitizeDays(req.body.days);
    if (req.body?.dayPatterns !== undefined) patch.dayPatterns = sanitizeDayPatterns(req.body.dayPatterns);
    if (req.body?.choiceCycleDays !== undefined) patch.choiceCycleDays = sanitizeChoiceCycleDays(req.body.choiceCycleDays);

    const plan = await planAssignmentService.updateAssignmentContent({
      trainerId: req.auth.userId,
      clientId,
      planId,
      ...patch,
    });
    if (!plan) return res.status(404).send({ message: "Plan no encontrado" });
    // Los días que el cliente ya tenía abiertos dentro de este ciclo recogen
    // la edición (ver diet-day-resolver.js#resyncPlannedDays).
    await resyncPlannedDays(clientId, plan.startDate, plan.endDate);
    return res.send(plan);
  },

  // GET /trainer/clients/:clientId/nutrition-history
  // Feed de eventos (fases, ciclos, check-ins, excepciones) para el bloque
  // "Historial de nutrición" de la ficha. Ver nutrition-history.js.
  async getNutritionHistory(req, res) {
    return res.send(await planAssignmentService.getNutritionHistory(req.params.clientId));
  },

  // GET /trainer/clients/:clientId/nutrition-plans/history
  // TASK-045 (MASTER_BACKLOG.md) — este endpoint ya existía completo pero
  // sin consumidor en el frontend (mismo patrón que TASK-020/historial de
  // ejercicio).
  async getHistory(req, res) {
    const assignments = await planAssignmentService.listForClient(req.params.clientId);
    return res.send(assignments.map((a) => toAssignmentResponse(a)));
  },

  // DELETE /trainer/clients/:clientId/nutrition-plans/:planId
  // Mismo generalizado que routineAssignmentController#cancelPhase para
  // entrenamiento: "me he equivocado" / el cliente cambia de objetivo, quitar
  // CUALQUIER fase (futura, pasada/sustituida, o la vigente ahora mismo). Si
  // era el tip de la cadena, la que queda más reciente se reactiva sola (ver
  // service) — el cliente nunca se queda sin ninguna fase "active" salvo que
  // fuera la primera de su historia.
  async cancelPhase(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, planId } = req.params;

    let result;
    try {
      result = await planAssignmentService.cancelPhase(clientId, planId);
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }

    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment: result.cancelled,
      newAssignment: result.newTip,
      planName: result.newTip?.name,
      reason: req.body?.reason,
    });

    return res.status(204).send();
  },

  // POST /trainer/clients/:clientId/diet-exceptions
  // body: { date, mealSlot?, action: "override"|"skip", override? }
  async createException(req, res) {
    const { clientId } = req.params;
    const { date, mealSlot, action, override } = req.body || {};

    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "date inválida (YYYY-MM-DD)" });
    }
    if (!["override", "skip"].includes(action)) {
      return res.status(400).send({ message: "action debe ser override o skip" });
    }

    const assignment = await planAssignmentService.findCoveringDate(clientId, date);
    if (!assignment) {
      return res.status(400).send({ message: "Este cliente no tiene un plan activo en esa fecha" });
    }

    const exception = await dietExceptionDao.create({
      assignmentId: assignment._id,
      clientId,
      date,
      mealSlot: mealSlot || null,
      action,
      override: action === "override" ? override : undefined,
    });

    return res.status(201).send(exception);
  },

  // --- Ciclos por contenido (docs/plan-ciclos-por-contenido.md) ---

  // GET /trainer/clients/:clientId/nutrition-phases/:phaseId/cycles
  async getPhaseCycles(req, res) {
    const { clientId, phaseId } = req.params;
    try {
      return res.send(await planAssignmentService.getPhaseCycles(clientId, phaseId));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // GET /trainer/clients/:clientId/nutrition-phases/:phaseId/cycles/:number/need
  // Cómo se calculó la necesidad de ese ciclo (docs/plan-info-calculo-fase.md).
  async getCycleNeed(req, res) {
    const { clientId, phaseId, number } = req.params;
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).send({ message: "Número de ciclo inválido" });
    }
    try {
      return res.send(await planAssignmentService.getCycleNeed(clientId, phaseId, n));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND" || error.code === "DIET_CYCLE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // POST /trainer/clients/:clientId/nutrition-phases/:phaseId/cycles/next/scale
  // body: { kcal } → contenido del ciclo vigente escalado a esas kcal, para
  // abrir el builder precargado. No escribe nada.
  async scaleNextCycle(req, res) {
    const { clientId, phaseId } = req.params;
    const kcal = Number(req.body?.kcal);
    if (!Number.isFinite(kcal) || kcal <= 0) return res.status(400).send({ message: "kcal debe ser mayor que 0" });
    try {
      return res.send(await planAssignmentService.scaleNextCycle(clientId, phaseId, kcal));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // PUT /trainer/clients/:clientId/nutrition-phases/:phaseId/cycles/next
  // body: { mode?, days?, dayPatterns?, choiceCycleDays? }
  // Sin startDate a propósito: la fecha la decide el servidor (inicio del
  // ciclo siguiente). 204 = el contenido no cambia nada, no se persiste.
  async prepareNextCycle(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, phaseId } = req.params;
    const b = req.body || {};

    const hasContent =
      (Array.isArray(b.days) && b.days.length) ||
      (Array.isArray(b.dayPatterns) && b.dayPatterns.length);
    if (!hasContent) {
      return res.status(400).send({ message: "El ciclo necesita contenido (days o dayPatterns)" });
    }

    let result;
    try {
      result = await planAssignmentService.prepareNextCycle({
        trainerId,
        clientId,
        phaseId,
        mode: sanitizeMode(b.mode),
        days: sanitizeDays(b.days),
        dayPatterns: sanitizeDayPatterns(b.dayPatterns),
        choiceCycleDays: sanitizeChoiceCycleDays(b.choiceCycleDays),
      });
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      if (error.code === "PLAN_OVERLAP") {
        return res.status(409).send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    if (result.unchanged) return res.status(204).send();
    await resyncPlannedDays(clientId, result.cycle.startDate, result.cycle.endDate);
    return res.send(toAssignmentResponse(result.cycle));
  },

  // DELETE /trainer/clients/:clientId/nutrition-phases/:phaseId/cycles/next
  async discardNextCycle(req, res) {
    const { clientId, phaseId } = req.params;
    try {
      await planAssignmentService.discardNextCycle(clientId, phaseId);
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
    return res.status(204).send();
  },

  // GET /trainer/clients/:clientId/diet-timeline?from&to
  async getCycleTimeline(req, res) {
    const { clientId } = req.params;
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from y to (YYYY-MM-DD) son obligatorios" });
    }
    return res.send(await planAssignmentService.getCycleTimeline(clientId, from, to));
  },
};
