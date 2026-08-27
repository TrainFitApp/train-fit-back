const planAssignmentDao = require("./plan-assignment-dao");
const { computeEndDate } = require("../util/period-util");

/**
 * ¿Esta fase existente impide colocar una nueva que empieza en `startDate`?
 *
 * Solapar NO basta para bloquear: la fase abierta (endDate null) que ya
 * venía corriendo es el caso normal de "le cambio el plan a partir de hoy",
 * y se resuelve cortándola. Lo que se rechaza es pisar una fase con fechas
 * cerradas, o una abierta que empieza MÁS ADELANTE que la nueva.
 */
function blocksNewPhase(existing, startDate) {
  const abiertaYaEnCurso = existing.endDate === null && existing.startDate <= startDate;
  return !abiertaYaEnCurso;
}

module.exports = {
  // Exportada para test unitario: es la regla con criterio propio.
  blocksNewPhase,
  computeEndDate,

  // Crea la asignación y, si el cliente ya tenía una activa, la encadena
  // (supersededBy) — así "aplicar un plan nuevo" y "programar la siguiente
  // fase" son la MISMA operación, sin perder el historial de la anterior.
  async applyPlan({ trainerId, clientId, planId, startDate, endMode, fixedEndDate, durationValue, durationUnit }) {
    const endDate = computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit });

    // Nadie validaba solapes: se podían programar dos fases sobre los
    // mismos días y el cliente acababa con dos planes rigiendo a la vez,
    // sin más síntoma que un calendario incoherente.
    //
    // La fase ABIERTA que ya está en curso es la excepción: aplicar un plan
    // nuevo encima de ella es el flujo normal ("cambio lo que está
    // haciendo"), y se resuelve cortándola (markSuperseded, más abajo). Lo
    // que se rechaza es pisar una fase con fechas cerradas o una programada
    // para más adelante.
    const solapadas = await planAssignmentDao.findOverlapping(clientId, startDate, endDate);
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
        planId: choque.planId,
      };
      throw error;
    }

    const created = await planAssignmentDao.create({
      planId,
      clientId,
      trainerId,
      startDate,
      endMode,
      endDate,
    });

    const previousActive = await planAssignmentDao.findActiveForClient(clientId);
    if (previousActive && String(previousActive._id) !== String(created._id)) {
      await planAssignmentDao.markSuperseded(previousActive._id, created._id);
    }

    return created;
  },

  async getActiveForClient(clientId) {
    return planAssignmentDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return planAssignmentDao.listByClient(clientId);
  },

  async findCoveringDate(clientId, date) {
    return planAssignmentDao.findCoveringDate(clientId, date);
  },

  // Dashboard trainer, "Requiere tu atención" — planes que caducan en los
  // próximos `days` días, con daysLeft ya calculado por asignación.
  async listEndingSoonForTrainer(trainerId, days = 7) {
    const from = new Date().toISOString().slice(0, 10);
    const toDate = new Date(`${from}T00:00:00.000Z`);
    toDate.setUTCDate(toDate.getUTCDate() + days);
    const to = toDate.toISOString().slice(0, 10);

    const assignments = await planAssignmentDao.listEndingSoonForTrainer(trainerId, from, to);
    return assignments.map((assignment) => ({
      ...assignment,
      daysLeft: Math.round(
        (new Date(`${assignment.endDate}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
          86400000
      ),
    }));
  },
};
