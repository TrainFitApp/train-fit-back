const userSchema = require("../users/schema");
const tableModel = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDaysService = require("../dietDays/diet-days-service");
const dietDaysUtil = require("../dietDays/diet-days-util");
const dietModel = require("../diets/diet-model");
const mealModel = require("../meals/meal-service");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const trainerNoteDao = require("../trainerNotes/trainer-note-dao");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const notificationDao = require("../notifications/notification-dao");
const trainerClientDao = require("./trainer-client-dao");
const dietExceptionDao = require("../dietExceptions/diet-exception-dao");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");

// MVP-trainers F20 — margen de tolerancia único, no repetido inline en varios
// sitios (sección 9 del doc). ±15% sobre el objetivo de kcal del día.
const ADHERENCE_TOLERANCE = 0.15;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToIsoDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIsoDates(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T00:00:00.000Z`);
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
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

module.exports = {
  // GET /trainer/clients/:clientId/tables — F09, requireActiveClient("training")
  async getClientTables(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 20).toString(), 10);
    const tables = await tableModel.getTables(page, limit, true, req.params.clientId);
    return res.send(tables);
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
    const maxDate = req.query.maxDate ? new Date(req.query.maxDate) : new Date();
    const minDate = req.query.minDate
      ? new Date(req.query.minDate)
      : new Date(maxDate.getTime() - 90 * 24 * 60 * 60 * 1000);

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
    const client = await userSchema.findById(req.params.clientId).select("dietInUse").lean();
    if (!client?.dietInUse || !req.query.date) {
      return res.send(null);
    }

    const dietDay = await dietDaysService.findByIdDietAndDate(client.dietInUse, req.query.date);
    if (!dietDay) {
      return res.send(null);
    }

    // TAREA5 — el frontend del entrenador necesita el id de la Diet (no solo
    // el DietDay) para poder pedir productos/recetas recientes de esta
    // comida vía GET /diets/:id/recent-products|recipes (mismo endpoint que
    // ya usa el propio consumidor, indexado por dietId+mealIndex).
    const dietDayObj = typeof dietDay.toObject === "function" ? dietDay.toObject() : dietDay;
    return res.send({ ...dietDayObj, dietId: client.dietInUse.toString() });
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
  async assignNutritionalGoal(req, res) {
    const clientId = req.params.clientId;
    const trainerId = req.auth.userId;

    const goal = await nutritionalGoalService.create({
      userId: clientId,
      assignedByTrainerId: trainerId,
      name: req.body.name || "Objetivo asignado",
      kcalTotal: req.body.kcalTotal || 0,
      proteinsGTotal: req.body.proteinsGTotal || 0,
      carbohydratesGTotal: req.body.carbohydratesGTotal || 0,
      fatGTotal: req.body.fatGTotal || 0,
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

    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });

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
    const client = await userSchema.findById(clientId).select("dietInUse goalInUse").lean();

    if (!client?.goalInUse) {
      return res.send({ status: "no_goal" });
    }
    const goal = await nutritionalGoalService.getById(client.goalInUse);
    if (!goal || !goal.kcalTotal) {
      return res.send({ status: "no_goal" });
    }

    const to = req.query.to || todayIsoDate();
    const from = req.query.from || addDaysToIsoDate(to, -30);
    const daysInRange = daysBetweenIsoDates(from, to);

    let dietDays = [];
    if (client.dietInUse) {
      // F20-bis: getFullyPopulatedDietDaysForDiet (autopopulate en cascada)
      // en vez de getDietDaysBetweenDatesByIdDiet (aggregate con $project
      // estrecho) — así sumMealsKcal puede incluir customRecipes, antes
      // deliberadamente excluidas por no tener aquí el árbol de merge de
      // ingredientes que su cálculo real necesita. Ver diet-days-nutrition-util.js.
      dietDays = await dietDaysService.getFullyPopulatedDietDaysForDiet(client.dietInUse, from, to);
    }

    const dailyBreakdown = dietDays
      .filter((d) => (d.meals || []).length)
      .map((d) => {
        const kcal = dietDaysNutritionUtil.sumMealsKcal(d.meals);
        const withinMargin = Math.abs(kcal - goal.kcalTotal) <= goal.kcalTotal * ADHERENCE_TOLERANCE;
        return { date: d.date, kcal, withinMargin };
      });

    const daysWithinMargin = dailyBreakdown.filter((d) => d.withinMargin).length;
    const percentage = daysInRange > 0 ? Math.round((daysWithinMargin / daysInRange) * 100) : 0;

    return res.send({
      status: "ok",
      percentage,
      daysCounted: dailyBreakdown.length,
      daysInRange,
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
    const client = await userSchema.findById(clientId).select("dietInUse").lean();

    const to = req.query.to || todayIsoDate();
    const from = req.query.from || addDaysToIsoDate(to, -30);

    let dietDays = [];
    if (client?.dietInUse) {
      dietDays = await dietDaysService.getFullyPopulatedDietDaysForDiet(client.dietInUse, from, to);
    }

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
