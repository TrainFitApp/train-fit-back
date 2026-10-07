const routineAssignmentDao = require("./routine-assignment-dao");
const tableDao = require("../tables/table-dao");
const planChangeService = require("../planChanges/plan-change-service");
const { projectionAcrossAssignments, getProjectedPhaseEndDate } = require("./routine-assignment-projection");
const { withStates } = require("../util/phase-chain");
const { todayForUser } = require("../users/user-time-zone");
const { badRequest, conflict, notFound } = require("../util/http-error");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Fases de rutina de un cliente. "Hoy" es el del CLIENTE (su zona horaria):
// una fase empieza o rige según su calendario. Ninguna operación toca la
// rutina en uso del cliente: se calcula (routine-in-use.js), así que crear,
// mover o quitar una fase no deja nada que sincronizar.

const phaseNotFound = () => notFound("Fase no encontrada", "ROUTINE_PHASE_NOT_FOUND");
const plain = (doc) => (typeof doc?.toObject === "function" ? doc.toObject() : doc);

function assertIsoDate(value, field) {
  if (!ISO_DATE.test(value || "")) throw badRequest(`${field} inválida (YYYY-MM-DD)`);
}

async function tablesById(assignments) {
  const tableIds = [...new Set(assignments.map((a) => String(a.tableId)))];
  const tables = await Promise.all(tableIds.map((id) => tableDao.getTableById(id)));
  return new Map(tables.filter(Boolean).map((t) => [String(t._id), t]));
}

// Historial de cambios del cliente: qué rutina regía y cuál rige, con la
// fecha de la fase (vive en la fase, no en la rutina).
async function recordChange({ trainerId, clientId, before, after, reason }) {
  const [beforeTable, afterTable] = await Promise.all([
    before ? tableDao.getTableById(before.tableId) : null,
    after ? tableDao.getTableById(after.tableId) : null,
  ]);
  if (!beforeTable && !afterTable) return;
  await planChangeService.recordRoutineChange({
    trainerId,
    clientId,
    previousTable: beforeTable ? { ...plain(beforeTable), startDate: before.startDate } : null,
    newTable: afterTable ? { ...plain(afterTable), startDate: after.startDate } : null,
    reason,
  });
}

// Una fase nueva en `startDate` no puede quedar por delante de otra que ya
// empieza más tarde: la dejaría huérfana en medio de la cadena. Una en curso
// o del pasado nunca bloquea: la nueva la sustituye.
async function assertFitsInChain(clientId, startDate, options) {
  const [clash] = await routineAssignmentDao.findStartingAfter(clientId, startDate, options);
  if (clash) {
    throw conflict(`Esa fecha se solapa con otra fase ya programada (${clash.startDate})`, "ROUTINE_OVERLAP", {
      conflict: { startDate: clash.startDate, tableId: clash.tableId },
    });
  }
}

module.exports = {
  // Aplicar una rutina y programar la siguiente fase son la MISMA operación:
  // la fase nueva sustituye a la anterior desde su fecha.
  async applyRoutine({ trainerId, clientId, tableId, startDate, reason }) {
    assertIsoDate(startDate, "startDate");
    const table = await tableDao.getTableByIdAndUserId(tableId, clientId);
    if (!table) throw notFound("Rutina no encontrada para este cliente");
    // La última de la cadena ANTES de aplicar: es la que la nueva sustituye.
    const previous = await routineAssignmentDao.findLatest(clientId);
    await assertFitsInChain(clientId, startDate);
    const assignment = await routineAssignmentDao.create({ tableId, clientId, trainerId, startDate });
    await recordChange({ trainerId, clientId, before: previous, after: assignment, reason });
    return assignment;
  },

  // Todas las fases, de la más reciente a la más antigua, con su estado hoy
  // ("scheduled" | "current" | "past", util/phase-chain.js), el nombre de la
  // rutina y su fin previsto.
  async history(clientId) {
    const [assignments, today] = await Promise.all([routineAssignmentDao.listByClient(clientId), todayForUser(clientId)]);
    const tableById = await tablesById(assignments);
    return withStates(assignments, today).map(({ phase, state }) => {
      const table = tableById.get(String(phase.tableId));
      return {
        ...plain(phase),
        state,
        tableName: table?.name || null,
        estimatedEndDate: table ? getProjectedPhaseEndDate(phase.startDate, table.splits) : null,
      };
    });
  },

  // Lo previsto sobre un rango del calendario: cada día con la sesión que
  // toca según la fase que lo gobierna (una fase futura no tapa los días que
  // sigue rigiendo la anterior, ver projectionAcrossAssignments).
  async schedule(clientId, from, to) {
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    const assignments = await routineAssignmentDao.listByClient(clientId);
    if (!assignments.length) return [];
    return projectionAcrossAssignments(assignments, await tablesById(assignments), from, to);
  },

  async listForClient(clientId) {
    return routineAssignmentDao.listByClient(clientId);
  },

  async findCoveringDate(clientId, date) {
    return routineAssignmentDao.findCoveringDate(clientId, date);
  },

  // "Me he equivocado" / "el cliente se ha lesionado": quitar CUALQUIER fase
  // (futura, pasada o la vigente). Si regía hoy, vuelve a regir la anterior
  // (`restored`), sin escribir nada más.
  async cancelPhase({ trainerId, clientId, assignmentId, reason }) {
    const assignment = await routineAssignmentDao.findByIdAndClient(assignmentId, clientId);
    if (!assignment) throw phaseNotFound();

    const today = await todayForUser(clientId);
    const covering = await routineAssignmentDao.findCoveringDate(clientId, today);
    await routineAssignmentDao.deleteById(assignment._id);
    const wasCurrent = Boolean(covering) && String(covering._id) === String(assignment._id);
    const restored = wasCurrent ? await routineAssignmentDao.findCoveringDate(clientId, today) : null;
    await recordChange({ trainerId, clientId, before: assignment, after: restored, reason });
    return { cancelled: assignment, restored, wasCurrent };
  },

  // Antes de borrar una rutina: fuera sus fases (una rutina se puede asignar
  // más de una vez). Lo que rija después sale solo del orden.
  async removeAssignmentsForTable(clientId, tableId) {
    return routineAssignmentDao.deleteByTableAndClient(tableId, clientId);
  },

  // Mover la fecha de una fase PROGRAMADA (aún no en curso), p. ej. para
  // alargar la rutina actual. Una que ya rige se cambia aplicando otra
  // encima, nunca reescribiendo su fecha.
  async rescheduleScheduledPhase({ trainerId, clientId, assignmentId, startDate, reason }) {
    assertIsoDate(startDate, "startDate");
    const assignment = await routineAssignmentDao.findByIdAndClient(assignmentId, clientId);
    if (!assignment) throw phaseNotFound();
    const today = await todayForUser(clientId);
    if (assignment.startDate <= today) {
      throw badRequest("No se puede modificar una fase que ya ha empezado", "ROUTINE_PHASE_ALREADY_STARTED");
    }
    if (startDate < today) throw badRequest("La fecha no puede ser anterior a hoy", "ROUTINE_START_IN_PAST");
    await assertFitsInChain(clientId, startDate, { excludeId: assignmentId });

    const updated = await routineAssignmentDao.updateStartDate(assignmentId, startDate);
    await recordChange({ trainerId, clientId, before: assignment, after: updated, reason });
    return updated;
  },
};
