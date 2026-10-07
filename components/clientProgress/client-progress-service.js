const { loadClientWindow } = require("./client-data-loader");
const { computeAdherence, habitActiveDays } = require("./adherence-service");
const { todayIsoDate, isoDateInZone, dayRangeInZone, addDaysToIsoDate } = require("../util/date-util");
const { timeZoneOfUser } = require("../users/user-time-zone");
const { buildWeeklySeries, buildComparison, buildWeightTrend } = require("./progress-service");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const { taskLabel } = require("../trainerTasks/task-label");
const coachAlertService = require("../coachAlerts/coach-alert-service");
const tableService = require("../tables/table-service");
const routineAssignmentService = require("../routineAssignments/routine-assignment-service");
const dietPhaseService = require("../dietPhases/diet-phase-service");
const {
  buildWeeklyTraining,
  buildPersonalRecords,
  buildLoadEvolution,
  buildVolumeComparison,
  buildBlockTraining,
  buildBlockComparison,
  buildBlockReadiness,
  buildBlockMuscleGroups,
  buildBlockExerciseProgress,
  buildSessionTraining,
  buildSessionMuscleGroups,
  buildSessionReadiness,
  buildSessionExerciseProgress,
  buildSessionAdherence,
  buildBlockAdherence,
  listTrackedExerciseNames,
  listTrackedWorkoutNames,
} = require("./training-service");
const { notFound } = require("../util/http-error");

// La ficha del cliente para su profesional: resumen, progreso semanal y
// progreso de entrenamiento. Los días son los del calendario del cliente.

// Ventana de la foto fija del resumen. 28 días = 4 semanas, el mismo periodo
// que analiza el evaluador de alertas — así el "62% de adherencia" que ve el
// coach en la ficha es literalmente el número que disparó la alerta, no otro
// calculado sobre otro rango.
const SUMMARY_WINDOW_DAYS = 28;

const clientNotFound = () => notFound("Cliente no encontrado");

// `today` y `timeZone` son los del cliente (ver client-data-loader.js).
function buildAdherenceInput(data, periodDays, { today, timeZone }, dietPhase = null) {
  // Solo cuentan las marcas POSTERIORES a la creación del hábito. Sin este
  // filtro un hábito creado ayer podía mostrar "16 de 2 días" si arrastraba
  // marcas antiguas, y el porcentaje quedaba topado a 100 escondiendo que
  // los números no cuadraban.
  const creacionPorTarea = new Map(
    data.activeTasks.map((task) => [String(task._id), isoDateInZone(task.createdAt, timeZone)])
  );
  const marcasPorTarea = new Map();
  for (const completion of data.taskCompletions) {
    const key = String(completion.taskId);
    const desde = creacionPorTarea.get(key);
    if (desde && completion.date < desde) continue;
    marcasPorTarea.set(key, (marcasPorTarea.get(key) || 0) + 1);
  }

  return {
    nutrition: {
      // Auditoría 2026-09 — "sin datos suficientes" salía igual con y sin
      // plan asignado (getTrackingDaysForClient ya resuelve los días sin
      // materializar, pero un plan recién asignado o sin contenido sigue
      // pudiendo tener <3 días con datos). hasActivePlan deja que
      // nutritionDimension distinga "no hay plan" de "hay plan, aún sin
      // datos" en vez de decir lo mismo para los dos casos.
      ...dietDaysNutritionUtil.computeRangeAdherence(data.dietDays, periodDays),
      hasActivePlan: !!dietPhase,
    },
    training: {
      completedSessions: data.planProgress.completedTotal,
      plannedTotal: data.planProgress.plannedTotal,
      scheduledDays: data.planProgress.scheduledDays,
    },
    habits: {
      habits: data.activeTasks.map((task) => ({
        id: String(task._id),
        label: taskLabel(task),
        target: task.target,
        unit: task.unit,
        completions: marcasPorTarea.get(String(task._id)) || 0,
        // Un hábito puesto ayer no arrastra 27 días de "incumplimiento" en
        // los que todavía no existía.
        activeDays: habitActiveDays(creacionPorTarea.get(String(task._id)), today, periodDays),
      })),
    },
    checkins: data.checkinWindow || { expected: 0, answered: 0 },
  };
}

/**
 * "¿Cómo va este cliente?" en una sola petición: alertas abiertas, adherencia
 * de los últimos 28 días, tendencia de peso, check-ins y lo que rige hoy (fase
 * de dieta y rutina). `trainerTimeZone`: la del profesional, solo para saber
 * si sus alertas ya están evaluadas hoy.
 */
