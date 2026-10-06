// PURO — "Tu plan actual" del tab Coach del cliente: qué rutina y qué fase de
// dieta tiene hoy. Sin BD: el controller le pasa los documentos ya leídos.
//
// Cada plan sale como { status, ... }:
//   · "active"    — rige hoy.
//   · "scheduled" — no rige nada hoy, pero hay uno programado más adelante.
//   · "assigned"  — (solo rutina) el entrenador se la asignó pero no la ha
//                   puesto en uso ni la ha programado como fase.
//   · null        — nada de lo anterior.

const { coveringPhase, sortChain } = require("../util/phase-chain");

/**
 * Rutina. Manda la que el cliente tiene en uso (`tableInUseId`, ya calculada
 * con sus fases: routineAssignments/routine-in-use.js), con el inicio de su
 * fase si es la de la fase que rige hoy. Sin rutina en uso, la próxima fase
 * programada. Y si tampoco, la última rutina que le asignó el entrenador:
 * "Asignar rutina" (POST /trainer/clients/:id/tables) crea la tabla y avisa
 * al cliente, pero no la pone en uso ni crea fase.
 *
 * `phases`: RoutineAssignment del cliente ({tableId, startDate, createdAt}).
 * `assignedTables`: tablas del cliente asignadas por sus profesionales
 * ({tableId, assignedAt: Date}).
 * Devuelve { status, tableId, startDate } — startDate null si no viene de
 * ninguna fase (el controller usa entonces la fecha de la tabla).
 */
function pickTrainingPlan({ tableInUseId, phases = [], assignedTables = [], today, now = new Date() }) {
  if (tableInUseId) {
    const covering = coveringPhase(phases, today);
    const samePhase = covering && String(covering.tableId) === String(tableInUseId);
    return { status: "active", tableId: String(tableInUseId), startDate: samePhase ? covering.startDate : null };
  }
  const upcoming = sortChain(phases).find((p) => p.startDate > today);
  if (upcoming) {
    return { status: "scheduled", tableId: String(upcoming.tableId), startDate: upcoming.startDate };
  }
  const latest = latestAssigned(assignedTables, now);
  if (latest) return { status: "assigned", tableId: String(latest.tableId), startDate: null };
  return null;
}

// La fecha sale del ObjectId. Los seeds de `pre` usan _id deterministas con
// fechas absurdas (2069…): una fecha futura se trata como la más antigua para
// que no le gane a una asignación real.
function latestAssigned(tables, now) {
  const time = (t) => {
    const ms = new Date(t.assignedAt).getTime();
    return Number.isNaN(ms) || ms > now.getTime() ? 0 : ms;
  };
  return [...tables].sort((a, b) => time(b) - time(a))[0] || null;
}

/**
 * Fase de dieta. `phases`: las fases del cliente (DietPhase) —
 * {_id, name, trainerId, startDate, endDate, createdAt}.
 * Devuelve { status: "active" | "scheduled", phase } o null.
 */
function pickNutritionPlan({ phases = [], today }) {
  const covering = coveringPhase(phases, today);
  if (covering) return { status: "active", phase: covering };

  const upcoming = sortChain(phases).find((p) => p.startDate > today);
  if (upcoming) return { status: "scheduled", phase: upcoming };

  return null;
}

module.exports = { pickTrainingPlan, pickNutritionPlan };
