const mongoose = require("mongoose");
const userSchema = require("../users/schema");
const tableModel = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDaysUtil = require("../dietDays/diet-days-util");
const dietModel = require("../diets/diet-model");
const mealModel = require("../meals/meal-service");
const trainerNoteDao = require("../trainerNotes/trainer-note-dao");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const { resolveOwnedDietDay, getTrackingDaysForClient } = require("../dietDays/diet-day-resolver");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");
const trainerClientDao = require("./trainer-client-dao");
const { listSkippedDates } = require("../dietDays/diet-skips");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const { shoppingRange } = require("../dietDays/shopping-list-service");
const dietDaysService = require("../dietDays/diet-days-service");
const { summarizeFoodCompliance } = require("../dietDays/food-compliance");
const planResolver = require("../planAssignments/plan-resolver");
const planChangeService = require("../planChanges/plan-change-service");
const routineAssignmentService = require("../routineAssignments/routine-assignment-service");

// MVP-trainers F20 — margen de tolerancia único, no repetido inline en varios
// sitios (sección 9 del doc). ±15% sobre el objetivo de kcal del día.
const ADHERENCE_TOLERANCE = 0.15;

// Fase 7 Coach Pro — los tres helpers de fecha que vivían aquí ahora salen
// de util/date-util.js. `daysBetweenIsoDates` pasa a llamarse `daysInRange`
// porque eso es lo que hacía (contar ambos extremos: mismo día = 1), a
// diferencia de la función homónima de plan-resolver.js, que contaba días
// transcurridos (mismo día = 0). Dos nombres iguales con resultados que
// difieren en 1 no fallan nunca de forma visible: solo hacen que un
// denominador salga corrido.
const { todayIsoDate, addDaysToIsoDate, daysInRange } = require("../util/date-util");

// getTrackingDaysForClient vive ahora en diet-day-resolver.js (Auditoría
// 2026-09) — client-data-loader.js (Resumen de la ficha) necesitaba la misma
// resolución de días no materializados y una función de controller no era un
// sitio reutilizable desde otro componente.

// MVP-trainers F30 — orquesta la MISMA operación individual (F11/F12/F13) sobre
// varios clientes destino, cada uno con su propia comprobación de relación
// activa (nunca se salta requireActiveClient "porque es en bloque") y su
// propio resultado independiente — un fallo de un cliente nunca aborta el resto.
async function applyToTargets(trainerId, targetClientIds, requiredScope, operation) {
  const settled = await Promise.allSettled(
    targetClientIds.map(async (targetClientId) => {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        trainerId,
        targetClientId,
        requiredScope
      );
      if (!relation) {
        throw new Error("No tienes una relación activa con este cliente");
      }
      await operation(targetClientId);
    })
  );

  return targetClientIds.map((clientId, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") return { clientId, success: true };
    return { clientId, success: false, error: result.reason?.message || "Error desconocido" };
  });
}

function handleKnownError(res, e) {
  if (
    e.code === "TEMPLATE_NOT_FOUND" ||
    e.code === "TEMPLATE_FORBIDDEN" ||
    e.code === "MEAL_NOT_FOUND"
  ) {
    return res.status(400).send({ message: e.message, code: e.code });
  }
  return null;
}

// MVP-trainers F12, punto 7 — resuelve mealId/date contra el clientId de la
// ruta ANTES de mutar nada. Nunca confiar en un mealId suelto (ver el IDOR
// encontrado en meal-dao.js#pasteMeal, que sí confía ciegamente en el
// mealToPaste que le pasa el llamador — no se repite ese patrón aquí).
// Extraído a diet-day-resolver.js (2026-08-01) para reutilizarlo también en F28.
const resolveOwnedMeal = resolveOwnedDietDay;

const TRAINING_GOAL_TYPES = ["strength", "hypertrophy", "endurance", "mobility", "general"];

