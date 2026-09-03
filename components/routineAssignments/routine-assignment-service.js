const routineAssignmentDao = require("./routine-assignment-dao");
const tableDao = require("../tables/table-dao");
const userSchema = require("../users/schema");

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ¿Esta fase existente impide colocar una nueva que empieza en `startDate`?
 *
 * Sin endDate, cada asignación es siempre "abierta" — el equivalente
 * permanente del caso `indefinite` de nutrición. Por eso la regla se reduce
 * a una dimensión: solo bloquea una fase YA PROGRAMADA para MÁS TARDE que
 * la nueva (la nueva la "saltaría", dejándola huérfana). Una fase en curso
 * o del pasado nunca bloquea — se resuelve sustituyéndola.
 */
function blocksNewPhase(existing, startDate) {
  return existing.startDate > startDate;
}

module.exports = {
  // Exportada para test unitario.
  blocksNewPhase,

  // Crea la asignación y, si el cliente ya tenía una activa, la encadena
  // (supersededBy) — "aplicar una rutina" y "programar la siguiente fase"
  // son la MISMA operación, sin perder el historial de la anterior.
  async applyRoutine({ trainerId, clientId, tableId, startDate }) {
    const solapadas = await routineAssignmentDao.findOverlapping(clientId, startDate);
    const bloqueantes = solapadas.filter((fase) => blocksNewPhase(fase, startDate));
    if (bloqueantes.length) {
      const choque = bloqueantes[0];
      const error = new Error(`Esa fecha se solapa con otra fase ya programada (${choque.startDate})`);
      error.code = "ROUTINE_OVERLAP";
      error.conflict = { startDate: choque.startDate, tableId: choque.tableId };
      throw error;
    }

    const created = await routineAssignmentDao.create({ tableId, clientId, trainerId, startDate });

    const previousActive = await routineAssignmentDao.findActiveForClient(clientId);
    if (previousActive && String(previousActive._id) !== String(created._id)) {
      await routineAssignmentDao.markSuperseded(previousActive._id, created._id);
    }

    // Activación inmediata: si la fase empieza hoy o antes, el puntero se
    // sincroniza ya mismo. Una fase futura se resuelve más tarde, de forma
    // perezosa (ver syncTableInUseIfDue).
    if (startDate <= isoToday()) {
      await tableDao.setTableInUseForClient(clientId, tableId);
    }

    return created;
  },

  async getActiveForClient(clientId) {
    return routineAssignmentDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return routineAssignmentDao.listByClient(clientId);
  },

  async findCoveringDate(clientId, date) {
    return routineAssignmentDao.findCoveringDate(clientId, date);
  },

  // Resuelve fases futuras cuyo startDate ya ha llegado: sin cron (mismo
  // criterio que nutrición, que tampoco tiene uno), se comprueba en el
  // punto de lectura más frecuente del trainer (getClientTables). Si la
  // asignación vigente hoy apunta a una tabla distinta de tableInUse, se
  // sincroniza aquí — nunca se sobreescribe una activación manual más
  // reciente porque siempre se compara contra la asignación que de verdad
  // rige HOY, no contra "la última creada".
  async syncTableInUseIfDue(clientId) {
    const covering = await routineAssignmentDao.findCoveringDate(clientId, isoToday());
    if (!covering) return;

    const client = await userSchema.findById(clientId).select("tableInUse").lean();
    if (String(client?.tableInUse || "") === String(covering.tableId)) return;

    await tableDao.setTableInUseForClient(clientId, covering.tableId);
  },

  // Tarea 4bis (2026-09) — "me he equivocado" / "el cliente se ha
  // lesionado y hay que replantear lo que viene": quitar una fase que
  // TODAVÍA NO ha empezado. Solo programada, nunca en curso ni pasada — una
  // fase que ya rige se cambia APLICANDO una nueva encima (preserva el
  // historial), nunca borrando lo que ya pasó.
  //
  // Si esta fase había sustituido a otra (supersededBy apuntaba a ella),
  // esa otra se reactiva: si no, el cliente se quedaría sin ninguna fase
  // "active" — un estado que el resto del sistema (findActiveForClient) no
  // espera nunca.
  async cancelScheduledPhase(clientId, assignmentId) {
    const assignment = await routineAssignmentDao.findByIdAndClient(assignmentId, clientId);
    if (!assignment) {
      const error = new Error("Fase no encontrada");
      error.code = "ROUTINE_PHASE_NOT_FOUND";
      throw error;
    }
    if (assignment.startDate <= isoToday()) {
      const error = new Error("No se puede quitar una fase que ya ha empezado");
      error.code = "ROUTINE_PHASE_ALREADY_STARTED";
      throw error;
    }

    const restored = await routineAssignmentDao.findSupersededBy(assignmentId);
    await routineAssignmentDao.deleteById(assignmentId);
    if (restored) {
      await routineAssignmentDao.reactivate(restored._id);
    }

    return { cancelled: assignment, restored: restored || null };
  },

  // Tarea 4ter (2026-09) — mover la fecha de una fase PROGRAMADA, p.ej. para
  // alargar la vigencia de la rutina en curso sin cancelar y reprogramar
  // desde cero. Mismo límite que cancelScheduledPhase: solo fases que
  // TODAVÍA no han empezado (una que ya rige se cambia aplicando una nueva
  // encima, nunca reescribiendo su fecha). El supersededBy no se toca —
  // sigue siendo la misma asignación, solo cambia cuándo entra en vigor.
  async rescheduleScheduledPhase(clientId, assignmentId, startDate) {
    const assignment = await routineAssignmentDao.findByIdAndClient(assignmentId, clientId);
    if (!assignment) {
      const error = new Error("Fase no encontrada");
      error.code = "ROUTINE_PHASE_NOT_FOUND";
      throw error;
    }
    if (assignment.startDate <= isoToday()) {
      const error = new Error("No se puede modificar una fase que ya ha empezado");
      error.code = "ROUTINE_PHASE_ALREADY_STARTED";
      throw error;
    }
    if (startDate < isoToday()) {
      const error = new Error("La fecha no puede ser anterior a hoy");
      error.code = "ROUTINE_START_IN_PAST";
      throw error;
    }

    const solapadas = await routineAssignmentDao.findOverlapping(clientId, startDate, { excludeId: assignmentId });
    const bloqueantes = solapadas.filter((fase) => blocksNewPhase(fase, startDate));
    if (bloqueantes.length) {
      const choque = bloqueantes[0];
      const error = new Error(`Esa fecha se solapa con otra fase ya programada (${choque.startDate})`);
      error.code = "ROUTINE_OVERLAP";
      error.conflict = { startDate: choque.startDate, tableId: choque.tableId };
      throw error;
    }

    const updated = await routineAssignmentDao.updateStartDate(assignmentId, startDate);
    return { before: assignment, after: updated };
  },
};
