const mongoose = require("mongoose");
const tableService = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const trainerNoteService = require("../trainerNotes/trainer-note-service");
const { resolveOwnedDietDay, getTrackingDaysForClient } = require("../dietDays/diet-day-resolver");
const nutritionPreferencesService = require("../nutritionPreferences/nutrition-preferences-service");
const trainerClientService = require("./trainer-client-service");
const trainerPrescriptionService = require("./trainer-prescription-service");
const { badRequest } = require("../util/http-error");
const { listSkippedDates } = require("../dietDays/diet-skips");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const { shoppingRange } = require("../dietDays/shopping-list-service");
const dietDaysService = require("../dietDays/diet-days-service");
const { summarizeFoodCompliance } = require("../dietDays/food-compliance");
const { routineInUseOfId } = require("../routineAssignments/routine-in-use");

// MVP-trainers F20 — margen de tolerancia único, no repetido inline en varios
// sitios (sección 9 del doc). ±15% sobre el objetivo de kcal del día.
const ADHERENCE_TOLERANCE = 0.15;

// Fase 7 Coach Pro — los tres helpers de fecha que vivían aquí ahora salen
// de util/date-util.js. `daysBetweenIsoDates` pasa a llamarse `daysInRange`
// porque eso es lo que hacía (contar ambos extremos: mismo día = 1), a
// diferencia de `daysElapsed`, que cuenta días transcurridos (mismo día = 0). Dos nombres iguales con resultados que
// difieren en 1 no fallan nunca de forma visible: solo hacen que un
// denominador salga corrido.
const { addDaysToIsoDate, daysInRange } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");

// getTrackingDaysForClient vive ahora en diet-day-resolver.js (Auditoría
// 2026-09) — client-data-loader.js (Resumen de la ficha) necesitaba la misma
// resolución de días no materializados y una función de controller no era un
// sitio reutilizable desde otro componente.

const TRAINING_GOAL_TYPES = ["strength", "hypertrophy", "endurance", "mobility", "general"];

