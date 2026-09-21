const planAssignmentService = require("./plan-assignment-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { sanitizeMenus } = require("../dietTemplates/diet-template-controller");
const { markDaySkipped } = require("../dietDays/diet-skips");
const dietDaysService = require("../dietDays/diet-days-service");
const userSchema = require("../users/schema");
const planChangeService = require("../planChanges/plan-change-service");
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

// El bloque `phase` con el que nace toda fase: su nombre y el objetivo con
// el que se pauta (kcal y macros, calculados del cliente o tecleados a mano
// en el cajón). Sin él la copia es un plan suelto, sin semanas.
function sanitizePhase(body) {
  const p = body?.phase;
  if (!p) return { phase: null };
  const target = sanitizePhaseTarget(p.target);
  return {
    phase: {
      name: String(p.name || "").trim().slice(0, 100) || null,
      target,
      // g/kg tocados en el cajón (null = fórmula por defecto).
      proteinPerKg: positiveOrNull(p.proteinPerKg),
      fatPerKg: positiveOrNull(p.fatPerKg),
    },
  };
}

function sanitizePhaseTarget(target) {
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

function positiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// La copia congelada de DietTemplate ES la asignación (ver
// diet-template-schema.js), así que trae los menús con todo su
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
    menusCount: (doc.menus || []).length,
    supersededBy: doc.supersededBy,
    sourceTemplateId: doc.sourceTemplateId,
    createdAt: doc.createdAt,
    planName: doc.name,
    // La fase a la que pertenece este contenido (phaseId = self en el head).
    phaseId: doc.phaseId || null,
    phaseName: doc.phaseName || null,
    phaseTarget: doc.phaseTarget || null,
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
  // body: { name, menus, startDate, phase? }
  // "Crear dieta" — igual que applyPlan pero sin plantilla de origen: el
  // contenido lo construye el trainer aquí mismo, directo para este cliente.
  async createDirect(req, res) {
    const trainerId = req.auth.userId;
    const { clientId } = req.params;
    const { name, menus, startDate } = req.body || {};

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
        menus: sanitizeMenus(menus),
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
  // TASK-044 (MASTER_BACKLOG.md) — `stuckDaysCount`: cuántos días desde que
  // empezó a regir esta asignación el cliente nunca eligió menú
  // (DietDay.menuName sigue null). Sin esto el trainer no tiene forma de
  // enterarse de un plan atascado porque el cliente no elige.
  async getActive(req, res) {
    const assignment = await planAssignmentService.getActiveForClient(req.params.clientId);
    if (!assignment) return res.send(null);

    const stuckDaysCount = await dietDaysService.countDaysWithoutChoice(
      assignment.clientId,
      assignment.startDate,
      todayIsoDate()
    );

    return res.send(toAssignmentResponse(assignment, { stuckDaysCount }));
  },

  // GET /trainer/clients/:clientId/nutrition-plans/:planId
  // Editor de fase/semana ya asignada — contenido completo (menus)
  // de ESTA copia, para precargar el builder. Distinto de getActive/getHistory
  // (toAssignmentResponse), que solo devuelven el resumen para listas.
  async getPlanContent(req, res) {
    const { clientId, planId } = req.params;
    const plan = await planAssignmentService.getPlanContent(req.auth.userId, clientId, planId);
    if (!plan) return res.status(404).send({ message: "Plan no encontrado" });
    return res.send(plan);
  },

  // PUT /trainer/clients/:clientId/nutrition-plans/:planId
  // body: { name?, menus? } — mismo shape "clipboard" que
  // PUT /trainer/diet-templates/:id, pero editando la copia de ESTE cliente,
  // nunca una plantilla de biblioteca. Funciona igual para el contenido
  // inicial que para cualquier semana posterior (sin sourceTemplateId).
  async updateContent(req, res) {
    const { clientId, planId } = req.params;
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
      patch.name = name;
    }
    if (req.body?.menus !== undefined) patch.menus = sanitizeMenus(req.body.menus);

    const plan = await planAssignmentService.updateAssignmentContent({
      trainerId: req.auth.userId,
      clientId,
      planId,
      ...patch,
    });
    if (!plan) return res.status(404).send({ message: "Plan no encontrado" });
    // Los días que el cliente ya tenía abiertos dentro de esta semana recogen
    // la edición (ver diet-day-resolver.js#resyncPlannedDays).
    await resyncPlannedDays(clientId, plan.startDate, plan.endDate);
    return res.send(plan);
  },

  // GET /trainer/clients/:clientId/nutrition-history
  // Feed de eventos (fases, semanas, check-ins, excepciones) para el bloque
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

  // POST /trainer/clients/:clientId/skipped-days
  // body: { date } — ese día el cliente no sigue el plan: se vacía de lo
  // pautado y deja de contar. Lo que el cliente anotó por su cuenta se
  // queda (es su registro, no del plan).
  async markSkippedDay(req, res) {
    const { clientId } = req.params;
    const { date } = req.body || {};

    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "date inválida (YYYY-MM-DD)" });
    }

    const assignment = await planAssignmentService.findCoveringDate(clientId, date);
    if (!assignment) {
      return res.status(400).send({ message: "Este cliente no tiene un plan activo en esa fecha" });
    }

    const skipped = await markDaySkipped(clientId, date);
    if (!skipped) return res.status(404).send({ message: "No hay día registrado en esa fecha" });
    return res.status(201).send(skipped);
  },

  // --- Semanas (docs/plan-semanas.md) ---

  // GET /trainer/clients/:clientId/nutrition-phases/:phaseId/weeks
  async getPhaseWeeks(req, res) {
    const { clientId, phaseId } = req.params;
    try {
      return res.send(await planAssignmentService.getPhaseWeeks(clientId, phaseId));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // GET /trainer/clients/:clientId/nutrition-phases/:phaseId/weeks/:number/need
  // Cómo se calculó la necesidad del cliente en esa semana.
  async getWeekNeed(req, res) {
    const { clientId, phaseId, number } = req.params;
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).send({ message: "Número de semana inválido" });
    }
    try {
      return res.send(await planAssignmentService.getWeekNeed(clientId, phaseId, n));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND" || error.code === "DIET_WEEK_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // POST /trainer/clients/:clientId/nutrition-phases/:phaseId/weeks/next/scale
  // body: { kcal } → contenido vigente escalado a esas kcal, para abrir el
  // builder precargado. No escribe nada.
  async scaleNextWeek(req, res) {
    const { clientId, phaseId } = req.params;
    const kcal = Number(req.body?.kcal);
    if (!Number.isFinite(kcal) || kcal <= 0) return res.status(400).send({ message: "kcal debe ser mayor que 0" });
    try {
      return res.send(await planAssignmentService.scaleNextWeek(clientId, phaseId, kcal));
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND" || error.code === "DIET_NO_NEXT_WEEK") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
  },

  // PUT /trainer/clients/:clientId/nutrition-phases/:phaseId/weeks/next
  // body: { menus }
  // Sin startDate a propósito: la fecha es el lunes en que empieza la
  // semana. 204 = el contenido no cambia nada, no se persiste.
  async prepareNextWeek(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, phaseId } = req.params;
    const b = req.body || {};

    if (!Array.isArray(b.menus) || !b.menus.length) {
      return res.status(400).send({ message: "La semana necesita al menos un menú" });
    }

    let result;
    try {
      result = await planAssignmentService.prepareNextWeek({
        trainerId,
        clientId,
        phaseId,
        menus: sanitizeMenus(b.menus),
      });
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND" || error.code === "DIET_NO_NEXT_WEEK") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      if (error.code === "PLAN_OVERLAP") {
        return res.status(409).send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    if (result.unchanged) return res.status(204).send();
    await resyncPlannedDays(clientId, result.week.startDate, result.week.endDate);
    return res.send(toAssignmentResponse(result.week));
  },

  // DELETE /trainer/clients/:clientId/nutrition-phases/:phaseId/weeks/next
  async discardNextWeek(req, res) {
    const { clientId, phaseId } = req.params;
    try {
      await planAssignmentService.discardNextWeek(clientId, phaseId);
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }
    return res.status(204).send();
  },

  // PATCH /trainer/clients/:clientId/nutrition-phases/:phaseId/dates
  // body: { startDate?, endDate? } — corregir cuándo empieza y acaba una
  // fase ya aplicada, sin pisar otra.
  async updatePhaseDates(req, res) {
    const { clientId, phaseId } = req.params;
    const { startDate, endDate } = req.body || {};
    if (startDate !== undefined && !ISO_DATE.test(startDate || "")) {
      return res.status(400).send({ message: "startDate inválida (YYYY-MM-DD)" });
    }
    if (endDate !== undefined && endDate !== null && !ISO_DATE.test(endDate || "")) {
      return res.status(400).send({ message: "endDate inválida (YYYY-MM-DD)" });
    }

    let phase;
    try {
      phase = await planAssignmentService.updatePhaseDates({ clientId, phaseId, startDate, endDate });
    } catch (error) {
      if (error.code === "DIET_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      if (error.code === "PLAN_OVERLAP" || error.code === "PLAN_INVALID_RANGE") {
        return res.status(409).send({ message: error.message, code: error.code });
      }
      throw error;
    }
    await resyncPlannedDays(clientId, phase.startDate, phase.endDate);
    return res.send(toAssignmentResponse(phase));
  },

  // GET /trainer/clients/:clientId/diet-timeline?from&to
  async getDietTimeline(req, res) {
    const { clientId } = req.params;
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from y to (YYYY-MM-DD) son obligatorios" });
    }
    return res.send(await planAssignmentService.getDietTimeline(clientId, from, to));
  },
};
