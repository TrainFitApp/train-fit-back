const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { computeEndDate } = require("../util/period-util");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { expectedWeeklyRateKg } = require("../nutritionalGoals/nutrition-target");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const { suggestNextCycle, scaleFactor } = require("./cycle-progression");
const { daysElapsed, isoDate } = require("../util/date-util");

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/**
 * ¿Esta fase existente impide colocar una nueva que empieza en `startDate`?
 *
 * Solapar NO basta para bloquear: la fase abierta (endDate null) que ya
 * venía corriendo es el caso normal de "le cambio el plan a partir de hoy",
 * y se resuelve cortándola. Lo que se rechaza es pisar una fase con fechas
 * cerradas, o una abierta que empieza MÁS ADELANTE que la nueva.
 */
function blocksNewPhase(existing, startDate) {
  // `== null` y no `=== null`: una asignación siempre escribe endDate
  // explícito (null = indefinido), pero el schema ya no pone default, así
  // que un documento sin la clave significa lo mismo — "sin fecha de fin" —
  // y debe leerse igual.
  const abiertaYaEnCurso = existing.endDate == null && existing.startDate <= startDate;
  return !abiertaYaEnCurso;
}

// Compartido por applyPlan (clona una plantilla) y createDirectPlan (crea
// contenido nuevo) — la validación de solape y "quién regía antes" no
// depende de dónde salió el contenido, solo de las fechas. Se lee la fase
// activa ANTES de crear la nueva: en cuanto exista, ambas tendrían status
// "active" a la vez y un findOne sin ordenar ya no podría distinguir con
// garantías cuál es "la anterior".
async function reserveActivePhaseSlot(clientId, startDate, endDate) {
  const solapadas = await dietTemplateDao.findOverlapping(clientId, startDate, endDate);
  const bloqueantes = solapadas.filter((fase) => blocksNewPhase(fase, startDate));
  if (bloqueantes.length) {
    const choque = bloqueantes[0];
    const error = new Error(
      `Esas fechas se solapan con otra fase (${choque.startDate} → ${choque.endDate || "indefinido"})`
    );
    error.code = "PLAN_OVERLAP";
    error.conflict = {
      startDate: choque.startDate,
      endDate: choque.endDate,
      planId: choque._id,
    };
    throw error;
  }
  return dietTemplateDao.findActiveForClient(clientId);
}

async function chainIfNeeded(previousActive, created) {
  if (previousActive && String(previousActive._id) !== String(created._id)) {
    await dietTemplateDao.markSuperseded(previousActive._id, created._id);
  }
}