module.exports = {
  // GET /trainer/clients/:clientId/training-goal — requireActiveClient("training")
  // ya trae el par en req.trainerClientPair.
  async getTrainingGoal(req, res) {
    return res.send({ trainingGoalType: req.trainerClientPair.trainingGoalType || null });
  },

  // PUT /trainer/clients/:clientId/training-goal — Tarea 3 bis,
  // requireActiveClient("training"). body: { trainingGoalType }
  async updateTrainingGoal(req, res) {
    const { trainingGoalType } = req.body || {};
    const sanitizedType = TRAINING_GOAL_TYPES.includes(trainingGoalType) ? trainingGoalType : null;

    await trainerClientService.setTrainingGoal(req.trainerClientPair._id, sanitizedType);

    return res.send({ trainingGoalType: sanitizedType });
  },

  // GET /trainer/clients/:clientId/tables — F09, requireActiveClient("training")
  async getClientTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 20).toString(), 10);

    // La rutina en uso es una sola y se calcula (routine-in-use.js): la fase
    // que empezó hoy ya sale activa sin que nadie la sincronice.
    const [tables, routine] = await Promise.all([
      tableService.getTablesAssignedByTrainer(req.params.clientId, req.auth.userId, page, limit),
      routineInUseOfId(req.params.clientId),
    ]);
    const tableInUseId = String(routine.tableInUse || "");
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
    const table = await trainerPrescriptionService.activateRoutine({
      trainerId: req.auth.userId,
      clientId,
      tableId,
      reason: req.body?.reason,
    });
    return res.send({ _id: table._id });
  },

  // GET /trainer/clients/:clientId/tables/available-templates — F11, requireActiveClient("training")
  // Plantillas disponibles para asignar: públicas de TrainFit + propias del profesional.
  async getAvailableTemplates(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 20).toString(), 10);
    const templates = await tableService.getTables(page, limit, false, req.auth.userId);
    return res.send(templates);
  },

  // POST /trainer/clients/:clientId/tables — F11, requireActiveClient("training")
  // body: { mode: "new", name } | { mode: "duplicate", sourceTableId }
  async assignTable(req, res) {
    const { mode, name, sourceTableId } = req.body || {};
    const table = await trainerPrescriptionService.assignRoutine({
      trainerId: req.auth.userId,
      clientId: req.params.clientId,
      mode,
      name,
      sourceTableId,
    });
    return res.status(201).send(table);
  },

  // GET /trainer/clients/:clientId/anthropometry — F09, requireActiveClient() sin scope
  async getClientAnthropometry(req, res) {
    const clientId = req.params.clientId;
    // Anthropometry.date es un String "YYYY-MM-DD": con objetos Date Mongoose
    // los casteaba a "Sun Jun 28 2026…" y ningún día cumplía el filtro (siempre []).
    const toIsoDay = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw badRequest("minDate y maxDate deben ser fechas válidas");
      return date.toISOString().slice(0, 10);
    };
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Sin maxDate: hoy, en la zona del cliente.
    const maxDate = req.query.maxDate ? toIsoDay(req.query.maxDate) : await todayForUser(clientId);
    const minDate = toIsoDay(req.query.minDate || new Date(maxDate).getTime() - 90 * DAY_MS);

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
    const stats = await tableService.getExerciseHistoryStats(
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
    // arriba en applyMealToClients).
    const dietDay = await resolveOwnedDietDay(clientId, req.query.date);
    if (!dietDay) {
      return res.send(null);
    }

    return res.send(dietDay);
  },

  // POST /trainer/clients/:clientId/diet-days/:date/meals/:mealId/prescribe
  // F12, requireActiveClient("nutrition"). body: { customProducts, customRecipes, merge }
  async prescribeMeal(req, res) {
    const { clientId, date, mealId } = req.params;
    const { customProducts, customRecipes, merge } = req.body || {};
    const meal = await trainerPrescriptionService.prescribeMeal({
      trainerId: req.auth.userId,
      clientId,
      date,
      mealId,
      customProducts,
      customRecipes,
      merge,
    });
    return res.send(meal);
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
    const cutoffDate = await trainerClientService.getPreviousRelationCutoff(req.auth.userId, req.params.clientId);
    return res.send({ cutoffDate });
  },

  // GET /trainer/clients/:clientId/notes — F19, requireActiveClient() sin scope
  async listNotes(req, res) {
    const notes = await trainerNoteService.list(req.auth.userId, req.params.clientId);
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
    const note = await trainerNoteService.create(req.auth.userId, req.params.clientId, text);
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
    const note = await trainerNoteService.update(req.auth.userId, req.params.clientId, req.params.noteId, {
      text,
      pinned,
    });
    if (!note) return res.status(404).send({ message: "Nota no encontrada" });
    return res.send(note);
  },

  // DELETE /trainer/clients/:clientId/notes/:noteId — F19, requireActiveClient() sin scope
  async deleteNote(req, res) {
    const note = await trainerNoteService.remove(req.auth.userId, req.params.clientId, req.params.noteId);
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

    const to = req.query.to || (await todayForUser(clientId));
    const from = req.query.from || addDaysToIsoDate(to, -30);
    // La variable se llama distinto que la función para no sombrearla: el
    // campo de la respuesta sigue siendo `daysInRange` (ya lo consume el
    // frontend), pero aquí dentro necesita otro nombre.
    const rangeDays = daysInRange(from, to);

    // F20-undecies: getTrackingDaysForClient (materializados + resueltos al
    // vuelo para fechas sin DietDay real) en vez de leer solo lo ya
    // materializado — si no, un plan recién aplicado salía casi sin datos.
    const dietDays = await getTrackingDaysForClient(clientId, from, to);

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
  // si el cliente marcó lo pautado como hecho (CustomProduct.consumed /
  // CustomRecipe.consumed). Pensado para pintar el
  // calendario del tab de nutrición del profesional (una celda por día).
  async getClientNutritionCompliance(req, res) {
    const clientId = req.params.clientId;
    const to = req.query.to || (await todayForUser(clientId));
    const from = req.query.from || addDaysToIsoDate(to, -30);

    const dietDays = await getTrackingDaysForClient(clientId, from, to);

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
    const to = req.query.to || (await todayForUser(clientId));
    const from = req.query.from || addDaysToIsoDate(to, -30);

    const dietDays = await getTrackingDaysForClient(clientId, from, to);
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
    const hoy = await todayForUser(clientId);
    const pedido = req.query.to || hoy;
    const to = pedido > hoy ? hoy : pedido;
    const from = req.query.from || addDaysToIsoDate(to, -30);

    // Una semana que empieza mañana no tiene nada que resumir todavía.
    if (from > to) return res.send({ status: "ok", items: [], from, to });

    const dietDays = await getTrackingDaysForClient(clientId, from, to);
    return res.send({ status: "ok", items: summarizeFoodCompliance(dietDays), from, to });
  },

  // GET /trainer/clients/:clientId/shopping-list?from=&to= — Movimiento 5
  // Coach Pro. Lo que el cliente tiene que comprar para cumplir el plan de
  // ese rango: menús × días, con sus alternativas (shopping-list-service.js).
  // Sin modelo nuevo: se calcula del plan al pedirla, porque el plan cambia.
  async getClientShoppingList(req, res) {
    // requireActiveClient("nutrition") ya garantiza que el cliente existe.
    const clientId = new mongoose.Types.ObjectId(req.params.clientId);
    const range = shoppingRange(req.query, await todayForUser(clientId));
    if (!range) return res.status(400).send({ message: "Rango inválido (YYYY-MM-DD, máx. 62 días)" });
    return res.send(await dietDaysService.getShoppingList(clientId, range.from, range.to));
  },

  // GET /trainer/clients/:clientId/nutrition-preferences — F29, requireActiveClient("nutrition"),
  // solo lectura para el profesional (null si el cliente nunca respondió/se le solicitó nunca).
  async getClientNutritionPreferences(req, res) {
    return res.send(await nutritionPreferencesService.getForClient(req.params.clientId));
  },

  // POST /trainer/clients/:clientId/nutrition-preferences/request — F29, requireActiveClient("nutrition").
  // El cliente lo ve en "Pendiente de ti" del tab Coach y recibe el aviso.
  async requestNutritionPreferences(req, res) {
    return res.send(await nutritionPreferencesService.request(req.params.clientId, req.auth.userId));
  },

  // PUT /trainer/clients/:clientId/nutrition-preferences — el profesional
  // rellena/edita directamente las preferencias en vez de esperar a que el
  // cliente responda el cuestionario (misma validación que el cliente).
  async updateClientNutritionPreferences(req, res) {
    return res.send(await nutritionPreferencesService.saveByTrainer(req.params.clientId, req.body));
  },

  // GET /trainer/routines — Rutinas -> Plantillas (rediseño 2026-08):
  // biblioteca de plantillas de rutina COMPLETA (microciclos/splits/
  // workouts) propia del profesional — distinto de WorkoutTemplate
  // (plantilla de un solo día/sesión, /trainer/workout-templates). Reutiliza
  // tableService.getTables(own=true) tal cual: mismo mecanismo que un cliente
  // listando sus propias Tables, sin duplicar query.
  async listOwnRoutines(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 50).toString(), 10);
    const tables = await tableService.getTables(page, limit, true, req.auth.userId);
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
    const table = await tableService.createOwnRoutineTemplate(req.auth.userId, name);
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

    const source = await tableService.getTableById(req.params.tableId);
    if (!source) return res.status(404).send({ message: "Rutina no encontrada" });

    const ownerId = source.userId ? String(source.userId._id || source.userId) : null;
    if (ownerId !== trainerId) {
      if (!ownerId || !(await trainerClientService.hasActiveClient(trainerId, ownerId, "training"))) {
        return res.status(403).send({ message: "No tienes permiso para esta rutina" });
      }
    }

    const table = await tableService.saveTableAsTrainerTemplate(trainerId, source._id, name);
    return res.status(201).send(table);
  },

  // DELETE /trainer/routines/:id — borra una plantilla propia. adminMode=false
  // a propósito: la query resultante es {_id, userId: trainerId}, así que
  // solo borra si la Table pertenece de verdad a este profesional — la
  // comprobación de propiedad la hace la propia query, no hace falta
  // canAccessUserTable aparte.
  async deleteOwnRoutine(req, res) {
    const result = await tableService.deleteTable(req.auth.userId, req.params.id, false);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Plantilla no encontrada" });
    }
    return res.sendStatus(204);
  },

  // POST /trainer/routines/:routineId/apply-to-clients — F30, reutiliza literalmente
  // tableService.assignTemplateToClient (F11), una vez por cliente destino.
  // :routineId es una plantilla (pública o propia del profesional), NUNCA una
  // tabla ya asignada a otro cliente — misma comprobación de propiedad que F11.
  async applyRoutineToClients(req, res) {
    return res.send(
      await trainerPrescriptionService.applyRoutineToClients(req.auth.userId, req.params.routineId, req.body?.targetClientIds),
    );
  },

  // POST /trainer/clients/:clientId/diet-days/:date/meals/:mealSlot/apply-to-clients — F30,
  // reutiliza literalmente mealService.pasteMeal (F12), resolviendo el hueco de comida de
  // CADA cliente destino por separado (mismo criterio de F28: nunca confiar en un mealId
  // suelto — cada cliente tiene un mealId distinto para el mismo mealSlot por nombre).
  async applyMealToClients(req, res) {
    const { date, mealSlot } = req.params;
    return res.send(await trainerPrescriptionService.applyMealToClients(req.auth.userId, { ...req.body, date, mealSlot }));
  },

  // POST /trainer/meals/apply-to-clients — F30/TAREA5, sin cliente origen en
  // la URL (ver comentario en trainer-client-routes.js). Misma lógica que
  // applyMealToClients de arriba, date/mealSlot viajan por el body en vez de
  // por params porque no hay ruta anidada bajo un cliente concreto.
  async applyMealToClientsDirect(req, res) {
    return res.send(await trainerPrescriptionService.applyMealToClients(req.auth.userId, req.body || {}));
  },
};