module.exports = {
  // GET /trainer/clients/:clientId/training-goal — Tarea 3 bis,
  // requireActiveClient("training"). req.trainerClientRelation ya trae los
  // valores actuales (lo pobló el middleware) — sin consulta aparte.
  async getTrainingGoal(req, res) {
    const relation = req.trainerClientRelation;
    return res.send({
      trainingGoalType: relation.trainingGoalType || null,
    });
  },

  // PUT /trainer/clients/:clientId/training-goal — Tarea 3 bis,
  // requireActiveClient("training"). body: { trainingGoalType }
  async updateTrainingGoal(req, res) {
    const { trainingGoalType } = req.body || {};
    const sanitizedType = TRAINING_GOAL_TYPES.includes(trainingGoalType) ? trainingGoalType : null;

    await trainerClientDao.updateTrainingGoal(req.trainerClientRelation._id, {
      trainingGoalType: sanitizedType,
    });

    return res.send({ trainingGoalType: sanitizedType });
  },

  // GET /trainer/clients/:clientId/tables — F09, requireActiveClient("training")
  async getClientTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 20).toString(), 10);

    // Tarea 4 (2026-09) — sin cron a medianoche (mismo criterio que
    // nutrición), una fase de rutina programada para hoy se resuelve aquí,
    // en el punto de lectura más frecuente del trainer, antes de leer
    // tableInUse — si no, esta misma respuesta serviría el puntero viejo.
    await routineAssignmentService.syncTableInUseIfDue(req.params.clientId);

    const [tables, client] = await Promise.all([
      tableModel.getTablesAssignedByTrainer(req.params.clientId, req.auth.userId, page, limit),
      userSchema.findById(req.params.clientId).select("tableInUse").lean(),
    ]);
    // La tabla en uso
    // se resuelve contra User.tableInUse (puntero único), no contra un campo
    // propio de Table — así activar una desactiva las demás por construcción.
    const tableInUseId = String(client?.tableInUse || "");
    const enriched = tables.map((table) => ({
      ...(typeof table.toObject === "function" ? table.toObject() : table),
      isActive: String(table._id) === tableInUseId,
    }));
    return res.send(enriched);
  },

  // PUT /trainer/clients/:clientId/tables/:tableId/activate — poner en uso
  // una rutina ya asignada (o cualquier tabla del cliente). Tocar una fila ya
  // existente la activa — sin crear ni editar nada, a diferencia de
  // assignTable (crea + NO activa, ver F11 punto 7.7).
  async activateTable(req, res) {
    const { clientId, tableId } = req.params;

    const table = await tableModel.getTableForClient(tableId, clientId);
    if (!table) {
      return res.status(404).send({ message: "Rutina no encontrada para este cliente" });
    }

    const client = await userSchema.findById(clientId).select("tableInUse").lean();
    const previousTable = client?.tableInUse
      ? await tableModel.getTableForClient(client.tableInUse, clientId)
      : null;

    await tableModel.activateTableForClient(clientId, table._id);

    if (String(previousTable?._id) !== String(table._id)) {
      await planChangeService.recordRoutineChange({
        trainerId: req.auth.userId,
        clientId,
        previousTable,
        newTable: table,
        reason: req.body?.reason,
      });
    }

    return res.send({ _id: table._id });
  },

  // GET /trainer/clients/:clientId/tables/available-templates — F11, requireActiveClient("training")
  // Plantillas disponibles para asignar: públicas de TrainFit + propias del profesional.
  async getAvailableTemplates(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 20).toString(), 10);
    const templates = await tableModel.getTables(page, limit, false, req.auth.userId);
    return res.send(templates);
  },

  // POST /trainer/clients/:clientId/tables — F11, requireActiveClient("training")
  // body: { mode: "new", name } | { mode: "duplicate", sourceTableId }
  async assignTable(req, res) {
    try {
      const { mode, name, sourceTableId } = req.body || {};
      const clientId = req.params.clientId;
      const trainerId = req.auth.userId;

      if (mode === "new") {
        if (!name) return res.status(400).send({ message: "name es obligatorio" });
        const table = await tableModel.assignNewRoutineToClient(clientId, name, trainerId);
        await notificationDao.create(clientId, trainerId, "routine_assigned", { routineName: table.name });
        return res.status(201).send(table);
      }

      if (mode === "duplicate") {
        if (!sourceTableId) return res.status(400).send({ message: "sourceTableId es obligatorio" });
        const table = await tableModel.assignTemplateToClient(clientId, sourceTableId, trainerId);
        await notificationDao.create(clientId, trainerId, "routine_assigned", { routineName: table.name });
        return res.status(201).send(table);
      }

      return res.status(400).send({ message: 'mode debe ser "new" o "duplicate"' });
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en assignTable:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/clients/:clientId/anthropometry — F09, requireActiveClient() sin scope
  async getClientAnthropometry(req, res) {
    const clientId = req.params.clientId;
    // Anthropometry.date es un String "YYYY-MM-DD": con objetos Date Mongoose
    // los casteaba a "Sun Jun 28 2026…" y ningún día cumplía el filtro (siempre []).
    const toIsoDay = (value) => new Date(value).toISOString().slice(0, 10);
    const DAY_MS = 24 * 60 * 60 * 1000;
    let maxDate;
    let minDate;
    try {
      // Sin maxDate: mañana (UTC), para no dejar fuera el "hoy" local de husos por delante.
      maxDate = toIsoDay(req.query.maxDate || Date.now() + DAY_MS);
      minDate = toIsoDay(req.query.minDate || new Date(maxDate).getTime() - 90 * DAY_MS);
    } catch (e) {
      return res.status(400).send({ message: "minDate y maxDate deben ser fechas válidas" });
    }

    const entries = await anthropometryService.getAnthropometriesByUserIdBetweenDates(
      clientId,
      minDate,
      maxDate
    );
    return res.send(entries);
  },

  // GET /trainer/clients/:clientId/workouts/history — F09, requireActiveClient("training")
  async getClientWorkoutHistory(req, res) {
    const { exerciseId, exerciseName } = req.query;
    if (!exerciseId && !exerciseName) {
      return res.status(400).send({ message: "exerciseId o exerciseName es obligatorio" });
    }
    const stats = await tableModel.getExerciseHistoryStats(
      req.params.clientId,
      exerciseId,
      exerciseName
    );
    return res.send(stats);
  },

  // GET /trainer/clients/:clientId/diet?date=YYYY-MM-DD — F10, requireActiveClient("nutrition")
  // `date` viaja como string exacto, igual que el flujo del propio cliente
  // (diet-days-controller.js#getDietDayByIdDietAndDate) — DietDay.date es
  // String y se compara por igualdad estricta, no por parseo de fecha.
  async getClientDiet(req, res) {
    if (!req.query.date) {
      return res.send(null);
    }
    const clientId = req.params.clientId;

    // F20-quater — antes esto era un findByIdDietAndDate a secas: si el
    // DietDay de esa fecha todavía no existía (el cliente nunca abrió su
    // app ese día) se devolvía null aunque un PlanAssignment recurrente sí
    // cubriera esa fecha — el entrenador veía "vacío" mientras que el
    // propio cliente, al abrir su app, lo habría visto bien resuelto (su
    // endpoint ya pasa por resolveOwnedDietDay). Misma función aquí, con el
    // id del CLIENTE — resolveOwnedDietDay no asume nada sobre quién hace
    // la petición, solo sobre de quién es la dieta (ver su uso idéntico más
    // arriba en applyMealToClients/proposeMealAlternatives).
    const dietDay = await resolveOwnedDietDay(clientId, req.query.date);
    if (!dietDay) {
      return res.send(null);
    }

    // TAREA5 — el frontend del entrenador necesita el id de la Diet (no solo
    // el DietDay) para poder pedir productos/recetas recientes de esta
    // comida vía GET /diets/:id/recent-products|recipes (mismo endpoint que
    // ya usa el propio consumidor, indexado por dietId+mealIndex).
    const client = await userSchema.findById(clientId).select("_id").lean();
    const dietDayObj = typeof dietDay.toObject === "function" ? dietDay.toObject() : dietDay;
    // Sin wrapper, el "dietId" que espera el front ES el id del cliente.
    return res.send({ ...dietDayObj, dietId: client?._id?.toString() || null });
  },

  // POST /trainer/clients/:clientId/diet-days/:date/meals/:mealId/prescribe
  // F12, requireActiveClient("nutrition"). body: { customProducts, customRecipes, merge }
  async prescribeMeal(req, res) {
    try {
      const { clientId, date, mealId } = req.params;

      const dietDay = await resolveOwnedMeal(clientId, date);
      const targetMeal = (dietDay.meals || []).find(
        (meal) => String(meal._id) === String(mealId)
      );
      if (!targetMeal) {
        const err = new Error("La comida indicada no pertenece a este cliente en esta fecha");
        err.code = "MEAL_NOT_FOUND";
        throw err;
      }

      const mealClipboard = {
        customProducts: req.body.customProducts || [],
        customRecipes: req.body.customRecipes || [],
      };
      const merge = Boolean(req.body.merge);

      // TAREA (meals pautados) — pasteMeal estampa assignedByTrainerId en
      // cada item nuevo (a nivel de producto/receta, no solo de Meal). El
      // flag de Meal completa solo se marca en modo "reemplazar": en modo
      // "combinar" la comida sigue siendo mixta (items propios del cliente
      // + los recién pautados), así que bloquearla entera sería excesivo —
      // la protección por item ya cubre lo que pautó el profesional.
      const updatedMeal = await mealModel.pasteMeal(mealClipboard, targetMeal, merge, req.auth.userId);
      if (!merge) {
        await mealModel.markAssignedByTrainer(targetMeal._id, req.auth.userId);
      }

      // TAREA 1 — prescribeMeal (F12) no generaba ninguna notificación hasta
      // ahora, a diferencia de proposeMealAlternatives (F28). El cliente debe
      // enterarse igual cuando se le aplica una comida directamente.
      await notificationDao.create(clientId, req.auth.userId, "meal_prescribed", {
        date,
        mealName: targetMeal.name,
      });

      return res.send(updatedMeal);
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en prescribeMeal:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/clients/:clientId/previous-relation-cutoff
  // TASK-062 (MASTER_BACKLOG.md) — antes, si un cliente revocado volvía a
  // aceptar una invitación, sus notas/tareas de la relación anterior
  // reaparecían mezcladas con las nuevas sin ninguna indicación de que eran
  // "de antes". En vez de purgarlas (irreversible, y las notas/tareas
  // siguen siendo información real del historial de coaching de ese
  // cliente — ver DECISIONS.md), se expone la fecha de la última revocación
  // para que el frontend pueda separar visualmente "de una relación
  // anterior" de "de la relación actual", sin perder ningún dato.
  async getPreviousRelationCutoff(req, res) {
    const cutoff = await trainerClientDao.findLatestRevokedForClient(req.auth.userId, req.params.clientId);
    return res.send({ cutoffDate: cutoff?.revokedAt || null });
  },

  // GET /trainer/clients/:clientId/notes — F19, requireActiveClient() sin scope
  async listNotes(req, res) {
    const notes = await trainerNoteDao.list(req.auth.userId, req.params.clientId);
    return res.send(notes);
  },

  // POST /trainer/clients/:clientId/notes — F19, requireActiveClient() sin scope
  async createNote(req, res) {
    const text = (req.body?.text || "").trim();
    if (!text) {
      return res.status(400).send({ message: "text es obligatorio" });
    }
    if (text.length > 2000) {
      return res.status(400).send({ message: "text no puede superar los 2000 caracteres" });
    }
    const note = await trainerNoteDao.create(req.auth.userId, req.params.clientId, text);
    return res.status(201).send(note);
  },

  // PATCH /trainer/clients/:clientId/notes/:noteId — F19, requireActiveClient()
  // sin scope. Un solo endpoint para fijar/desfijar y/o corregir el texto —
  // el body trae solo lo que cambia (pinned y/o text).
  async updateNote(req, res) {
    const { text, pinned } = req.body || {};
    if (text !== undefined) {
      const trimmed = String(text).trim();
      if (!trimmed) {
        return res.status(400).send({ message: "text no puede estar vacío" });
      }
      if (trimmed.length > 2000) {
        return res.status(400).send({ message: "text no puede superar los 2000 caracteres" });
      }
    }
    if (pinned !== undefined && typeof pinned !== "boolean") {
      return res.status(400).send({ message: "pinned debe ser true o false" });
    }
    const note = await trainerNoteDao.update(req.auth.userId, req.params.clientId, req.params.noteId, {
      text,
      pinned,
    });
    if (!note) return res.status(404).send({ message: "Nota no encontrada" });
    return res.send(note);
  },

  // DELETE /trainer/clients/:clientId/notes/:noteId — F19, requireActiveClient() sin scope
  async deleteNote(req, res) {
    const note = await trainerNoteDao.remove(req.auth.userId, req.params.clientId, req.params.noteId);
    if (!note) return res.status(404).send({ message: "Nota no encontrada" });
    return res.send({ success: true });
  },

  // GET /trainer/clients/:clientId/adherence?from=&to= — F20, requireActiveClient("nutrition")
  //
  // Adherencia calórica contra lo PAUTADO de cada día, no contra un objetivo
  // guardado aparte: con fases y semanas la meta del día es lo que suma
  // la pauta (plannedTarget), y un objetivo fijo daba "fuera de margen" en
  // cuanto una semana subía o bajaba kcal aunque el cliente cumpliera. Un día cuadra si
  // lo consumido (marcado + lo que añadió él) queda a ±15 % de lo pautado.
  async getClientAdherence(req, res) {
    const clientId = req.params.clientId;

    const to = req.query.to || todayIsoDate();
    const from = req.query.from || addDaysToIsoDate(to, -30);
    // La variable se llama distinto que la función para no sombrearla: el
    // campo de la respuesta sigue siendo `daysInRange` (ya lo consume el
    // frontend), pero aquí dentro necesita otro nombre.
    const rangeDays = daysInRange(from, to);

    // F20-undecies: getTrackingDaysForClient (materializados + resueltos al
    // vuelo para fechas sin DietDay real) en vez de leer solo lo ya
    // materializado — si no, un plan recién aplicado salía casi sin datos.
    const dietDays = await getTrackingDaysForClient(clientId, clientId, from, to);

    const dailyBreakdown = dietDays
      .map((d) => ({ date: d.date, ...dietDaysNutritionUtil.computeDayTracking(d.meals) }))
      .filter((d) => d.hasPlan && d.planned.kcal > 0)
      .map((d) => {
        const kcal = Math.round(d.consumed.kcal);
        const plannedKcal = Math.round(d.planned.kcal);
        const withinMargin = Math.abs(d.consumed.kcal - d.planned.kcal) <= d.planned.kcal * ADHERENCE_TOLERANCE;
        return { date: d.date, kcal, plannedKcal, withinMargin };
      });

    const daysWithinMargin = dailyBreakdown.filter((d) => d.withinMargin).length;
    const daysCounted = dailyBreakdown.length;

    // Dos números y no uno, porque son dos preguntas distintas:
    //   - percentage: de los días con plan, cuántos cuadraron. `null` si no
    //     hubo ninguno — no es un 0%, es "no hay nada que medir todavía".
    //   - coveragePercentage: qué parte del rango tenía plan.
    const percentage = daysCounted > 0 ? Math.round((daysWithinMargin / daysCounted) * 100) : null;
    const coveragePercentage =
      rangeDays > 0 ? Math.round((daysCounted / rangeDays) * 100) : 0;

    return res.send({
      percentage,
      coveragePercentage,
      daysCounted,
      daysInRange: rangeDays,
      dailyBreakdown,
    });
  },

  // GET /trainer/clients/:clientId/nutrition-compliance?from=&to= — F20-bis,
  // requireActiveClient("nutrition"). Distinto de /adherence: adherencia
  // mide si la comida PAUTADA cuadraba con el objetivo de kcal; esto mide
  // si el cliente marcó lo pautado como hecho (Meal.completed /
  // CustomProduct.consumed / CustomRecipe.consumed). Pensado para pintar el
  // calendario del tab de nutrición del profesional (una celda por día).
  async getClientNutritionCompliance(req, res) {
    const clientId = req.params.clientId;
    const client = await userSchema.findById(clientId).select("_id").lean();

    const to = req.query.to || todayIsoDate();
    const from = req.query.from || addDaysToIsoDate(to, -30);

    const dietDays = await getTrackingDaysForClient(clientId, clientId, from, to);

    const skipped = new Set(
      (await listSkippedDates(clientId, 200)).filter((date) => date >= from && date <= to)
    );

    const dailyBreakdown = dietDays.map((d) => {
      const { hasPlan, completionPercentage } = dietDaysNutritionUtil.computeDayCompletion(d.meals);
      return {
        date: d.date,
        hasPlan,
        completionPercentage,
        skipped: skipped.has(d.date),
      };
    });

    return res.send({ status: "ok", dailyBreakdown });
  },

  // GET /trainer/clients/:clientId/nutrition-tracking?from=&to= — F20-ter,
  // requireActiveClient("nutrition"). Compara día a día lo PAUTADO (items
  // con assignedByTrainerId) contra lo REALMENTE consumido — un item
  // pautado solo cuenta como consumido si el cliente lo marcó
  // (completed/consumed); un item que el cliente añadió por su cuenta
  // (assignedByTrainerId null) cuenta como consumido directamente. Kcal +
  // los 3 macros, para el gráfico de comparación del tab de nutrición.
  async getClientNutritionTracking(req, res) {
    const clientId = req.params.clientId;
    const client = await userSchema.findById(clientId).select("_id").lean();

    const to = req.query.to || todayIsoDate();
    const from = req.query.from || addDaysToIsoDate(to, -30);

    const dietDays = await getTrackingDaysForClient(clientId, clientId, from, to);
    const byDate = new Map(dietDays.map((d) => [d.date, d]));

    // F20-octodecies — antes solo se listaban los días con documento (real
    // o sintético) resuelto: cualquier día sin plan Y sin DietDay
    // materializado (nadie lo abrió) faltaba directamente en el array, no
    // aparecía ni con ceros. Para una gráfica de LÍNEAS eso es un eje X
    // poco fiable — Chart.js coloca las fechas pegadas unas a otras en el
    // orden del array, así que un hueco de una semana se veía tan ancho
    // como uno de un día. Se rellena aquí cada fecha del rango completo,
    // con ceros explícitos donde no hay nada.
    const dailyTracking = [];
    for (
      let cursor = new Date(`${from}T00:00:00.000Z`);
      cursor.getTime() <= new Date(`${to}T00:00:00.000Z`).getTime();
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const date = cursor.toISOString().slice(0, 10);
      const day = byDate.get(date);
      dailyTracking.push(
        day
          ? { date, ...dietDaysNutritionUtil.computeDayTracking(day.meals) }
          : {
              date,
              hasPlan: false,
              planned: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
              consumed: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
            },
      );
    }

    return res.send({ status: "ok", dailyTracking });
  },

  // GET /trainer/clients/:clientId/nutrition-foods?from=&to=
  // Cumplimiento ALIMENTO A ALIMENTO del rango, para el panel de resumen de
  // una semana. Hermano de getClientNutritionTracking (que da lo mismo en macros,
  // sin desglose) y de getClientShoppingList (que agrupa por producto pero
  // ignora si se consumió).
  async getClientNutritionFoods(req, res) {
    const clientId = req.params.clientId;

    // `to` se acota a HOY a propósito: los días que todavía no están
    // materializados se resuelven al vuelo con `consumed: false` (ver
    // getTrackingDaysForClient), así que contar el futuro haría parecer que el
    // cliente incumple lo que aún no le ha llegado.
    const hoy = todayIsoDate();
    const pedido = req.query.to || hoy;
    const to = pedido > hoy ? hoy : pedido;
    const from = req.query.from || addDaysToIsoDate(to, -30);

    // Una semana que empieza mañana no tiene nada que resumir todavía.
    if (from > to) return res.send({ status: "ok", items: [], from, to });

    const dietDays = await getTrackingDaysForClient(clientId, clientId, from, to);
    return res.send({ status: "ok", items: summarizeFoodCompliance(dietDays), from, to });
  },

  // GET /trainer/clients/:clientId/shopping-list?from=&to= — Movimiento 5
  // Coach Pro. Lo que el cliente tiene que comprar para cumplir el plan de
  // ese rango: menús × días, con sus alternativas (shopping-list-service.js).
  // Sin modelo nuevo: se calcula del plan al pedirla, porque el plan cambia.
  async getClientShoppingList(req, res) {
    const clientId = req.params.clientId;
    const client = await userSchema.findById(clientId).select("_id").lean();
    if (!client?._id) {
      return res.send({ items: [], daysWithPlan: 0, segments: [], period: null });
    }
    const range = shoppingRange(req.query);
    if (!range) return res.status(400).send({ message: "Rango inválido (YYYY-MM-DD, máx. 62 días)" });
    return res.send(await dietDaysService.getShoppingList(client._id, range.from, range.to));
  },

  // GET /trainer/clients/:clientId/payments — F26, requireActiveClient() sin scope
  async listPayments(req, res) {
    const payments = await trainerPaymentDao.list(req.auth.userId, req.params.clientId);
    return res.send(payments);
  },

  // POST /trainer/clients/:clientId/payments — F26, requireActiveClient() sin scope
  async createPayment(req, res) {
    const { amount, currency, dueDate, note } = req.body || {};
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).send({ message: "amount debe ser un número positivo" });
    }
    if (!dueDate) {
      return res.status(400).send({ message: "dueDate es obligatorio" });
    }
    const dueDateObj = new Date(dueDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (dueDateObj < todayStart) {
      return res.status(400).send({ message: "La fecha de vencimiento no puede ser en el pasado" });
    }

    const payment = await trainerPaymentDao.create(req.auth.userId, req.params.clientId, {
      amount: numericAmount,
      currency: currency || "EUR",
      dueDate: dueDateObj,
      note,
    });

    await notificationDao.create(req.params.clientId, req.auth.userId, "payment_created", {
      amount: numericAmount,
      currency: currency || "EUR",
      dueDate: dueDateObj,
    });

    return res.status(201).send(payment);
  },

  // PATCH /trainer/clients/:clientId/payments/:paymentId — F26, requireActiveClient() sin scope
  async setPaymentPaid(req, res) {
    const payment = await trainerPaymentDao.markPaid(
      req.auth.userId,
      req.params.clientId,
      req.params.paymentId,
      req.body?.paid !== false
    );
    if (!payment) return res.status(404).send({ message: "Cobro no encontrado" });
    return res.send(payment);
  },

  // POST /trainer/clients/:clientId/diet-days/:date/meals/:mealSlot/propose
  // F28, requireActiveClient("nutrition"). body: { alternatives: [{label, customProducts, customRecipes}] }
  async proposeMealAlternatives(req, res) {
    const { clientId, date, mealSlot } = req.params;
    const alternatives = req.body?.alternatives;

    if (!Array.isArray(alternatives) || alternatives.length < 2) {
      return res.status(400).send({ message: "Debes proponer al menos 2 alternativas" });
    }
    if (alternatives.some((a) => !a.label || !a.label.trim())) {
      return res.status(400).send({ message: "Cada alternativa necesita una etiqueta" });
    }

    // Confirma que el hueco de comida (mealSlot, por nombre) existe de verdad
    // para este cliente en esta fecha antes de guardar la propuesta — mismo
    // criterio de "nunca confiar en un identificador suelto" que F12.
    const dietDay = await resolveOwnedDietDay(clientId, date);
    const targetMeal = (dietDay.meals || []).find((meal) => meal.name === mealSlot);
    if (!targetMeal) {
      return res.status(400).send({ message: `No existe la comida "${mealSlot}" para este cliente en esta fecha` });
    }

    const normalizedAlternatives = alternatives.map((a) => ({
      label: a.label.trim(),
      customProducts: a.customProducts || [],
      customRecipes: a.customRecipes || [],
    }));

    const proposal = await mealProposalDao.create(
      req.auth.userId,
      clientId,
      date,
      mealSlot,
      normalizedAlternatives
    );

    await notificationDao.create(clientId, req.auth.userId, "meal_proposal", { date, mealSlot });

    return res.status(201).send(proposal);
  },

  // GET /trainer/clients/:clientId/nutrition-preferences — F29, requireActiveClient("nutrition"),
  // solo lectura para el profesional (null si el cliente nunca respondió/se le solicitó nunca).
  async getClientNutritionPreferences(req, res) {
    const preferences = await nutritionPreferencesDao.getByClientId(req.params.clientId);
    return res.send(preferences);
  },

  // POST /trainer/clients/:clientId/nutrition-preferences/request — F29, requireActiveClient("nutrition").
  // Sin notificación: el cliente lo ve en "Pendiente de ti" del tab Coach
  // (request-status.js#isRequestPending).
  async requestNutritionPreferences(req, res) {
    const preferences = await nutritionPreferencesDao.markRequested(
      req.params.clientId,
      req.auth.userId
    );

    return res.send(preferences);
  },

  // PUT /trainer/clients/:clientId/nutrition-preferences — el profesional
  // rellena/edita directamente las preferencias en vez de esperar a que el
  // cliente responda el cuestionario. Misma validación y mismo dao que usa
  // el cliente para las suyas propias (nutrition-preferences-client-controller.js).
  async updateClientNutritionPreferences(req, res) {
    const {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      dietaryFlags,
      disabledMealSlots,
      mealSlotLabels,
    } = req.body || {};

    const cooksAtHomeValues = ["yes", "no", "sometimes"];
    // Mismo catálogo que nutrition-preferences-dao.js#upsertOwnResponse.
    const validDietaryFlags = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];
    const validMealSlots = Object.values(dietDaysUtil.MEALS);

    if (cooksAtHome != null && !cooksAtHomeValues.includes(cooksAtHome)) {
      return res.status(400).send({ message: "cooksAtHome debe ser 'yes', 'no' o 'sometimes'" });
    }
    // Restricciones: las pone el intake y las editan tanto el profesional
    // (aquí) como el cliente (sus preferencias). Si no viene, el dao no las toca.
    if (
      dietaryFlags != null &&
      (!Array.isArray(dietaryFlags) || !dietaryFlags.every((flag) => validDietaryFlags.includes(flag)))
    ) {
      return res.status(400).send({
        message: `dietaryFlags solo admite: ${validDietaryFlags.join(", ")}`,
      });
    }
    if ([allergies, favoriteFoods, dislikedFoods].some((v) => v != null && String(v).length > 1000)) {
      return res.status(400).send({ message: "Cada campo de texto no puede superar los 1000 caracteres" });
    }
    if (
      disabledMealSlots != null &&
      (!Array.isArray(disabledMealSlots) ||
        !disabledMealSlots.every((slot) => validMealSlots.includes(slot)))
    ) {
      return res.status(400).send({
        message: `disabledMealSlots solo admite: ${validMealSlots.join(", ")}`,
      });
    }
    if (
      mealSlotLabels != null &&
      (typeof mealSlotLabels !== "object" ||
        Array.isArray(mealSlotLabels) ||
        !Object.keys(mealSlotLabels).every((slot) => validMealSlots.includes(slot)) ||
        !Object.values(mealSlotLabels).every((label) => typeof label === "string" && label.length <= 50))
    ) {
      return res.status(400).send({
        message: `mealSlotLabels debe mapear slots válidos (${validMealSlots.join(", ")}) a textos de máximo 50 caracteres`,
      });
    }

    const preferences = await nutritionPreferencesDao.upsertOwnResponse(req.params.clientId, {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      dietaryFlags,
      disabledMealSlots,
      mealSlotLabels,
    });

    return res.send(preferences);
  },

  // GET /trainer/routines — Rutinas -> Plantillas (rediseño 2026-08):
  // biblioteca de plantillas de rutina COMPLETA (microciclos/splits/
  // workouts) propia del profesional — distinto de WorkoutTemplate
  // (plantilla de un solo día/sesión, /trainer/workout-templates). Reutiliza
  // tableModel.getTables(own=true) tal cual: mismo mecanismo que un cliente
  // listando sus propias Tables, sin duplicar query.
  async listOwnRoutines(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 50).toString(), 10);
    const tables = await tableModel.getTables(page, limit, true, req.auth.userId);
    return res.send(tables);
  },

  // POST /trainer/routines — crea una plantilla de rutina vacía (Table con
  // userId=trainerId, sin cliente ni assignedByTrainerId: no es una rutina
  // "asignada", es la biblioteca propia del profesional). El resultado se
  // edita con el mismo Planificador (/tabs/routines/:id/planner) que las
  // rutinas reales de cliente.
  async createOwnRoutine(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
    const table = await tableModel.createOwnRoutineTemplate(req.auth.userId, name);
    return res.status(201).send(table);
  },

  // POST /trainer/routines/from-table/:tableId — "Guardar como plantilla"
  // desde el Planner: copia la PAUTA de una rutina a la biblioteca propia.
  // Origen válido: una plantilla propia o la rutina de un cliente con
  // relación de entrenamiento activa. Un cliente en solo lectura (fuera de
  // plazas) también vale: solo se LEE su rutina, lo que se escribe es la
  // biblioteca del profesional.
  async saveTableAsOwnRoutine(req, res) {
    const trainerId = String(req.auth.userId);
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
    if (name.length > 100) {
      return res.status(400).send({ message: "El nombre no puede superar 100 caracteres" });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.tableId)) {
      return res.status(404).send({ message: "Rutina no encontrada" });
    }

    const source = await tableModel.getTableById(req.params.tableId);
    if (!source) return res.status(404).send({ message: "Rutina no encontrada" });

    const ownerId = source.userId ? String(source.userId._id || source.userId) : null;
    if (ownerId !== trainerId) {
      const relation = ownerId
        ? await trainerClientDao.findActiveByTrainerAndClient(trainerId, ownerId, "training")
        : null;
      if (!relation) {
        return res.status(403).send({ message: "No tienes permiso para esta rutina" });
      }
    }

    const table = await tableModel.saveTableAsTrainerTemplate(trainerId, source._id, name);
    return res.status(201).send(table);
  },

  // DELETE /trainer/routines/:id — borra una plantilla propia. adminMode=false
  // a propósito: la query resultante es {_id, userId: trainerId}, así que
  // solo borra si la Table pertenece de verdad a este profesional — la
  // comprobación de propiedad la hace la propia query, no hace falta
  // canAccessUserTable aparte.
  async deleteOwnRoutine(req, res) {
    const result = await tableModel.deleteTable(req.auth.userId, req.params.id, false);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Plantilla no encontrada" });
    }
    return res.sendStatus(204);
  },

  // POST /trainer/routines/:routineId/apply-to-clients — F30, reutiliza literalmente
  // tableModel.assignTemplateToClient (F11), una vez por cliente destino.
  // :routineId es una plantilla (pública o propia del profesional), NUNCA una
  // tabla ya asignada a otro cliente — misma comprobación de propiedad que F11.
  async applyRoutineToClients(req, res) {
    const { routineId } = req.params;
    const targetClientIds = req.body?.targetClientIds;

    if (!Array.isArray(targetClientIds) || !targetClientIds.length) {
      return res.status(400).send({ message: "Debes seleccionar al menos un cliente destino" });
    }

    const results = await applyToTargets(req.auth.userId, targetClientIds, "training", async (targetClientId) => {
      const table = await tableModel.assignTemplateToClient(targetClientId, routineId, req.auth.userId);
      await notificationDao.create(targetClientId, req.auth.userId, "routine_assigned", { routineName: table.name });
    });
    return res.send(results);
  },

  // POST /trainer/clients/:clientId/diet-days/:date/meals/:mealSlot/apply-to-clients — F30,
  // reutiliza literalmente mealModel.pasteMeal (F12), resolviendo el hueco de comida de
  // CADA cliente destino por separado (mismo criterio de F28: nunca confiar en un mealId
  // suelto — cada cliente tiene un mealId distinto para el mismo mealSlot por nombre).
  async applyMealToClients(req, res) {
    const { date, mealSlot } = req.params;
    const targetClientIds = req.body?.targetClientIds;

    if (!Array.isArray(targetClientIds) || !targetClientIds.length) {
      return res.status(400).send({ message: "Debes seleccionar al menos un cliente destino" });
    }

    const mealClipboard = {
      customProducts: req.body?.customProducts || [],
      customRecipes: req.body?.customRecipes || [],
    };
    const merge = Boolean(req.body?.merge);

    const results = await applyToTargets(req.auth.userId, targetClientIds, "nutrition", async (targetClientId) => {
      const dietDay = await resolveOwnedDietDay(targetClientId, date);
      const targetMeal = (dietDay.meals || []).find((meal) => meal.name === mealSlot);
      if (!targetMeal) {
        throw new Error(`No existe la comida "${mealSlot}" para este cliente en esta fecha`);
      }
      await mealModel.pasteMeal(mealClipboard, targetMeal, merge, req.auth.userId);
      if (!merge) {
        await mealModel.markAssignedByTrainer(targetMeal._id, req.auth.userId);
      }
      await notificationDao.create(targetClientId, req.auth.userId, "meal_prescribed", { date, mealName: targetMeal.name });
    });
    return res.send(results);
  },

  // POST /trainer/meals/apply-to-clients — F30/TAREA5, sin cliente origen en
  // la URL (ver comentario en trainer-client-routes.js). Misma lógica que
  // applyMealToClients de arriba, date/mealSlot viajan por el body en vez de
  // por params porque no hay ruta anidada bajo un cliente concreto.
  async applyMealToClientsDirect(req, res) {
    const { date, mealSlot } = req.body || {};
    const targetClientIds = req.body?.targetClientIds;

    if (!date || !mealSlot) {
      return res.status(400).send({ message: "date y mealSlot son obligatorios" });
    }
    if (!Array.isArray(targetClientIds) || !targetClientIds.length) {
      return res.status(400).send({ message: "Debes seleccionar al menos un cliente destino" });
    }

    const mealClipboard = {
      customProducts: req.body?.customProducts || [],
      customRecipes: req.body?.customRecipes || [],
    };
    const merge = Boolean(req.body?.merge);

    const results = await applyToTargets(req.auth.userId, targetClientIds, "nutrition", async (targetClientId) => {
      const dietDay = await resolveOwnedDietDay(targetClientId, date);
      const targetMeal = (dietDay.meals || []).find((meal) => meal.name === mealSlot);
      if (!targetMeal) {
        throw new Error(`No existe la comida "${mealSlot}" para este cliente en esta fecha`);
      }
      await mealModel.pasteMeal(mealClipboard, targetMeal, merge, req.auth.userId);
      if (!merge) {
        await mealModel.markAssignedByTrainer(targetMeal._id, req.auth.userId);
      }
      await notificationDao.create(targetClientId, req.auth.userId, "meal_prescribed", { date, mealName: targetMeal.name });
    });
    return res.send(results);
  },
};
