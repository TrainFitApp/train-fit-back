const { loadClientWindow } = require("./client-data-loader");
const { computeAdherence } = require("./adherence-service");
const {
  isoDate,
  buildWeeklySeries,
  buildComparison,
  buildWeightTrend,
} = require("./progress-service");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const { taskLabel } = require("../trainerTasks/task-label");
const coachAlertDao = require("../coachAlerts/coach-alert-dao");
const coachAlertService = require("../coachAlerts/coach-alert-service");
const tableDao = require("../tables/table-dao");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
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
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const Table = require("../tables/table-schema");
const User = require("../users/schema");
const { buildRoster, ROSTER_WINDOW_DAYS } = require("./roster-service");

// Ventana de la foto fija del resumen. 28 días = 4 semanas, el mismo periodo
// que analiza el evaluador de alertas — así el "62% de adherencia" que ve el
// coach en la ficha es literalmente el número que disparó la alerta, no otro
// calculado sobre otro rango.
const SUMMARY_WINDOW_DAYS = 28;

// Las únicas ventanas de tendencia que ofrece la pantalla. Cerradas a
// propósito: un `weeks` libre desde el query string es una invitación a
// pedir 520 semanas y tumbar la agregación de entrenamiento.
const ALLOWED_WEEKS = [4, 8, 12];
const DEFAULT_WEEKS = 4;

// Comparación de VARIOS ejercicios a la vez (2026-09) — mismo tope que
// TOP_EXERCISES en training-service.js ("evolución de cargas" de Resumen):
// más de 5 líneas en la misma gráfica deja de leerse.
const MAX_COMPARED_EXERCISES = 5;

// Parámetros repetidos (?exercises=A&exercises=B), no una lista separada por
// comas: un nombre de ejercicio con una coma literal rompería el split sin
// forma de distinguirla del separador. Express da un string con UNA
// aparición y un array con dos o más — hay que normalizar los dos casos.
function parseExerciseList(query) {
  const raw = query.exercises;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const names = values
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)].slice(0, MAX_COMPARED_EXERCISES);
}

// Tarea 4 (2026-09) — comparación por microciclo en Entrenamiento: el
// entrenador elige un rango libre en un calendario, no una de las 3
// ventanas fijas de arriba. Mismo criterio de "no dejar pedir 520 semanas"
// que ALLOWED_WEEKS, pero como límite de días en vez de lista cerrada,
// porque un rango libre no tiene un conjunto finito de valores válidos.
const MAX_CUSTOM_RANGE_DAYS = 366;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCustomRange(query) {
  const { from, to } = query;
  if (!from || !to || !ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) return null;
  if (from > to) return null;
  const days =
    Math.round(
      (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86400000
    ) + 1;
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;
  return { from, to };
}

function addDays(isoDay, days) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Días que un hábito lleva activo dentro de la ventana: desde que se creó,
// nunca más que el periodo. Sin esto, un hábito puesto ayer arrastraba 27
// días de "incumplimiento" en los que todavía no existía.
function diasActivos(task, periodDays, now) {
  const desdeCreacion = Math.floor((now.getTime() - new Date(task.createdAt).getTime()) / 86400000) + 1;
  return Math.max(0, Math.min(periodDays, desdeCreacion));
}

function buildAdherenceInput(data, periodDays, now = new Date(), activePlan = null) {
  // Solo cuentan las marcas POSTERIORES a la creación del hábito. Sin este
  // filtro un hábito creado ayer podía mostrar "16 de 2 días" si arrastraba
  // marcas antiguas, y el porcentaje quedaba topado a 100 escondiendo que
  // los números no cuadraban.
  const creacionPorTarea = new Map(
    data.activeTasks.map((task) => [String(task._id), isoDate(task.createdAt)])
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
      hasActivePlan: !!activePlan,
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
        activeDays: diasActivos(task, periodDays, now),
      })),
    },
    checkins: data.checkinWindow || { expected: 0, answered: 0 },
  };
}

