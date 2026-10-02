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

/**
 * Borrado coherente de fases/rutinas — repara, tras borrar UNA
 * RoutineAssignment ya cargada, las dos invariantes que el resto del
 * sistema da por hechas:
 *
 * 1. El "tip" de la cadena (status:"active" crudo en BD) — qué fase es la
 *    más recientemente aplicada, la usa applyRoutine para saber a quién
 *    marcar "superseded" la próxima vez.
 * 2. Lo que rige HOY (User.tableInUse/workoutInUse) — se calcula por
 *    FECHA (findCoveringDate), nunca por status (mismo criterio que ya
 *    usa syncTableInUseIfDue). Una fase futura ya es "active" en BD en
 *    cuanto se crea, aunque otra siga rigiendo hoy — por eso status y
 *    "qué rige hoy" pueden ser filas distintas y hay que repararlas por
 *    separado.
 *
 * Se recalcula cada invariante desde cero (por fecha / por listado
 * ordenado) en vez de seguir el puntero supersededBy a mano: seguir el
 * puntero se rompe si ya se había borrado un eslabón intermedio de la
 * cadena (el puntero acabaría apuntando a un _id inexistente).
 *
 * No comprueba pertenencia (clientId/assignmentId válidos) — eso lo hace
 * quien llama (cancelPhase, removeAssignmentsForTable).
 */
async function removeAssignmentAndReconcile(clientId, assignment) {
  const today = isoToday();
  const wasCovering = await routineAssignmentDao.findCoveringDate(clientId, today);
  const isCurrent = !!wasCovering && String(wasCovering._id) === String(assignment._id);

  await routineAssignmentDao.deleteById(assignment._id);

  // Invariante 1 (tip): solo hace falta reparar si la fase borrada lo era.
  if (assignment.status === "active") {
    const [newTip] = await routineAssignmentDao.listByClient(clientId);
    if (newTip) await routineAssignmentDao.reactivate(newTip._id);
  }

  // Invariante 2 (qué rige hoy): solo se toca si la fase borrada era la
  // vigente — borrar una fase futura o ya sustituida nunca cambia lo que
  // el cliente tiene activo ahora mismo.
  let restored = null;
  if (isCurrent) {
    restored = await routineAssignmentDao.findCoveringDate(clientId, today);
    if (restored) {
      await tableDao.setTableInUseForClient(clientId, restored.tableId);
    } else {
      await tableDao.clearTableInUseForClient(clientId);
    }
  }

  return { cancelled: assignment, restored, tableInUseChanged: isCurrent };
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
      await routineAssignmentDao.markActivated(created._id);
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
  //
  // También se llama al leer el propio perfil del cliente (/auth/me y
  // GET /users/:email): sin eso, la fase que empezaba hoy no le aparecía
  // hasta que su entrenador abría la ficha. Como eso pasa en cada arranque de
  // la app, solo se activa UNA vez cada fase (activatedAt): si después el
  // cliente cambia de rutina a mano, no se le vuelve a imponer. Las que
  // empiezan el día en que se aplican nacen ya activadas (applyRoutine).
  // Devuelve si cambió algo.
  async syncTableInUseIfDue(clientId) {
    const covering = await routineAssignmentDao.findCoveringDate(clientId, isoToday());
    if (!covering || covering.activatedAt) return false;

    await routineAssignmentDao.markActivated(covering._id);
    const client = await userSchema.findById(clientId).select("tableInUse").lean();
    if (String(client?.tableInUse || "") === String(covering.tableId)) return false;

    await tableDao.setTableInUseForClient(clientId, covering.tableId);
    return true;
  },

  // Tarea 4bis (2026-09, generalizada — borrado coherente de fases/rutinas)
  // — "me he equivocado" / "el cliente se ha lesionado y hay que replantear
  // lo que viene": quitar CUALQUIER fase (futura, pasada/sustituida, o la
  // vigente ahora mismo). Antes solo admitía fases futuras
  // (ROUTINE_PHASE_ALREADY_STARTED en cualquier otro caso) — ese guard
  // bloqueaba también fases YA sustituidas por otra más reciente, que nunca
  // deberían haber contado como "en curso" (bug real: aplicar la rutina A
  // hoy, luego la B también hoy, dejaba A imposible de quitar aunque B, no
  // A, fuera la que de verdad regía).
  async cancelPhase(clientId, assignmentId) {
    const assignment = await routineAssignmentDao.findByIdAndClient(assignmentId, clientId);
    if (!assignment) {
      const error = new Error("Fase no encontrada");
      error.code = "ROUTINE_PHASE_NOT_FOUND";
      throw error;
    }

    return removeAssignmentAndReconcile(clientId, assignment);
  },

  // Borrado coherente de fases/rutinas — la usa tables/table-service.js
  // antes de borrar una Table de verdad: limpia TODAS las fases (0, 1 o
  // varias — la misma tabla se puede reasignar más de una vez) que la
  // referenciaban para este cliente, con la MISMA lógica que quitar una
  // fase suelta. Secuencial (no Promise.all): cada borrado depende del
  // estado que deja el anterior (qué fase queda como tip / qué rige hoy).
  async removeAssignmentsForTable(clientId, tableId) {
    const assignments = await routineAssignmentDao.findByTableAndClient(tableId, clientId);
    const results = [];
    for (const assignment of assignments) {
      results.push(await removeAssignmentAndReconcile(clientId, assignment));
    }
    return results;
  },

  // Tarea 4ter (2026-09) — mover la fecha de una fase PROGRAMADA, p.ej. para
  // alargar la vigencia de la rutina en curso sin cancelar y reprogramar
  // desde cero. A diferencia de cancelPhase (generalizada para cualquier
  // fase), esta sigue limitada a fases que TODAVÍA no han empezado (una que
  // ya rige se cambia aplicando una nueva encima, nunca reescribiendo su
  // fecha). El supersededBy no se toca — sigue siendo la misma asignación,
  // solo cambia cuándo entra en vigor.
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
