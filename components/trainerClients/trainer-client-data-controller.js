const mongoose = require("mongoose");
const userSchema = require("../users/schema");
const tableModel = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDaysService = require("../dietDays/diet-days-service");
const dietDaysUtil = require("../dietDays/diet-days-util");
const dietModel = require("../diets/diet-model");
const mealModel = require("../meals/meal-service");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const trainerNoteDao = require("../trainerNotes/trainer-note-dao");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");
const trainerClientDao = require("./trainer-client-dao");
const FoodExchangeGroup = require("../foodExchanges/food-exchange-schema");
const { isCompleteServing } = require("../foodExchanges/exchange-profile");
const dietExceptionDao = require("../dietExceptions/diet-exception-dao");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const dietDaysDao = require("../dietDays/diet-days-dao");
const { buildShoppingList } = require("../dietDays/shopping-list-service");
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

// F20-undecies — getFullyPopulatedDietDaysForDiet SOLO devuelve DietDay que
// YA EXISTEN como documento; la resolución de un plan es LAZY
// (resolveOwnedDietDay materializa un día la primera vez que alguien lo
// abre — el cliente en su app, o el entrenador al mirar esa fecha desde la
// ficha). La inmensa mayoría de los días de una ventana de 30/90 días
// nunca se han "abierto" por nadie, así que adherencia/cumplimiento/
// seguimiento salían casi vacíos para un plan recién aplicado aunque SÍ lo
// cubriera — bug real, no "sin datos". Para cada fecha del rango sin
// DietDay real, resuelve el plan sobre la marcha (resolvePlanForDate, sin
// escribir nada en BD — un GET no debe materializar 90 documentos) y
// construye una comida "sintética" con lo pautado (primera alternativa de
// cada slot, mismo criterio que el total de macros del builder). Sin
// datos de consumo real —nada se ha marcado porque nadie ha abierto ese
// día—, pero eso es justo lo correcto: hasPlan=true, 0% consumido.
async function getTrackingDaysForClient(clientId, dietId, from, to) {
  const materialized = dietId
    ? await dietDaysService.getFullyPopulatedDietDaysForUser(dietId, from, to)
    : [];
  const materializedDates = new Set(materialized.map((d) => d.date));

  const days = [...materialized];
  const totalDays = daysInRange(from, to);
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysToIsoDate(from, i);
    if (materializedDates.has(date)) continue;

    let result;
    try {
      result = await planResolver.resolvePlanForDate(clientId, date);
    } catch (e) {
      continue;
    }
    if (!result) continue;

    const meals = Object.values(result.resolved || {})
      .map((slot) => slot.alternatives?.[0])
      .filter((alt) => alt && ((alt.customProducts || []).length || (alt.customRecipes || []).length))
      .map((alt) => ({
        completed: false,
        customProducts: (alt.customProducts || []).map((cp) => ({
          ...(typeof cp.toObject === "function" ? cp.toObject() : cp),
          assignedByTrainerId: result.trainerId,
          consumed: false,
        })),
        customRecipes: (alt.customRecipes || []).map((cr) => ({
          ...(typeof cr.toObject === "function" ? cr.toObject() : cr),
          assignedByTrainerId: result.trainerId,
          consumed: false,
        })),
      }));

    if (meals.length) days.push({ date, meals });
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

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

// Fibra: vacío/ausente significa "este objetivo no la pauta", que no es lo
// mismo que 0 g. Number(null) y Number("") son 0, así que hay que descartar
// "sin valor" ANTES de convertir — mismo cuidado que toFiniteOrNull en
// workouts/workout-controller.js.
function toFiberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Los grupos de intercambio del PROPIO entrenador que aparecen en el reparto.
 *
 * Una consulta para todo el objetivo, filtrada por `trainerId`: el perfil de
 * un grupo de otro entrenador no puede congelarse en esta pauta.
 */
async function loadOwnExchangeGroups(meals, trainerId) {
  const ids = (Array.isArray(meals) ? meals : []).flatMap((meal) =>
    (Array.isArray(meal?.exchanges) ? meal.exchanges : [])
      .map((exchange) => exchange?.groupId)
      .filter((id) => id && mongoose.isValidObjectId(id))
  );
  if (!ids.length) return new Map();

  const groups = await FoodExchangeGroup.find({
    _id: { $in: [...new Set(ids.map(String))] },
    trainerId,
  })
    .select("name serving freeQuantity")
    .lean();
  return new Map(groups.map((group) => [String(group._id), group]));
}

/**
 * Movimiento 5 Coach Pro — reparto del día en intercambios.
 *
 * Se descarta lo que no encaje en vez de rechazar la petición entera: esto
 * viaja junto a los gramos, y un grupo mal formado no puede impedir que se
 * guarde un objetivo calórico. Un reparto vacío es el estado normal de todos
 * los objetivos que existían antes de esta función.
 */
async function sanitizeMealExchanges(meals, trainerId) {
  // El perfil se congela desde la BASE DE DATOS, no desde lo que manda el
  // front: es lo que después cuadra el día contra las kcal del objetivo, y
  // aceptarlo del cliente sería dejar que el navegador decida cuánto suma
  // una ración. De paso ata el grupo a su dueño — hasta ahora `groupId`
  // entraba tal cual desde el body sin comprobar de quién era.
  const groupsById = await loadOwnExchangeGroups(meals, trainerId);

  return (Array.isArray(meals) ? meals : [])
    .map((meal) => {
      const name = String(meal?.name || "").trim().slice(0, 60);
      if (!name) return null;

      const seen = new Set();
      const exchanges = (Array.isArray(meal?.exchanges) ? meal.exchanges : [])
        .map((exchange) => {
          const groupId = exchange?.groupId;
          const groupName = String(exchange?.groupName || "").trim().slice(0, 100);
          const count = Number(exchange?.count);
          if (!groupId || !groupName) return null;
          if (!Number.isFinite(count) || count <= 0) return null;
          // Un grupo repetido en la misma comida son dos filas que suman lo
          // mismo que una con el doble: se queda la primera.
          const key = String(groupId);
          if (seen.has(key)) return null;
          seen.add(key);

          const group = groupsById.get(key);
          // Grupo que no es suyo, o borrado entre que abrió el editor y
          // guardó: la ración se conserva SIN perfil en vez de descartarla.
          // El cuadre ya sabe decir qué grupos le faltan (exchange-profile.js
          // #sumReparto), y eso es mejor que hacer desaparecer parte de una
          // pauta que él acaba de escribir.
          if (!group) return { groupId, groupName, count };
          // Un grupo libre se congela como libre aunque tenga perfil: lo que
          // decide si suma es la decisión del entrenador, no si se pudo
          // calcular.
          if (group.freeQuantity) {
            return { groupId, groupName: group.name || groupName, count, freeQuantity: true };
          }
          if (!isCompleteServing(group.serving)) {
            return { groupId, groupName, count };
          }
          return {
            groupId,
            // El nombre del documento y no el del body: si el front tenía uno
            // viejo en pantalla, la copia congelada debe decir cómo se llama
            // el grupo de verdad.
            groupName: group.name || groupName,
            count,
            serving: group.serving,
            servingFrozenAt: new Date(),
          };
        })
        .filter(Boolean);

      // Una comida sin ninguna ración no es una pauta, es un nombre suelto.
      return exchanges.length ? { name, exchanges } : null;
    })
    .filter(Boolean);
}

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
    // Mismo criterio que getClientNutritionalGoals#isInUse: la tabla en uso
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
    const isCivilDate = (value) => typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString().slice(0, 10) === value;
    const maxDate = req.query.maxDate === undefined ? todayIsoDate() : req.query.maxDate;
    if (!isCivilDate(maxDate)) {
      return res.status(400).send({ message: "maxDate debe ser una fecha válida con formato YYYY-MM-DD" });
    }
    const minDate = req.query.minDate === undefined ? addDaysToIsoDate(maxDate, -90) : req.query.minDate;
    if (!isCivilDate(minDate)) {
      return res.status(400).send({ message: "minDate debe ser una fecha válida con formato YYYY-MM-DD" });
    }
    if (minDate > maxDate) {
      return res.status(400).send({ message: "minDate no puede ser posterior a maxDate" });
    }

    // Anthropometry.date es String: enviar días civiles evita que Mongoose
    // convierta objetos Date a textos locales que no coinciden con YYYY-MM-DD.
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

  // GET /trainer/clients/:clientId/nutritional-goals — F10, requireActiveClient("nutrition")
  // Enriquecido con isInUse por goal (no expone goalInUse crudo, no hace
  // falta): el trainer necesita ver cuál es el activo del cliente AHORA
  // MISMO, no solo cuál asignó él — antes no había ninguna forma de
  // distinguirlo en esta pantalla.
  async getClientNutritionalGoals(req, res) {
    const [goals, client] = await Promise.all([
      nutritionalGoalService.getByUserId(req.params.clientId),
      userSchema.findById(req.params.clientId).select("goalInUse").lean(),
    ]);
    const goalInUseId = String(client?.goalInUse || "");
    const enriched = goals.map((goal) => ({
      ...(typeof goal.toObject === "function" ? goal.toObject() : goal),
      isInUse: String(goal._id) === goalInUseId,
    }));
    return res.send(enriched);
  },

  // POST /trainer/clients/:clientId/nutritional-goals — F13, requireActiveClient("nutrition")
  // POST /trainer/clients/:clientId/nutrition-target
  // body: { objetiveKcalDelta }
  //
  // Mismo cálculo que el cajón de sugerencias de dieta
  // (nutrition-target-resolver.js), pero sin rankear plantillas: solo el
  // número, para autorrellenar el panel de "Asignar objetivos" antes de que
  // el entrenador lo retoque a mano.
  async getNutritionTarget(req, res) {
    const { clientId } = req.params;
    const objetiveKcalDelta = Number(req.body?.objetiveKcalDelta) || 0;

    const resolved = await resolveClientNutritionTarget(clientId, objetiveKcalDelta);
    if (!resolved.ok) {
      return res.status(422).send({ code: "MISSING_BIOMETRICS", missing: resolved.missing });
    }

    return res.send({
      target: { ...resolved.target, objetiveKcalDelta },
      weightSource: resolved.weightSource,
      clientObjetive: resolved.clientObjetive,
    });
  },

  async assignNutritionalGoal(req, res) {
    const clientId = req.params.clientId;
    const trainerId = req.auth.userId;

    // Fase 4 Coach Pro — el objetivo que regía ANTES, leído antes de tocar
    // nada: es la mitad de la entrada del historial ("2200 -> 2100"), y una
    // vez actualizado goalInUse ya no hay forma de saber cuál era.
    const client = await userSchema.findById(clientId).select("goalInUse").lean();
    const previousGoal = client?.goalInUse
      ? await nutritionalGoalService.getById(client.goalInUse)
      : null;

    const goal = await nutritionalGoalService.create({
      userId: clientId,
      assignedByTrainerId: trainerId,
      name: req.body.name || "Objetivo asignado",
      kcalTotal: req.body.kcalTotal || 0,
      proteinsGTotal: req.body.proteinsGTotal || 0,
      carbohydratesGTotal: req.body.carbohydratesGTotal || 0,
      fatGTotal: req.body.fatGTotal || 0,
      // La fibra se añadió al esquema en la Fase 5 y al formulario del
      // profesional, pero NO a esta lista: el valor que escribía el
      // entrenador se descartaba aquí en silencio y el objetivo se guardaba
      // sin fibra. `|| 0` no vale — vacío significa "este objetivo no pauta
      // fibra", que no es lo mismo que 0 g (ver nutritional-goal-schema.js).
      fiberGTotal: toFiberOrNull(req.body.fiberGTotal),
      // Movimiento 5 Coach Pro — reparto del día en intercambios. Viaja en
      // la MISMA petición que los gramos porque son dos formas de pautar el
      // mismo objetivo.
      mealExchanges: await sanitizeMealExchanges(req.body.mealExchanges, trainerId),
    });

    // A diferencia del flujo del propio cliente (nutritional-goal-controller.js
    // #create, que solo activa si no había ninguno — ahí tiene sentido, un
    // cliente puede crear varios presets sin querer cambiar cuál sigue):
    // un objetivo ASIGNADO POR EL TRAINER es una prescripción, siempre pasa
    // a ser el vigente. Bug real corregido en esta sesión — antes copiaba
    // literalmente la condición "solo si no tenía ninguno", que casi nunca
    // se cumple (todo cliente real ya tiene un objetivo activo), así que el
    // objetivo asignado se creaba pero quedaba huérfano sin activarse.
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });

    await notificationDao.create(clientId, trainerId, "goal_assigned", {
      goalName: goal.name,
      kcalTotal: goal.kcalTotal,
    });

    // Fase 4 — historial con el motivo que el coach haya escrito. `reason`
    // es opcional: si no lo pone, se registra igual el qué y el cuánto.
    await planChangeService.recordGoalChange({
      trainerId,
      clientId,
      previousGoal,
      newGoal: goal,
      action: previousGoal ? "replaced" : "assigned",
      reason: req.body.reason,
    });

    return res.status(201).send(goal);
  },

  // PUT /trainer/clients/:clientId/nutritional-goals/:goalId/activate
  // Tocar una card de objetivo ya existente la pone en uso — sin crear ni
  // editar nada, a diferencia de assignNutritionalGoal (crea + activa).
  async activateNutritionalGoal(req, res) {
    const { clientId, goalId } = req.params;

    const goal = await nutritionalGoalService.getByIdAndUserId(goalId, clientId);
    if (!goal) {
      return res.status(404).send({ message: "Objetivo no encontrado para este cliente" });
    }

    const client = await userSchema.findById(clientId).select("goalInUse").lean();
    const previousGoal = client?.goalInUse
      ? await nutritionalGoalService.getById(client.goalInUse)
      : null;

    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });

    // Fase 4 — cambiar de objetivo activo es un cambio de prescripción tanto
    // como crear uno nuevo, aunque aquí no se edite ningún valor.
    if (String(previousGoal?._id) !== String(goal._id)) {
      await planChangeService.recordGoalChange({
        trainerId: req.auth.userId,
        clientId,
        previousGoal,
        newGoal: goal,
        action: "replaced",
        reason: req.body?.reason,
      });
    }

    return res.send({ _id: goal._id });
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

  // PATCH /trainer/clients/:clientId/notes/:noteId — F19, requireActiveClient() sin scope
  async setNotePinned(req, res) {
    const note = await trainerNoteDao.setPinned(
      req.auth.userId,
      req.params.clientId,
      req.params.noteId,
      req.body?.pinned
    );
    if (!note) return res.status(404).send({ message: "Nota no encontrada" });
    return res.send(note);
  },

  // GET /trainer/clients/:clientId/adherence?from=&to= — F20, requireActiveClient("nutrition")
  async getClientAdherence(req, res) {
    const clientId = req.params.clientId;
    const client = await userSchema.findById(clientId).select("goalInUse").lean();

    if (!client?.goalInUse) {
      return res.send({ status: "no_goal" });
    }
    const goal = await nutritionalGoalService.getById(client.goalInUse);
    if (!goal || !goal.kcalTotal) {
      return res.send({ status: "no_goal" });
    }

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
      .filter((d) => (d.meals || []).length)
      .map((d) => {
        const kcal = dietDaysNutritionUtil.sumMealsKcal(d.meals);
        const withinMargin = Math.abs(kcal - goal.kcalTotal) <= goal.kcalTotal * ADHERENCE_TOLERANCE;
        return { date: d.date, kcal, withinMargin };
      });

    const daysWithinMargin = dailyBreakdown.filter((d) => d.withinMargin).length;
    const daysCounted = dailyBreakdown.length;

    // Fase 1 Coach Pro — BUG corregido: el denominador eran TODOS los días
    // del calendario del rango, no los días que realmente tenían algo
    // pautado. Un cliente con un plan de 10 días dentro de un rango de 30
    // salía con un 33% como máximo aunque hubiera cumplido los 10 a la
    // perfección — un número que hacía parecer mal a clientes que iban bien,
    // y sobre el que además ahora se apoyan las alertas.
    //
    // Se devuelven DOS números en vez de uno, porque son dos preguntas
    // distintas y un solo porcentaje oculta cuál de las dos falla:
    //   - percentage: de los días con plan, cuántos cuadraron. `null` si no
    //     hubo ninguno — no es un 0%, es "no hay nada que medir todavía".
    //   - coveragePercentage: qué parte del rango tenía plan.
    // `daysInRange` y `daysCounted` se mantienen tal cual: ya los consume el
    // frontend y siguen significando exactamente lo mismo.
    const percentage = daysCounted > 0 ? Math.round((daysWithinMargin / daysCounted) * 100) : null;
    const coveragePercentage =
      rangeDays > 0 ? Math.round((daysCounted / rangeDays) * 100) : 0;

    return res.send({
      status: "ok",
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

    const exceptions = await dietExceptionDao.findAllForClient(clientId, 200);
    const exceptionByDate = new Map();
    exceptions.forEach((exception) => {
      if (exception.date < from || exception.date > to) return;
      // Si un día tiene varias excepciones (una por mealSlot), basta con
      // saber que hubo alguna para pintar el marcador del calendario — el
      // detalle por comida ya se ve al entrar en ese día.
      if (!exceptionByDate.has(exception.date)) {
        exceptionByDate.set(exception.date, exception.action);
      }
    });

    const dailyBreakdown = dietDays.map((d) => {
      const { hasPlan, completionPercentage } = dietDaysNutritionUtil.computeDayCompletion(d.meals);
      const exceptionType = exceptionByDate.get(d.date) || null;
      return {
        date: d.date,
        hasPlan,
        completionPercentage,
        hasException: !!exceptionType,
        exceptionType,
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

  // GET /trainer/clients/:clientId/shopping-list?from=&to= — Movimiento 5
  // Coach Pro. Lo que el cliente tiene que comprar para cumplir el plan de
  // ese rango, sumado por producto.
  //
  // No hay modelo nuevo: es otra lectura de los MISMOS DietDay que ya sirven
  // el calendario y la adherencia. Guardarla como entidad la dejaría
  // desfasada en cuanto el entrenador cambiara una comida, que es lo normal.
  //
  // Se leen solo los días MATERIALIZADOS (getFullyPopulatedDietDaysForDiet),
  // no se resuelve el plan al vuelo para los que falten: mismo criterio y
  // mismo motivo que en el evaluador nocturno de alertas — resolver cada
  // fecha son 3 consultas más con la cascada entera de autopopulate, y aquí
  // el rango puede ser un mes.
  async getClientShoppingList(req, res) {
    const clientId = req.params.clientId;
    const client = await userSchema.findById(clientId).select("_id").lean();
    if (!client?._id) {
      return res.send({ items: [], daysWithPlan: 0, period: null });
    }

    const from = req.query.from || todayIsoDate();
    // Una semana por defecto: es como se hace la compra.
    const to = req.query.to || addDaysToIsoDate(from, 6);

    const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(
      client._id,
      from,
      to
    );

    return res.send({
      ...buildShoppingList(days),
      period: { from, to },
    });
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
  async requestNutritionPreferences(req, res) {
    const preferences = await nutritionPreferencesDao.markRequested(
      req.params.clientId,
      req.auth.userId
    );

    await notificationDao.create(req.params.clientId, req.auth.userId, "nutrition_preferences_requested", {});

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

  // POST /trainer/clients/:clientId/nutrition-goals/apply-to-clients — F30, reutiliza
  // literalmente la creación de objetivos de F13, una vez por cliente destino.
  async applyGoalToClients(req, res) {
    const targetClientIds = req.body?.targetClientIds;
    if (!Array.isArray(targetClientIds) || !targetClientIds.length) {
      return res.status(400).send({ message: "Debes seleccionar al menos un cliente destino" });
    }

    const goalData = {
      name: req.body?.name || "Objetivo asignado",
      kcalTotal: req.body?.kcalTotal || 0,
      proteinsGTotal: req.body?.proteinsGTotal || 0,
      carbohydratesGTotal: req.body?.carbohydratesGTotal || 0,
      fatGTotal: req.body?.fatGTotal || 0,
    };

    const results = await applyToTargets(req.auth.userId, targetClientIds, "nutrition", async (targetClientId) => {
      const goal = await nutritionalGoalService.create({
        ...goalData,
        userId: targetClientId,
        assignedByTrainerId: req.auth.userId,
      });
      // Mismo fix que assignNutritionalGoal: una asignación del trainer
      // siempre pasa a ser el objetivo vigente, no solo "si no tenía ninguno".
      await userSchema.findByIdAndUpdate(targetClientId, { $set: { goalInUse: goal._id } });
      await notificationDao.create(targetClientId, req.auth.userId, "goal_assigned", {
        goalName: goal.name,
        kcalTotal: goal.kcalTotal,
      });
    });
    return res.send(results);
  },
};
