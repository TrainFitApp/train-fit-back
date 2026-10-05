const { addDaysToIsoDate } = require("../util/period-util");
const { isoDateInZone } = require("../util/date-util");
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

// Adherencia por fase (2026-09) — "adherencia" ya no mira una ventana fija
// de días, solo la fase EN CURSO (decisión del usuario: borrar una fase
// antigua no debe poder alterar en silencio números de adherencia pasados,
// y "¿sigue mi cliente el programa que le di AHORA?" es la pregunta real).
// La fase que cubre `today` dentro de un array YA CARGADO — mismo criterio
// que routine-assignment-dao.js#findCoveringDate (createdAt como desempate
// de un mismo startDate), pero en memoria: la usa roster-service.js, que ya
// carga TODAS las fases de TODA la cartera en una sola consulta y no quiere
// una consulta más por cliente.
function pickCurrentPhase(phases, today) {
  const covering = (phases || []).filter((phase) => phase.startDate <= today);
  if (!covering.length) return null;
  return covering.reduce((latest, phase) => {
    if (phase.startDate !== latest.startDate) {
      return phase.startDate > latest.startDate ? phase : latest;
    }
    return new Date(phase.createdAt) > new Date(latest.createdAt) ? phase : latest;
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
// `timeZone`: la del cliente. Un entreno se guarda como instante y cuenta en
// el día de su calendario.
function computeWindowedTrainingProgress(phasesAsc, splitsByTableId, periodStart, periodEndClamped, timeZone) {
  let plannedTotal = 0;
  let completedSessions = 0;
  // Auditoría 2026-09 — total de días proyectados EN LA VENTANA, contando
  // también los de descanso planificado (a diferencia de plannedTotal, que
  // los excluye a propósito). Sin esto, adherence-service.js no puede
  // distinguir "no hay ninguna fase/tabla" (scheduledDays 0, de verdad
  // "sin_plan") de "hay fase y proyección, pero en esta ventana tan corta
  // solo tocaba descanso" (scheduledDays > 0, plannedTotal 0) — antes las
  // dos caían en el mismo "Sin fase en curso", que para el segundo caso es
  // sencillamente falso (visto en BD: una fase que empieza HOY, cuyo primer
  // día de rutina es de descanso, salía como "sin fase" en cuanto empezaba).
  let scheduledDays = 0;

  (phasesAsc || []).forEach((phase, index) => {
    const next = phasesAsc[index + 1];
    const lower = phase.startDate > periodStart ? phase.startDate : periodStart;
    const upperCandidate = next ? addDaysToIsoDate(next.startDate, -1) : periodEndClamped;
    const upper = upperCandidate < periodEndClamped ? upperCandidate : periodEndClamped;
    if (lower > upper) return;

    const splits = splitsByTableId.get(String(phase.tableId))?.splits || [];

    const projected = projectionInRange(phase.startDate, splits, lower, upper);
    scheduledDays += projected.length;
    plannedTotal += projected.filter((row) => !row.isPlannedRestDay).length;

    // Conteo por cantidad, no por emparejamiento exacto fecha-a-fecha con la
    // proyección: "tocaban 4, se hicieron 3" — no penaliza a quien entrena
    // un día distinto al previsto (mismo criterio que la dimensión de
    // hábitos, que tampoco exige el día exacto).
    const workouts = splits.flatMap((split) => split.workouts || []);
    completedSessions += workouts.filter((workout) => {
      if (workout.rest || workout.isPlannedRestDay || !workout.date) return false;
      const date = isoDateInZone(workout.date, timeZone);
      return date >= lower && date <= upper;
    }).length;
  });

  return { plannedTotal, completedSessions, scheduledDays };
}

module.exports = { sortPhasesAscending, computeWindowedTrainingProgress, pickCurrentPhase };