async function summary(trainerId, clientId, trainerTimeZone) {
  const timeZone = await timeZoneOfUser(clientId);
  const to = todayIsoDate(timeZone);
  const from = addDaysToIsoDate(to, -(SUMMARY_WINDOW_DAYS - 1));

  // Las alertas del resumen salen de la evaluación diaria del profesional:
  // si hoy aún no se ha hecho, se hace a la vez que se carga la ventana.
  const [data] = await Promise.all([
    loadClientWindow(trainerId, clientId, { from, to, timeZone }),
    coachAlertService.ensureEvaluatedToday(trainerId, { timeZone: trainerTimeZone }),
  ]);
  if (!data) throw clientNotFound();

  const [alerts, dietPhase, currentRoutinePhase] = await Promise.all([
    coachAlertService.listForClient(trainerId, clientId, { status: "open" }),
    dietPhaseService.findCoveringDate(clientId, to),
    routineAssignmentService.findCoveringDate(clientId, to),
  ]);

  // La rutina del resumen es la de la fase que rige hoy, la misma que mide
  // la adherencia de entrenamiento (loadTrainingWindow#findCoveringDate) y
  // la cabecera del frontend (client-detail.page.ts#currentRoutinePhase).
  const routineTable = currentRoutinePhase
    ? await tableService.findSummary(currentRoutinePhase.tableId)
    : null;
  const routine = routineTable ? { _id: routineTable._id, name: routineTable.name } : null;

  const weeks = SUMMARY_WINDOW_DAYS / 7;
  const adherence = computeAdherence(
    buildAdherenceInput(data, SUMMARY_WINDOW_DAYS, { today: to, timeZone }, dietPhase)
  );

  // La tendencia de peso del resumen se calcula sobre la MISMA serie
  // semanal que sirve la pestaña de comparativas — no con una segunda
  // fórmula que pudiera decir algo distinto sobre los mismos datos.
  const series = buildWeeklySeries({
    weeks,
    now: new Date(),
    timeZone,
    anthropometryEntries: data.anthropometryEntries,
    checkinResponses: data.checkinResponses,
    dietDays: data.dietDays,
    workoutDates: data.workoutDates,
    taskCompletions: data.taskCompletions,
    activeTaskCount: data.activeTasks.length,
  });

  const lastEntry = data.anthropometryEntries[data.anthropometryEntries.length - 1] || null;
  const lastResponse = data.allCheckinResponses[0] || null;

  return {
    period: { from, to, days: SUMMARY_WINDOW_DAYS },
    alerts,
    adherence,
    weightTrend: buildWeightTrend(series),
    latestWeight: lastEntry?.weight ?? null,
    latestWeightDate: lastEntry?.date ?? null,
    lastCheckinAt: lastResponse?.respondedAt ?? null,
    nextCheckinDate: data.nextCheckinDate ?? null,
    // La fase de dieta que rige hoy, igual que `routine` para entrenamiento.
    dietPhase: dietPhase
      ? { _id: dietPhase._id, name: dietPhase.name, startDate: dietPhase.startDate, endDate: dietPhase.endDate }
      : null,
    routine,
  };
}

// Serie semanal de las últimas `weeks` semanas + comparativa de la última
// contra la anterior (los dos últimos elementos de la misma serie).
async function weeklyProgress(trainerId, clientId, weeks) {
  const now = new Date();
  const timeZone = await timeZoneOfUser(clientId);
  const to = isoDateInZone(now, timeZone);
  const from = addDaysToIsoDate(to, -(weeks * 7 - 1));

  const data = await loadClientWindow(trainerId, clientId, { from, to, timeZone });
  if (!data) throw clientNotFound();

  const series = buildWeeklySeries({
    weeks,
    now,
    timeZone,
    anthropometryEntries: data.anthropometryEntries,
    checkinResponses: data.checkinResponses,
    dietDays: data.dietDays,
    workoutDates: data.workoutDates,
    taskCompletions: data.taskCompletions,
    activeTaskCount: data.activeTasks.length,
  });

  return {
    weeks,
    period: { from, to },
    series,
    comparison: buildComparison(series),
    weightTrend: buildWeightTrend(series),
  };
}

/**
 * Progreso de entrenamiento: ventana fija de `requestedWeeks` terminando hoy,
 * o un rango libre (`customRange`, comparación por microciclo). Con
 * `workoutName` filtra por nombre de entrenamiento antes de agregar nada;
 * con `exerciseNames`, el detalle de cada ejercicio.
 */
