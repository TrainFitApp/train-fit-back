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
const tableDao = require("../tables/table-dao");
const {
  buildWeeklyTraining,
  buildPersonalRecords,
  buildLoadEvolution,
  buildVolumeComparison,
  buildBlockTraining,
  buildBlockComparison,
} = require("./training-service");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const NutritionalGoal = require("../nutritionalGoals/nutritional-goal-schema");
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

function buildAdherenceInput(data, periodDays, now = new Date()) {
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
    nutrition: dietDaysNutritionUtil.computeRangeAdherence(data.dietDays, periodDays),
    training: {
      completedSessions: data.planProgress.completedTotal,
      plannedTotal: data.planProgress.plannedTotal,
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
    checkins: {
      respondedAt: data.checkinResponses.map((r) => r.respondedAt),
      cadence: data.checkinConfig?.cadence,
      periodDays,
      now,
    },
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

    const data = await loadClientWindow(trainerId, clientId, { from, to });
    if (!data) return res.status(404).send({ message: "Cliente no encontrado" });

    const [alerts, activePlan, goal, routine] = await Promise.all([
      coachAlertDao.listForClient(trainerId, clientId, { status: "open" }),
      planAssignmentService.getActiveForClient(clientId),
      data.client.goalInUse
        ? NutritionalGoal.findById(data.client.goalInUse)
            .select("name kcalTotal proteinsGTotal carbohydratesGTotal fatGTotal")
            .lean()
        : null,
      data.client.tableInUse
        ? Table.findById(data.client.tableInUse).select("name").lean()
        : null,
    ]);

    const weeks = SUMMARY_WINDOW_DAYS / 7;
    const adherence = computeAdherence(buildAdherenceInput(data, SUMMARY_WINDOW_DAYS));

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
      checkinCadence: data.checkinConfig?.cadence ?? null,
      activePlan: activePlan
        ? { _id: activePlan._id, startDate: activePlan.startDate, endDate: activePlan.endDate }
        : null,
      goal,
      routine,
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
  //
  // Endpoint aparte de /progress a propósito: su consulta devuelve una fila
  // POR SERIE COMPLETADA (miles en un trimestre) y es con diferencia la más
  // cara del módulo. Fundirla en /progress la haría pagar también a quien
  // solo mira el peso y la adherencia, que es el caso normal al abrir la
  // ficha.
  async getTrainingProgress(req, res) {
    const clientId = req.params.clientId;

    const requestedWeeks = Number(req.query.weeks);
    const weeks = ALLOWED_WEEKS.includes(requestedWeeks) ? requestedWeeks : DEFAULT_WEEKS;

    const now = new Date();
    const to = isoDate(now);
    const from = addDays(to, -(weeks * 7 - 1));

    const sets = await tableDao.listCompletedSetsForUser(
      clientId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`)
    );

    const weekly = buildWeeklyTraining(sets, weeks, now);
    // Movimiento 3 Coach Pro — los MISMOS datos agrupados por microciclo. No
    // cuesta ninguna consulta más: la agregación ya proyecta el split (ver
    // tableDao.listCompletedSetsForUser), y agrupar es puro.
    const blocks = buildBlockTraining(sets);

    return res.send({
      weeks,
      period: { from, to },
      weekly,
      volumeComparison: buildVolumeComparison(weekly),
      blocks,
      blockComparison: buildBlockComparison(blocks),
      personalRecords: buildPersonalRecords(sets),
      loadEvolution: buildLoadEvolution(sets, weeks, now),
      totalSets: sets.length,
    });
  },
};
