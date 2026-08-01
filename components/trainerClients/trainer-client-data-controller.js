const userSchema = require("../users/schema");
const tableModel = require("../tables/table-service");
const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDaysService = require("../dietDays/diet-days-service");
const dietDaysUtil = require("../dietDays/diet-days-util");
const dietModel = require("../diets/diet-model");
const mealModel = require("../meals/meal-service");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");

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
async function resolveOwnedMeal(clientId, date) {
  let client = await userSchema.findById(clientId).select("dietInUse");
  let dietId = client?.dietInUse;

  if (!dietId) {
    const diet = await dietModel.createDiet({ name: "Dieta", dietsDay: [] });
    dietId = diet._id;
    await userSchema.findByIdAndUpdate(clientId, { $set: { dietInUse: dietId } });
  }

  let dietDay = await dietDaysService.findByIdDietAndDate(dietId, date);
  if (!dietDay) {
    const standardDietDay = dietDaysUtil.getStandardDietDay(date);
    const dietDayDoc = await dietDaysService.createDietDay(standardDietDay);
    await dietModel.addDietDietDay(dietId, dietDayDoc._id.toString());
    dietDay = dietDayDoc;
  }

  return dietDay;
}

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
        return res.status(201).send(table);
      }

      if (mode === "duplicate") {
        if (!sourceTableId) return res.status(400).send({ message: "sourceTableId es obligatorio" });
        const table = await tableModel.assignTemplateToClient(clientId, sourceTableId, trainerId);
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
    return res.send(dietDay);
  },

  // GET /trainer/clients/:clientId/nutritional-goals — F10, requireActiveClient("nutrition")
  async getClientNutritionalGoals(req, res) {
    const goals = await nutritionalGoalService.getByUserId(req.params.clientId);
    return res.send(goals);
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

    // Mismo comportamiento que el flujo del propio cliente (nutritional-goal-controller.js#create):
    // solo se activa automáticamente si el cliente no tenía ningún objetivo activo.
    const client = await userSchema.findById(clientId).select("goalInUse");
    if (!client?.goalInUse) {
      await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    }

    return res.status(201).send(goal);
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

      const updatedMeal = await mealModel.pasteMeal(mealClipboard, targetMeal, merge);
      return res.send(updatedMeal);
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en prescribeMeal:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },
};