async function trainingProgress(clientId, { customRange, requestedWeeks, workoutName, exerciseNames }) {
  const now = new Date();
  const timeZone = await timeZoneOfUser(clientId);
  let from, to, weeks;

  if (customRange) {
    from = customRange.from;
    to = customRange.to;
    weeks = null;
  } else {
    weeks = requestedWeeks;
    to = isoDateInZone(now, timeZone);
    from = addDaysToIsoDate(to, -(weeks * 7 - 1));
  }

  // Las series se guardan como instante: el rango va de las 00:00 de
  // `from` a las 23:59 de `to` EN LA ZONA DEL CLIENTE.
  const range = dayRangeInZone(from, to, timeZone);
  const [allSets, allSessionAdherenceRows] = await Promise.all([
    tableService.listCompletedSetsForUser(clientId, range.start, range.end),
    tableService.listSessionAdherenceForUser(clientId, range.start, range.end),
  ]);

  // "Elegir el workout a ver" (2026-09) — filtro por NOMBRE de
  // entrenamiento (p.ej. "Día de pierna"), aplicado ANTES de calcular
  // cualquier agregado: así el filtro alcanza por igual a las vistas por
  // microciclo y por sesión sin tocar ninguna de las funciones de
  // training-service.js. workoutNames sale del conjunto SIN filtrar, para
  // que el selector siga ofreciendo todos los workouts aunque ya haya uno
  // elegido.
  const sets = workoutName ? allSets.filter((set) => set.workoutName === workoutName) : allSets;
  const sessionAdherenceRows = workoutName
    ? allSessionAdherenceRows.filter((row) => row.workoutName === workoutName)
    : allSessionAdherenceRows;

  // Movimiento 3 / Tarea 4 — agrupado por microciclo. No cuesta ninguna
  // consulta más: la agregación ya proyecta split y grupos musculares (ver
  // tableDao.listCompletedSetsForUser), y agrupar es puro.
  const blocks = buildBlockTraining(sets, timeZone);
  const sessionAdherence = buildSessionAdherence(sessionAdherenceRows, timeZone);

  // Comparar por ejercicio (2026-09), varios a la vez (2026-09 bis) —
  // exerciseNames siempre va (barato, alimenta el selector sin que el
  // frontend tenga que pedir nada aparte); blockExerciseByName/
  // sessionExerciseByName solo se calculan si se pidió al menos un
  // ejercicio. Un nombre por elemento, no una función nueva: la misma
  // buildBlockExerciseProgress/buildSessionExerciseProgress de siempre,
  // llamada una vez por ejercicio — no hay nada que agregar entre
  // ejercicios distintos, así que no hace falta una versión "múltiple".

  const response = {
    period: { from, to },
    blocks,
    blockComparison: buildBlockComparison(blocks),
    blockReadiness: buildBlockReadiness(sets, timeZone),
    blockMuscleGroups: buildBlockMuscleGroups(sets, timeZone),
    blockAdherence: buildBlockAdherence(sessionAdherence),
    // 2026-09 — granularidad "Por sesión" del comparador: los mismos
    // agregados que arriba pero sin colapsar por microciclo (ver
    // training-service.js#buildSessionTraining). No es una consulta
    // nueva salvo sessionAdherence, que necesita las series NO hechas
    // (listCompletedSetsForUser las descarta).
    sessionTraining: buildSessionTraining(sets, timeZone),
    sessionMuscleGroups: buildSessionMuscleGroups(sets, timeZone),
    sessionReadiness: buildSessionReadiness(sets, timeZone),
    sessionAdherence,
    exerciseNames: listTrackedExerciseNames(sets),
    workoutNames: listTrackedWorkoutNames(allSets),
    totalSets: sets.length,
  };

  if (exerciseNames.length) {
    response.blockExerciseByName = {};
    response.sessionExerciseByName = {};
    for (const name of exerciseNames) {
      response.blockExerciseByName[name] = buildBlockExerciseProgress(sets, name, timeZone);
      response.sessionExerciseByName[name] = buildSessionExerciseProgress(sets, name, timeZone);
    }
  }

  if (weeks) {
    const weekly = buildWeeklyTraining(sets, weeks, now, timeZone);
    response.weeks = weeks;
    response.weekly = weekly;
    response.volumeComparison = buildVolumeComparison(weekly);
    response.personalRecords = buildPersonalRecords(sets);
    response.loadEvolution = buildLoadEvolution(sets, weeks, now, timeZone);
  }

  return response;
}

module.exports = { SUMMARY_WINDOW_DAYS, summary, weeklyProgress, trainingProgress };
