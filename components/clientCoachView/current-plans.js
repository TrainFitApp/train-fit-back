// PURO — "Tu plan actual" del tab Coach del cliente: qué rutina y qué fase de
// dieta tiene hoy. Sin BD: el controller le pasa los documentos ya leídos.
//
// Cada plan sale como { status, ... }:
//   · "active"    — rige hoy.
//   · "scheduled" — no rige nada hoy, pero hay uno programado más adelante.
//   · "assigned"  — (solo rutina) el entrenador se la asignó pero no la ha
//                   puesto en uso ni la ha programado como fase.
//   · null        — nada de lo anterior.

function byStartDesc(a, b) {
  return (
    String(b.startDate).localeCompare(String(a.startDate)) ||
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

function byStartAsc(a, b) {
  return byStartDesc(b, a);
}

/**
 * Rutina. Manda `tableInUseId` (la que entrena el cliente y la que el
 * entrenador ve como activa). Si no hay, la fase de rutina que cubre hoy:
 * sin cron, tableInUse solo se sincroniza cuando el entrenador abre las
 * rutinas del cliente. Sin ninguna de las dos, la próxima fase programada.
 * Y si tampoco, la última rutina que le asignó el entrenador: "Asignar
 * rutina" (POST /trainer/clients/:id/tables) crea la tabla y avisa al
 * cliente, pero no la pone en uso ni crea fase.
 *
 * `phases`: RoutineAssignment del cliente ({tableId, startDate, status, createdAt}).
 * `assignedTables`: tablas del cliente asignadas por sus profesionales
 * ({tableId, assignedAt: Date}).
 * Devuelve { status, tableId, startDate } — startDate null si no viene de
 * ninguna fase (el controller usa entonces la fecha de la tabla).
 */
function pickTrainingPlan({ tableInUseId, phases = [], assignedTables = [], today, now = new Date() }) {
  const covering = phases.filter((p) => p.startDate && p.startDate <= today).sort(byStartDesc)[0] || null;

  if (tableInUseId) {
    const samePhase = covering && String(covering.tableId) === String(tableInUseId);
    return { status: "active", tableId: String(tableInUseId), startDate: samePhase ? covering.startDate : null };
  }
  if (covering) {
    return { status: "active", tableId: String(covering.tableId), startDate: covering.startDate };
  }
  const upcoming = phases.filter((p) => p.startDate > today && p.status !== "ended").sort(byStartAsc)[0];
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
 * Fase de dieta. `docs`: copias asignadas del cliente (DietTemplate con
 * clientId) — {_id, phaseId, phaseName, name, trainerId, startDate, endDate}.
 * Nombre, entrenador y arranque son los de la FASE (su primer documento); la
 * semana en curso es una copia más de la misma cadena.
 * Devuelve { status, head } o null.
 */
function pickNutritionPlan({ docs = [], today }) {
  const headOf = (doc) => docs.find((d) => doc.phaseId && String(d._id) === String(doc.phaseId)) || doc;

  const covering = docs
    .filter((d) => d.startDate && d.startDate <= today && (d.endDate == null || d.endDate >= today))
    .sort(byStartDesc)[0];
  if (covering) return { status: "active", head: headOf(covering) };

  const upcoming = docs.filter((d) => d.startDate && d.startDate > today).sort(byStartAsc)[0];
  if (upcoming) return { status: "scheduled", head: headOf(upcoming) };

  return null;
}

module.exports = { pickTrainingPlan, pickNutritionPlan };
