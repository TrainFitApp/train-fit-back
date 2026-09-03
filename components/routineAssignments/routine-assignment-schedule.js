const { addDaysToIsoDate } = require("../util/period-util");
const { isoDate } = require("../util/date-util");
const { projectionInRange } = require("./routine-assignment-projection");

// Tarea 5 (2026-09) — adherencia de entrenamiento por VENTANA + FASE, en vez
// de un cociente sobre toda la vida de la tabla. adherence-service.js NO
// cambia: sigue recibiendo {completedSessions, plannedTotal}, solo cambia
// de dónde salen esos dos números (ver client-data-loader.js/roster-
// service.js).
//
// Puro: recibe fases YA ordenadas y splits YA cargados por el llamador (que
// decide cómo dosificar las consultas — un cliente vs. toda la Cartera) y
// un `periodEndClamped` ya calculado — nunca toca la BD ni el reloj, mismo
// criterio que projectSchedule/checkinsDimension (que recibe `now` como
// parámetro en vez de leerlo).

// Dos fases con la MISMA startDate no están prohibidas por blocksNewPhase
// (solo bloquea una fecha estrictamente posterior) — se desempata por
// createdAt para que el recorrido sea determinista y reproducible, no
// "el orden en que Mongo devolvió los documentos".
function sortPhasesAscending(phases) {
  return [...(phases || [])].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

// Por cada fase, su tramo de vigencia real DENTRO de la ventana pedida: desde
// max(inicio de la fase, inicio de ventana) hasta el día antes de que empiece
// la SIGUIENTE fase (o el final de la ventana, si es la última — sin
// endDate, una fase rige hasta que la sustituye otra).
//
// plannedTotal y completedSessions se cuentan con el MISMO recorte por
// tramo — si se contaran las sesiones completadas sobre toda la ventana sin
// más, un cliente migrado a una fase HOY sobre una tabla con historial
// antiguo arrastraría sesiones completadas de ANTES de que la fase
// existiera ("3 de 1"), el mismo error de cuentas que checkinsDimension ya
// evita a propósito.
function computeWindowedTrainingProgress(phasesAsc, splitsByTableId, periodStart, periodEndClamped) {
  let plannedTotal = 0;
  let completedSessions = 0;

  (phasesAsc || []).forEach((phase, index) => {
    const next = phasesAsc[index + 1];
    const lower = phase.startDate > periodStart ? phase.startDate : periodStart;
    const upperCandidate = next ? addDaysToIsoDate(next.startDate, -1) : periodEndClamped;
    const upper = upperCandidate < periodEndClamped ? upperCandidate : periodEndClamped;
    if (lower > upper) return;

    const splits = splitsByTableId.get(String(phase.tableId))?.splits || [];

    const projected = projectionInRange(phase.startDate, splits, lower, upper);
    plannedTotal += projected.filter((row) => !row.isPlannedRestDay).length;

    // Conteo por cantidad, no por emparejamiento exacto fecha-a-fecha con la
    // proyección: "tocaban 4, se hicieron 3" — no penaliza a quien entrena
    // un día distinto al previsto (mismo criterio que la dimensión de
    // hábitos, que tampoco exige el día exacto).
    const workouts = splits.flatMap((split) => split.workouts || []);
    completedSessions += workouts.filter((workout) => {
      if (workout.rest || workout.isPlannedRestDay || !workout.date) return false;
      const date = isoDate(workout.date);
      return date >= lower && date <= upper;
    }).length;
  });

  return { plannedTotal, completedSessions };
}

module.exports = { sortPhasesAscending, computeWindowedTrainingProgress };