module.exports = {
  // Exportada para test unitario: es la regla con criterio propio.
  blocksNewPhase,
  computeEndDate,

  // Crea la copia congelada (que ES la asignación, ver diet-template-schema.js)
  // y, si el cliente ya tenía una activa, la encadena (supersededBy) — así
  // "aplicar un plan nuevo" y "programar la siguiente fase" son la MISMA
  // operación, sin perder el historial de la anterior.
  async applyPlan({
    trainerId,
    clientId,
    template,
    startDate,
    endMode,
    fixedEndDate,
    durationValue,
    durationUnit,
    // Sugerencias de dieta — presentes solo cuando se empieza una FASE desde
    // el cajón: { name, focus, targetKcalDelta, ratePerCycle } y el objetivo
    // resuelto del ciclo 1 { kcal, macros }.
    phase = null,
    cycleTarget = null,
  }) {
    const endDate = computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit });
    const previousActive = await reserveActivePhaseSlot(clientId, startDate, endDate);

    // Nunca se asigna la plantilla en sí — se congela una copia exclusiva de
    // esta asignación (mismo criterio que aplicar una plantilla de rutina a
    // un split, ver workoutTemplateDao#applyToSplit), en una sola escritura:
    // la copia ES la asignación, así que ya no hay un segundo documento que
    // pueda quedar huérfano si algo falla a medias.
    const created = await dietTemplateDao.cloneForAssignment(template, clientId, {
      startDate,
      endMode,
      endDate,
      status: "active",
      phase,
      cycleTarget,
    });

    await chainIfNeeded(previousActive, created);
    if (phase && cycleTarget) {
      await nutritionalGoalService.assignToClient({
        clientId,
        trainerId,
        kcal: cycleTarget.kcal,
        macros: cycleTarget.macros || {},
        phaseId: created._id,
        cycleId: created._id,
        startDate,
        name: phase.name ? `${phase.name} · ciclo 1` : "Objetivo de la fase",
      });
    }
    return created;
  },

  // "Crear dieta" — mismo flujo que applyPlan (valida solape, encadena la
  // fase anterior) pero el contenido no sale de clonar una plantilla: lo
  // construye el trainer directo para este cliente. Sin plantilla de
  // origen, así que la copia nace con sourceTemplateId: null — estado
  // válido, no una plantilla borrada (ver diet-template-schema.js).
  async createDirectPlan({
    trainerId,
    clientId,
    name,
    days,
    mode,
    dayPatterns,
    startDate,
    endMode,
    fixedEndDate,
    durationValue,
    durationUnit,
    phase = null,
    cycleTarget = null,
  }) {
    const endDate = computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit });
    const previousActive = await reserveActivePhaseSlot(clientId, startDate, endDate);

    const created = await dietTemplateDao.createDirectAssignment(trainerId, clientId, name, days, mode, dayPatterns, {
      startDate,
      endMode,
      endDate,
      status: "active",
      phase,
      cycleTarget,
    });

    await chainIfNeeded(previousActive, created);
    if (phase && cycleTarget) {
      await nutritionalGoalService.assignToClient({
        clientId,
        trainerId,
        kcal: cycleTarget.kcal,
        macros: cycleTarget.macros || {},
        phaseId: created._id,
        cycleId: created._id,
        startDate,
        name: phase.name ? `${phase.name} · ciclo 1` : "Objetivo de la fase",
      });
    }
    return created;
  },

  // --- Progresión ciclo a ciclo (flujo B) ---

  // Sugerencia del siguiente ciclo de una fase: mira la tendencia de peso
  // desde el inicio del ciclo actual y la adherencia de la fase, y devuelve
  // un borrador (contenido escalado + kcal/macros objetivo + motivo). NO
  // aplica nada.
  async buildNextCycleSuggestion(clientId, phaseId) {
    const head = await dietTemplateDao.findPhaseHead(phaseId);
    if (!head) {
      const e = new Error("Fase no encontrada");
      e.code = "DIET_PHASE_NOT_FOUND";
      throw e;
    }
    const cycles = await dietTemplateDao.findCyclesOfPhase(phaseId);
    const current = cycles[cycles.length - 1] || head;

    const today = isoDate(new Date());
    const cycleStart = current.startDate || head.startDate || today;

    const weights = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(
      clientId,
      cycleStart,
      today
    );
    const withWeight = weights.filter((w) => Number.isFinite(w.weight)).sort((a, b) => a.date.localeCompare(b.date));
    const weightStartKg = withWeight.length ? withWeight[0].weight : null;
    const weightEndKg = withWeight.length ? withWeight[withWeight.length - 1].weight : null;
    const spanDays = withWeight.length > 1
      ? daysElapsed(withWeight[0].date, withWeight[withWeight.length - 1].date)
      : daysElapsed(cycleStart, today);

    let adherencePct = null;
    try {
      const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, head.startDate || cycleStart, today);
      const phaseDayCount = Math.max(1, daysElapsed(head.startDate || cycleStart, today));
      adherencePct = computeRangeAdherence(days, phaseDayCount).percentage;
    } catch {
      adherencePct = null;
    }

    const suggestion = suggestNextCycle({
      previousCycleKcal: current.cycleTargetKcal,
      weightStartKg,
      weightEndKg,
      daysElapsed: spanDays,
      expectedWeeklyRateKg: expectedWeeklyRateKg(head.phaseTargetKcalDelta || 0),
      adherencePct,
      targetRatePerCycle: head.targetRatePerCycle || 0,
    });

    const factor = scaleFactor(current.cycleTargetKcal, suggestion.nextCycleKcal);
    const draftContent = dietTemplateDao.scaledCycleContent(current, factor);
    const prevMacros = current.cycleTargetMacros || {};
    const nextMacros = {
      protein: round1((prevMacros.protein || 0) * factor),
      carbs: round1((prevMacros.carbs || 0) * factor),
      fat: round1((prevMacros.fat || 0) * factor),
    };

    return {
      phaseId: String(phaseId),
      phaseName: head.phaseName,
      currentCycleId: String(current._id),
      currentCycleKcal: current.cycleTargetKcal,
      weightStartKg,
      weightEndKg,
      suggestion,
      draft: {
        mode: draftContent.mode,
        days: draftContent.days,
        dayPatterns: draftContent.dayPatterns,
        cycleTargetKcal: suggestion.nextCycleKcal,
        cycleTargetMacros: nextMacros,
      },
    };
  },

  // Confirmar un ciclo nuevo (posiblemente editado por el entrenador respecto
  // al borrador). Crea la copia, la encadena, y crea su objetivo.
  async advanceCycle({
    trainerId,
    clientId,
    phaseId,
    startDate,
    mode,
    days,
    dayPatterns,
    cycleTargetKcal,
    cycleTargetMacros,
    name,
  }) {
    const head = await dietTemplateDao.findPhaseHead(phaseId);
    if (!head) {
      const e = new Error("Fase no encontrada");
      e.code = "DIET_PHASE_NOT_FOUND";
      throw e;
    }
    const start = startDate || isoDate(new Date());
    const previousActive = await reserveActivePhaseSlot(clientId, start, null);

    const cycleCount = (await dietTemplateDao.findCyclesOfPhase(phaseId)).length;
    const created = await dietTemplateDao.createCycle({
      trainerId,
      clientId,
      phaseId,
      name: name || `${head.phaseName || head.name} · ciclo ${cycleCount + 1}`,
      mode,
      days,
      dayPatterns,
      schedule: {
        startDate: start,
        endMode: "indefinite",
        endDate: null,
        status: "active",
        cycleTarget: { kcal: cycleTargetKcal, macros: cycleTargetMacros },
      },
    });

    await chainIfNeeded(previousActive, created);
    const goal = await nutritionalGoalService.assignToClient({
      clientId,
      trainerId,
      kcal: cycleTargetKcal,
      macros: cycleTargetMacros || {},
      phaseId,
      cycleId: created._id,
      startDate: start,
      name: `${head.phaseName || head.name} · ciclo ${cycleCount + 1}`,
    });

    return { cycle: created, goal };
  },

  async getActivePhaseId(clientId) {
    return dietTemplateDao.findActivePhaseId(clientId);
  },

  async getActiveForClient(clientId) {
    return dietTemplateDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return dietTemplateDao.listByClient(clientId);
  },

  // Borrado coherente de fases (nutrición) — "me he equivocado" / el cliente
  // cambia de objetivo: quitar CUALQUIER fase (futura, pasada/sustituida, o
  // la vigente ahora mismo).
  //
  // A diferencia de routineAssignmentService#cancelPhase, aquí solo hay UN
  // invariante que reparar, no dos: nutrición no mantiene un puntero tipo
  // `tableInUse` (existió como `dietInUse` y se retiró en el refactor de
  // 2026-09) — "qué plan rige hoy" se resuelve siempre al vuelo por fecha
  // (findCoveringDate/plan-resolver.js), así que borrar una fase nunca deja
  // ese cálculo desincronizado. Lo único que sí hay que mantener es el TIP
  // de la cadena: como mucho una fase por cliente con status "active" (la
  // última que se aplicó, sea cual sea su fecha de inicio — ver
  // applyPlan/createDirectPlan), y si la fase borrada era esa, la siguiente
  // más reciente pasa a serlo.
  async cancelPhase(clientId, planId) {
    const phase = await dietTemplateDao.findByIdAndClient(planId, clientId);
    if (!phase) {
      const error = new Error("Fase no encontrada");
      error.code = "DIET_PHASE_NOT_FOUND";
      throw error;
    }

    await dietTemplateDao.deleteById(phase._id);

    let newTip = null;
    if (phase.status === "active") {
      [newTip] = await dietTemplateDao.listByClient(clientId);
      if (newTip) await dietTemplateDao.reactivate(newTip._id);
    }

    return { cancelled: phase, newTip };
  },

  async findCoveringDate(clientId, date) {
    return dietTemplateDao.findCoveringDate(clientId, date);
  },

  // Dashboard trainer, "Requiere tu atención" — planes que caducan en los
  // próximos `days` días, con daysLeft ya calculado por asignación.
  async listEndingSoonForTrainer(trainerId, days = 7) {
    const from = new Date().toISOString().slice(0, 10);
    const toDate = new Date(`${from}T00:00:00.000Z`);
    toDate.setUTCDate(toDate.getUTCDate() + days);
    const to = toDate.toISOString().slice(0, 10);

    const assignments = await dietTemplateDao.listEndingSoonForTrainer(trainerId, from, to);
    return assignments.map((assignment) => ({
      ...assignment,
      daysLeft: Math.round(
        (new Date(`${assignment.endDate}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
          86400000
      ),
    }));
  },
};
