const dietTemplateDao = require("../dietTemplates/diet-template-dao");
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
  async applyPlan({ trainerId, clientId, template, startDate, endMode, fixedEndDate, durationValue, durationUnit }) {
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
    });

    await chainIfNeeded(previousActive, created);
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
  }) {
    const endDate = computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit });
    const previousActive = await reserveActivePhaseSlot(clientId, startDate, endDate);

    const created = await dietTemplateDao.createDirectAssignment(trainerId, clientId, name, days, mode, dayPatterns, {
      startDate,
      endMode,
      endDate,
      status: "active",
    });

    await chainIfNeeded(previousActive, created);
    return created;
  },

  async getActiveForClient(clientId) {
    return dietTemplateDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return dietTemplateDao.listByClient(clientId);
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
