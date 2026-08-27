const planAssignmentService = require("./plan-assignment-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const dietExceptionDao = require("../dietExceptions/diet-exception-dao");
const dietDaysService = require("../dietDays/diet-days-service");
const userSchema = require("../users/schema");
const planChangeService = require("../planChanges/plan-change-service");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  // POST /trainer/clients/:clientId/nutrition-plans/:planId/apply
  // body: { startDate, endMode: "fixedDate"|"duration"|"indefinite", fixedEndDate?, durationValue?, durationUnit? }
  // Crea UNA PlanAssignment — no recorre días. Si el cliente ya tenía una
  // asignación activa, esta la sustituye (encadenado de fases).
  async applyPlan(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, planId } = req.params;
    const { startDate, endMode, fixedEndDate, durationValue, durationUnit } = req.body || {};

    if (!ISO_DATE.test(startDate || "")) {
      return res.status(400).send({ message: "startDate inválida (YYYY-MM-DD)" });
    }
    if (!["fixedDate", "duration", "indefinite"].includes(endMode)) {
      return res.status(400).send({ message: "endMode debe ser fixedDate, duration o indefinite" });
    }
    if (endMode === "fixedDate" && !ISO_DATE.test(fixedEndDate || "")) {
      return res.status(400).send({ message: "fixedEndDate inválida (YYYY-MM-DD)" });
    }
    if (endMode === "duration" && !(Number(durationValue) > 0)) {
      return res.status(400).send({ message: "durationValue debe ser mayor que 0" });
    }

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
        planId,
        startDate,
        endMode,
        fixedEndDate,
        durationValue,
        durationUnit,
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

    return res.status(201).send(assignment);
  },

  // GET /trainer/clients/:clientId/nutrition-plans/active
  // TASK-044 (MASTER_BACKLOG.md) — expone `mode` (ya existía en el plan,
  // simplemente no viajaba) y, solo para planes "choice", `stuckDaysCount`:
  // cuántos días desde que empezó a regir esta asignación el cliente nunca
  // eligió menú (DietDay.dayTypeName sigue null). Antes de esto no había
  // ninguna forma de que el trainer se enterase de un plan "choice" atascado.
  async getActive(req, res) {
    const assignment = await planAssignmentService.getActiveForClient(req.params.clientId);
    if (!assignment) return res.send(null);

    const plan = await dietTemplateDao.findOwnedByTrainer(req.auth.userId, assignment.planId);

    let stuckDaysCount = null;
    if (plan?.mode === "choice") {
      const client = await userSchema.findById(assignment.clientId).select("dietInUse");
      if (client?.dietInUse) {
        stuckDaysCount = await dietDaysService.countDaysWithoutChoice(
          client.dietInUse,
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
      plan?.mode === "recurring"
        ? (plan.dayPatterns || [])
            .filter((p) => (p.appliesTo || []).length)
            .map((p) => ({ name: p.name, appliesTo: [...(p.appliesTo || [])].sort() }))
        : null;

    return res.send({
      ...assignment.toObject(),
      planName: plan?.name || null,
      mode: plan?.mode || null,
      stuckDaysCount,
      recurringPatterns,
    });
  },

  // GET /trainer/clients/:clientId/nutrition-plans/history
  // TASK-045 (MASTER_BACKLOG.md) — este endpoint ya existía completo pero
  // sin consumidor en el frontend (mismo patrón que TASK-020/historial de
  // ejercicio). Se aprovecha para adjuntar planName por lote — antes cada
  // asignación solo traía el planId crudo.
  async getHistory(req, res) {
    const assignments = await planAssignmentService.listForClient(req.params.clientId);
    const planIds = [...new Set(assignments.map((a) => a.planId?.toString()).filter(Boolean))];
    const plans = planIds.length
      ? await dietTemplateDao.findManyByIds(req.auth.userId, planIds)
      : [];
    const planNameById = new Map(plans.map((p) => [p._id.toString(), p.name]));

    const enriched = assignments.map((a) => ({
      ...a.toObject(),
      planName: planNameById.get(a.planId?.toString()) || null,
    }));
    return res.send(enriched);
  },

  // GET /trainer/clients/:clientId/diet-exceptions
  // TASK-045 (MASTER_BACKLOG.md) — nuevo: listado de excepciones puntuales
  // ("hoy salto la dieta", "hoy como fuera") para el historial de nutrición
  // del trainer. Antes solo se podían crear/consultar por fecha exacta.
  async listExceptions(req, res) {
    const exceptions = await dietExceptionDao.findAllForClient(req.params.clientId);
    return res.send(exceptions);
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
};