module.exports = {
  // GET /trainer/roster — Movimiento 1 Coach Pro: una fila por cliente con
  // adherencia, punto débil, peso, último check-in y alertas abiertas.
  //
  // Sin paginación ni filtros de servidor a propósito: son las decenas de
  // clientes de UN profesional, no un listado abierto, y la tabla se ordena
  // y filtra en el cliente sin ida y vuelta. El día que un profesional tenga
  // cientos de clientes, el cuello de botella será loadTrainerContext mucho
  // antes que el tamaño de esta respuesta.
  //
  // Sin requireActiveClient porque no hay :clientId: el propio buildRoster
  // parte de listActiveClientsForTrainer, así que la respuesta no puede
  // contener a nadie que no lleve este profesional.
  async getRoster(req, res) {
    const clients = await buildRoster(req.auth.userId);
    return res.send({ periodDays: ROSTER_WINDOW_DAYS, clients });
  },

  // GET /trainer/clients/:clientId/summary — la foto fija que responde
  // "¿cómo va este cliente?" en una sola petición. Antes esa respuesta
  // exigía abrir 4 pestañas y componerla mentalmente.
  async getSummary(req, res) {
    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;

    const to = isoDate(new Date());
    const from = addDays(to, -(SUMMARY_WINDOW_DAYS - 1));

    // Las alertas del resumen salen de la evaluación diaria del profesional:
    // si hoy aún no se ha hecho, se hace a la vez que se carga la ventana.
    const [data] = await Promise.all([
      loadClientWindow(trainerId, clientId, { from, to }),
      coachAlertService.ensureEvaluatedToday(trainerId),
    ]);
    if (!data) return res.status(404).send({ message: "Cliente no encontrado" });

    const [alerts, activePlan, currentRoutinePhase] = await Promise.all([
      coachAlertDao.listForClient(trainerId, clientId, { status: "open" }),
      planAssignmentService.getActiveForClient(clientId),
      routineAssignmentDao.findCoveringDate(clientId, to),
    ]);

    // Antes se leía data.client.tableInUse: un puntero CACHEADO que solo se
    // refresca al abrir la pestaña de Tablas (ver
    // routine-assignment-service.js#syncTableInUseIfDue, que aquí no se
    // llama) — podía quedar desfasado o vacío aunque hubiera una fase
    // vigente de verdad, mostrando en Resumen una rutina distinta (o
    // ninguna) de la que ya calculan por fecha tanto la adherencia de
    // entrenamiento de aquí mismo (loadTrainingWindow#findCoveringDate)
    // como la cabecera del frontend (client-detail.page.ts#currentRoutinePhase).
    // Con findCoveringDate también aquí, las tres fuentes leen lo mismo.
    const routineTable = currentRoutinePhase
      ? await Table.findById(currentRoutinePhase.tableId).select("name").lean()
      : null;
    const routine = routineTable ? { _id: routineTable._id, name: routineTable.name } : null;

    const weeks = SUMMARY_WINDOW_DAYS / 7;
    const adherence = computeAdherence(buildAdherenceInput(data, SUMMARY_WINDOW_DAYS, new Date(), activePlan));

    // La tendencia de peso del resumen se calcula sobre la MISMA serie
    // semanal que sirve la pestaña de comparativas — no con una segunda
    // fórmula que pudiera decir algo distinto sobre los mismos datos.
    const series = buildWeeklySeries({
      weeks,
      now: new Date(),
      anthropometryEntries: data.anthropometryEntries,
      checkinResponses: data.checkinResponses,
      dietDays: data.dietDays,
      workoutDates: data.workoutDates,
      taskCompletions: data.taskCompletions,
      activeTaskCount: data.activeTasks.length,
    });

    const lastEntry = data.anthropometryEntries[data.anthropometryEntries.length - 1] || null;
    const lastResponse = data.allCheckinResponses[0] || null;

    return res.send({
      period: { from, to, days: SUMMARY_WINDOW_DAYS },
      alerts,
      adherence,
      weightTrend: buildWeightTrend(series),
      latestWeight: lastEntry?.weight ?? null,
      latestWeightDate: lastEntry?.date ?? null,
      lastCheckinAt: lastResponse?.respondedAt ?? null,
      nextCheckinDate: data.nextCheckinDate ?? null,
      activePlan: activePlan
        ? {
            _id: activePlan._id,
            name: activePlan.phaseName || activePlan.name,
            startDate: activePlan.startDate,
            endDate: activePlan.endDate,
          }
        : null,
      routine,
      // requireActiveClient ya dejó la relación en la request: sin consulta extra.
      intakePending: req.trainerClientRelation?.intakePending === true,
    });
  },

  // GET /trainer/clients/:clientId/body-profile — Movimiento 3 Coach Pro.
  //
  // Altura, sexo y fecha de nacimiento del cliente: lo único que le falta a
  // la calculadora corporal, porque las mediciones ya las tiene cargadas la
  // pestaña de Medidas.
  //
  // Endpoint propio y no un campo más en /summary: la calculadora vive en
  // Medidas y /summary son ~9 consultas que sirven a Resumen. Colgarla de
  // ahí obligaría a la pestaña de Medidas a pagar todas esas consultas para
  // leer tres campos de un documento.
  //
  // No devuelve NINGÚN resultado calculado, solo datos: las fórmulas son
  // puras y corren en el navegador (core/utils/body-metrics.util.ts), así
  // que cambiar de fórmula en el selector no cuesta una petición.
  async getBodyProfile(req, res) {
    const client = await User.findById(req.params.clientId)
      .select("height sex birth")
      .lean();
    if (!client) return res.status(404).send({ message: "Cliente no encontrado" });

    return res.send({
      heightCm: client.height ?? null,
      sex: client.sex ?? null,
      birth: client.birth ?? null,
    });
  },

  // GET /trainer/clients/:clientId/progress?weeks=4|8|12 — serie semanal +
  // comparativa de la última semana contra la anterior. Un solo endpoint
  // para las dos cosas: la comparativa NO es otra consulta, son los dos
  // últimos elementos de la misma serie.
  async getProgress(req, res) {
    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;

    const requestedWeeks = Number(req.query.weeks);
    const weeks = ALLOWED_WEEKS.includes(requestedWeeks) ? requestedWeeks : DEFAULT_WEEKS;

    const now = new Date();
    const to = isoDate(now);
    const from = addDays(to, -(weeks * 7 - 1));

    const data = await loadClientWindow(trainerId, clientId, { from, to });
    if (!data) return res.status(404).send({ message: "Cliente no encontrado" });

    const series = buildWeeklySeries({
      weeks,
      now,
      anthropometryEntries: data.anthropometryEntries,
      checkinResponses: data.checkinResponses,
      dietDays: data.dietDays,
      workoutDates: data.workoutDates,
      taskCompletions: data.taskCompletions,
      activeTaskCount: data.activeTasks.length,
    });

    return res.send({
      weeks,
      period: { from, to },
      series,
      comparison: buildComparison(series),
      weightTrend: buildWeightTrend(series),
    });
  },

  // GET /trainer/clients/:clientId/training-progress?weeks=4|8|12 — Fase 6.
  //   ó ?from=YYYY-MM-DD&to=YYYY-MM-DD — Tarea 4 (2026-09).
  //
  // Endpoint aparte de /progress a propósito: su consulta devuelve una fila
  // POR SERIE COMPLETADA (miles en un trimestre) y es con diferencia la más
  // cara del módulo. Fundirla en /progress la haría pagar también a quien
  // solo mira el peso y la adherencia, que es el caso normal al abrir la
  // ficha.
  //
  // Dos modos, un único endpoint (mismo shape de fondo, distinto relleno):
  //   - `weeks` (o ninguno) — ventana fija terminando HOY. Es lo que pide
  //     Resumen, y necesita `weekly`/`loadEvolution`/`personalRecords` para
  //     poder hablar de "esta semana" con sentido.
  //   - `from`/`to` — rango libre elegido a mano en el calendario de
  //     Entrenamiento (comparación por microciclo). Un rango libre no tiene
  //     un "ahora" desde el que contar semanas hacia atrás, así que esos
  //     campos no se calculan — solo lo agregado por microciclo, que no
  //     depende de ninguna ventana semanal.
  async getTrainingProgress(req, res) {
    const clientId = req.params.clientId;
    const customRange = parseCustomRange(req.query);

    const now = new Date();
    let from, to, weeks;

    if (customRange) {
      from = customRange.from;
      to = customRange.to;
      weeks = null;
    } else {
      const requestedWeeks = Number(req.query.weeks);
      weeks = ALLOWED_WEEKS.includes(requestedWeeks) ? requestedWeeks : DEFAULT_WEEKS;
      to = isoDate(now);
      from = addDays(to, -(weeks * 7 - 1));
    }

    const [allSets, allSessionAdherenceRows] = await Promise.all([
      tableDao.listCompletedSetsForUser(
        clientId,
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:59:59.999Z`)
      ),
      tableDao.listSessionAdherenceForUser(
        clientId,
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:59:59.999Z`)
      ),
    ]);

    // "Elegir el workout a ver" (2026-09) — filtro por NOMBRE de
    // entrenamiento (p.ej. "Día de pierna"), aplicado ANTES de calcular
    // cualquier agregado: así el filtro alcanza por igual a las vistas por
    // microciclo y por sesión sin tocar ninguna de las funciones de
    // training-service.js. workoutNames sale del conjunto SIN filtrar, para
    // que el selector siga ofreciendo todos los workouts aunque ya haya uno
    // elegido.
    const workoutName = typeof req.query.workout === "string" ? req.query.workout.trim() : "";
    const sets = workoutName ? allSets.filter((set) => set.workoutName === workoutName) : allSets;
    const sessionAdherenceRows = workoutName
      ? allSessionAdherenceRows.filter((row) => row.workoutName === workoutName)
      : allSessionAdherenceRows;

    // Movimiento 3 / Tarea 4 — agrupado por microciclo. No cuesta ninguna
    // consulta más: la agregación ya proyecta split y grupos musculares (ver
    // tableDao.listCompletedSetsForUser), y agrupar es puro.
    const blocks = buildBlockTraining(sets);
    const sessionAdherence = buildSessionAdherence(sessionAdherenceRows);

    // Comparar por ejercicio (2026-09), varios a la vez (2026-09 bis) —
    // exerciseNames siempre va (barato, alimenta el selector sin que el
    // frontend tenga que pedir nada aparte); blockExerciseByName/
    // sessionExerciseByName solo se calculan si se pidió al menos un
    // ejercicio. Un nombre por elemento, no una función nueva: la misma
    // buildBlockExerciseProgress/buildSessionExerciseProgress de siempre,
    // llamada una vez por ejercicio — no hay nada que agregar entre
    // ejercicios distintos, así que no hace falta una versión "múltiple".
    const exerciseNames = parseExerciseList(req.query);

    const response = {
      period: { from, to },
      blocks,
      blockComparison: buildBlockComparison(blocks),
      blockReadiness: buildBlockReadiness(sets),
      blockMuscleGroups: buildBlockMuscleGroups(sets),
      blockAdherence: buildBlockAdherence(sessionAdherence),
      // 2026-09 — granularidad "Por sesión" del comparador: los mismos
      // agregados que arriba pero sin colapsar por microciclo (ver
      // training-service.js#buildSessionTraining). No es una consulta
      // nueva salvo sessionAdherence, que necesita las series NO hechas
      // (listCompletedSetsForUser las descarta).
      sessionTraining: buildSessionTraining(sets),
      sessionMuscleGroups: buildSessionMuscleGroups(sets),
      sessionReadiness: buildSessionReadiness(sets),
      sessionAdherence,
      exerciseNames: listTrackedExerciseNames(sets),
      workoutNames: listTrackedWorkoutNames(allSets),
      totalSets: sets.length,
    };

    if (exerciseNames.length) {
      response.blockExerciseByName = {};
      response.sessionExerciseByName = {};
      for (const name of exerciseNames) {
        response.blockExerciseByName[name] = buildBlockExerciseProgress(sets, name);
        response.sessionExerciseByName[name] = buildSessionExerciseProgress(sets, name);
      }
    }

    if (weeks) {
      const weekly = buildWeeklyTraining(sets, weeks, now);
      response.weeks = weeks;
      response.weekly = weekly;
      response.volumeComparison = buildVolumeComparison(weekly);
      response.personalRecords = buildPersonalRecords(sets);
      response.loadEvolution = buildLoadEvolution(sets, weeks, now);
    }

    return res.send(response);
  },
};
