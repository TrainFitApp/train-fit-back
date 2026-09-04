const routineAssignmentService = require("./routine-assignment-service");
const tableService = require("../tables/table-service");
const tableDao = require("../tables/table-dao");
const planChangeService = require("../planChanges/plan-change-service");
const { projectionInRange } = require("./routine-assignment-projection");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = {
  // POST /trainer/clients/:clientId/tables/:tableId/apply
  // body: { startDate, reason? }
  // Crea UNA RoutineAssignment. Si el cliente ya tenía una activa, esta la
  // sustituye (encadenado de fases) — mismo criterio que nutrición.
  async applyRoutine(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, tableId } = req.params;
    const { startDate, reason } = req.body || {};

    if (!ISO_DATE.test(startDate || "")) {
      return res.status(400).send({ message: "startDate inválida (YYYY-MM-DD)" });
    }

    const table = await tableService.getTableForClient(tableId, clientId);
    if (!table) return res.status(404).send({ message: "Rutina no encontrada para este cliente" });

    // Tarea 4 — leída ANTES de aplicar: applyRoutine la marca "superseded"
    // por dentro, así que después ya no se distingue de cualquier otra del
    // histórico (mismo motivo que en nutrición).
    const previousAssignment = await routineAssignmentService.getActiveForClient(clientId);
    const previousTable = previousAssignment
      ? await tableService.getTableForClient(previousAssignment.tableId, clientId)
      : null;

    let assignment;
    try {
      assignment = await routineAssignmentService.applyRoutine({ trainerId, clientId, tableId, startDate });
    } catch (error) {
      if (error.code === "ROUTINE_OVERLAP") {
        return res.status(409).send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    // El diff de PlanChange (entity:"routine") ya diffea `name`; se le
    // añade `startDate` fusionando una vista — Table no tiene ese campo (
    // vive en RoutineAssignment), así que se construye aquí, no en el
    // schema. diffFields tolera campos ausentes, así que la llamada
    // existente desde activateTable (sin startDate en ninguno de los dos
    // lados) sigue funcionando sin cambios.
    await planChangeService.recordRoutineChange({
      trainerId,
      clientId,
      previousTable: previousTable
        ? { ...previousTable.toObject(), startDate: previousAssignment.startDate }
        : null,
      newTable: { ...table.toObject(), startDate: assignment.startDate },
      reason,
    });

    return res.status(201).send(assignment);
  },

  // GET /trainer/clients/:clientId/routine-assignments/active
  async getActive(req, res) {
    const assignment = await routineAssignmentService.getActiveForClient(req.params.clientId);
    if (!assignment) return res.send(null);
    const table = await tableDao.getTableById(assignment.tableId);
    return res.send({ ...assignment.toObject(), tableName: table?.name || null });
  },

  // GET /trainer/clients/:clientId/routine-assignments/history
  async getHistory(req, res) {
    const assignments = await routineAssignmentService.listForClient(req.params.clientId);
    const tableIds = [...new Set(assignments.map((a) => String(a.tableId)))];
    const tables = await Promise.all(tableIds.map((id) => tableDao.getTableById(id)));
    const nameById = new Map(tables.filter(Boolean).map((t) => [String(t._id), t.name]));

    const enriched = assignments.map((a) => ({
      ...a.toObject(),
      tableName: nameById.get(String(a.tableId)) || null,
    }));
    return res.send(enriched);
  },

  // GET /trainer/clients/:clientId/routine-assignments/active/schedule?from=&to=
  // Proyección de la rutina activa sobre un rango de calendario — para el
  // calendario de Entrenamiento (capa de "previsto", distinta de "hecho").
  async getActiveSchedule(req, res) {
    const { clientId } = req.params;
    const { from, to } = req.query;
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from/to inválidos (YYYY-MM-DD)" });
    }

    const assignment = await routineAssignmentService.getActiveForClient(clientId);
    if (!assignment) return res.send([]);

    const table = await tableDao.getTableById(assignment.tableId);
    if (!table) return res.send([]);

    return res.send(projectionInRange(assignment.startDate, table.splits, from, to));
  },

  // DELETE /trainer/clients/:clientId/routine-assignments/:assignmentId
  // Tarea 4bis (2026-09, generalizada — borrado coherente de fases/rutinas)
  // — "me he equivocado" / cliente lesionado: quitar CUALQUIER fase
  // (futura, pasada/sustituida, o la vigente ahora mismo). La fase que
  // regía antes se restaura sola (ver service) para que el cliente nunca
  // se quede sin ninguna fase "active" salvo que fuera la primera de su
  // historia, en cuyo caso tableInUse se limpia sin más.
  async cancelPhase(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, assignmentId } = req.params;

    let result;
    try {
      result = await routineAssignmentService.cancelPhase(clientId, assignmentId);
    } catch (error) {
      if (error.code === "ROUTINE_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      throw error;
    }

    const [cancelledTable, restoredTable] = await Promise.all([
      tableDao.getTableById(result.cancelled.tableId),
      result.restored ? tableDao.getTableById(result.restored.tableId) : null,
    ]);

    if (cancelledTable) {
      await planChangeService.recordRoutineChange({
        trainerId,
        clientId,
        previousTable: { ...cancelledTable.toObject(), startDate: result.cancelled.startDate },
        newTable: restoredTable
          ? { ...restoredTable.toObject(), startDate: result.restored.startDate }
          : null,
        reason: req.body?.reason,
      });
    }

    return res.status(204).send();
  },

  // PATCH /trainer/clients/:clientId/routine-assignments/:assignmentId
  // body: { startDate, reason? }
  // Tarea 4ter (2026-09) — cambiar la fecha de una fase PROGRAMADA (aún no
  // en curso), p.ej. para alargar la rutina actual sin cancelar y volver a
  // programar desde cero.
  async reschedulePhase(req, res) {
    const trainerId = req.auth.userId;
    const { clientId, assignmentId } = req.params;
    const { startDate, reason } = req.body || {};

    if (!ISO_DATE.test(startDate || "")) {
      return res.status(400).send({ message: "startDate inválida (YYYY-MM-DD)" });
    }

    let result;
    try {
      result = await routineAssignmentService.rescheduleScheduledPhase(clientId, assignmentId, startDate);
    } catch (error) {
      if (error.code === "ROUTINE_PHASE_NOT_FOUND") {
        return res.status(404).send({ message: error.message, code: error.code });
      }
      if (error.code === "ROUTINE_PHASE_ALREADY_STARTED" || error.code === "ROUTINE_START_IN_PAST") {
        return res.status(400).send({ message: error.message, code: error.code });
      }
      if (error.code === "ROUTINE_OVERLAP") {
        return res.status(409).send({ message: error.message, code: error.code, conflict: error.conflict });
      }
      throw error;
    }

    const table = await tableDao.getTableById(result.after.tableId);
    await planChangeService.recordRoutineChange({
      trainerId,
      clientId,
      previousTable: table ? { ...table.toObject(), startDate: result.before.startDate } : null,
      newTable: table ? { ...table.toObject(), startDate: result.after.startDate } : null,
      reason,
    });

    return res.send(result.after);
  },
};
