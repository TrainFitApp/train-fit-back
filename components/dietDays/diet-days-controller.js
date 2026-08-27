const anthropometryModel = require("../anthropometry/anthropometry-service");
const dietDayModel = require("./diet-days-service");
const { resolveOwnedDietDay, applyResolvedPlanToDietDay } = require("./diet-day-resolver");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const planResolver = require("../planAssignments/plan-resolver");
const DietTemplate = require("../dietTemplates/diet-template-schema");
const userSchema = require("../users/schema");
const dietDaysDao = require("./diet-days-dao");
const { buildShoppingList } = require("./shopping-list-service");
const { todayIsoDate, addDaysToIsoDate } = require("../util/date-util");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const controller = {
  // GET /diet-days/shopping-list?from=&to= — Movimiento 5 Coach Pro.
  //
  // La lista del PROPIO cliente: qué tiene que comprar para cumplir su plan
  // en ese rango. Sin :userId en la ruta — el usuario del token es el dueño
  // de la dieta, y aceptar un id sería abrir la puerta a leer el plan de
  // otro (mismo criterio que /pain/mine y /supplements/mine).
  //
  // Comparte servicio con la versión del entrenador
  // (trainer-client-data-controller#getClientShoppingList): la lista es la
  // misma, solo cambia de quién.
  async getMyShoppingList(req, res) {
    const user = await userSchema.findById(req.user.id).select("dietInUse").lean();
    if (!user?.dietInUse) {
      return res.send({ items: [], daysWithPlan: 0, period: null });
    }

    const from = req.query.from || todayIsoDate();
    // Una semana por defecto: es como se hace la compra.
    const to = req.query.to || addDaysToIsoDate(from, 6);

    const days = await dietDaysDao.getFullyPopulatedDietDaysForDiet(user.dietInUse, from, to);
    return res.send({ ...buildShoppingList(days), period: { from, to } });
  },

  async getDietDays(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const dietDays = await dietDayModel.getDietDays(page, limit);
    return res.send(dietDays);
  },

  async getDietDaysBetweenDatesByIdDiet(req, res) {
    const dietDays = await dietDayModel.getDietDaysBetweenDatesByIdDiet(
      req.params.id,
      req.body.minDate,
      req.body.maxDate,
      req.user.id
    );
    return res.send(dietDays);
  },

  // Auditoría de arquitectura (nutrición) — este era el endpoint REAL que
  // usa la app del cliente para leer su día (dietDayService
  // .getDietDayByIdDietAndDate), y hacía un fetch crudo sin pasar nunca por
  // resolveOwnedDietDay: aplicar un PlanAssignment a un cliente (F11)
  // nunca se reflejaba en nada — el día se creaba vacío desde el frontend
  // (fallback getStandardDietDay + createDietDay) sin resolver contra el
  // plan activo. resolveOwnedDietDay ya hacía exactamente esto (auto-crea +
  // resincroniza un día vacío con el plan activo, TASK-006), pero solo
  // estaba enganchado a acciones puntuales del trainer (prescribeMeal) y a
  // chooseDayType (Fase 9) — nunca a la lectura normal del cliente. De
  // paso cierra un IDOR: antes confiaba en `req.params.id` (un dietId
  // suelto del cliente) sin comprobar que perteneciera al usuario
  // autenticado; ahora se resuelve siempre contra `req.user.id`.
  async getDietDayByIdDietAndDate(req, res) {
    const dietDay = await resolveOwnedDietDay(req.user.id, req.body.date);

    // Also fetch anthropometry for this date
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      req.user.id,
      req.body.date
    );

    return res.send({ dietDay, anthropometry: anthropometry || null });
  },

  async createDietDay(req, res) {
    const dietDay = await dietDayModel.createDietDay({
      date: req.body.date,
      meals: req.body.meals,
    });

    return res.send(dietDay);
  },

  async createDayWeightOnNewDietDay(req, res) {
    const userId = req.user.id;
    const dietDay = await dietDayModel.createDayWeightOnNewDietDay(
      req.body.dayWeight,
      req.params.dietInUseId,
      req.body.currentDate,
      userId
    );
    
    // Also fetch the anthropometry that was just created
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      userId,
      req.body.currentDate
    );
    
    return res.send({ dietDay, anthropometry });
  },

  async createCustomProductOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createCustomProductOnNewDietDay(
      req.body.customProduct,
      req.body.indexMeal,
      req.params.dietInUseId,
      req.body.currentDate,
      req.body.idUser,
    );

    return res.send(dietDay);
  },

  async createCustomRecipeOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createCustomRecipeOnNewDietDay(
      req.body.customRecipe,
      req.body.indexMeal,
      req.params.dietInUseId,
      req.body.currentDate,
    );

    return res.send(dietDay);
  },

  async createOwnCustomRecipeOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createOwnCustomRecipeOnNewDietDay(
      req.params.idUser,
      req.body.customRecipe,
      req.body.date,
      req.body.indexMeal,
    );

    return res.send(dietDay);
  },

  async addDietDayMeal(req, res) {
    const dietDay = await dietDayModel.addDietDayMeal(
      req.params.idDietDay,
      req.params.idMeal,
    );

    return res.send(dietDay);
  },

  async updateDietDay(req, res) {
    const dietDay = await dietDayModel.updateDietDay(req.params.id, {
      notes: req.body.notes,
      date: req.body.date,
      meals: req.body.meals,
    });

    return res.send(dietDay);
  },

  async pasteDietDayByIdDiet(req, res) {
    const dietDay = await dietDayModel.pasteDietDayByIdDiet(
      req.params.id,
      req.body.dietDayClipboard,
      req.body.dietDayToPaste,
    );

    return res.send(dietDay);
  },

  async deleteDietDay(req, res) {
    await dietDayModel.deleteDietDay(req.params.idDiet, req.params.idDietDay);
    res.sendStatus(204);
  },

  async deleteDietDayMeal(req, res) {
    const dietDay = await dietDayModel.deleteDietDayMeal(
      req.params.iddietday,
      req.params.idmeal,
    );

    return res.send(dietDay);
  },

  // Fase 9 — GET /dietdays/date/:date/day-type. Sin ningún plan "choice"
  // activo para esta fecha (la inmensa mayoría de los usuarios, siempre)
  // devuelve needsChoice:false — el cliente nunca ve ningún prompt.
  async getDayType(req, res) {
    const userId = req.user.id;
    const date = req.params.date;
    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
    }

    const assignment = await planAssignmentService.findCoveringDate(userId, date);
    if (!assignment) return res.send({ needsChoice: false, selected: null, options: [] });

    const plan = await DietTemplate.findById(assignment.planId).select("mode dayPatterns").lean();
    if (!plan || plan.mode !== "choice") {
      return res.send({ needsChoice: false, selected: null, options: [] });
    }

    const options = (plan.dayPatterns || []).map((p) => p.name);
    const user = await userSchema.findById(userId).select("dietInUse").lean();
    const dietDay = await dietDayModel.findByIdDietAndDate(user?.dietInUse, date);
    const selected = dietDay?.dayTypeName || null;
    return res.send({ needsChoice: !selected, selected, options });
  },

  // Fase 9 — PUT /dietdays/date/:date/day-type. Reelegible: volver a llamar
  // sobrescribe el tipo de día y re-resuelve el plan (merge:false, mismo
  // criterio que cualquier otro re-pauteo, p.ej. prescribeMeal).
  async chooseDayType(req, res) {
    const userId = req.user.id;
    const date = req.params.date;
    const patternName = (req.body?.patternName || "").toString();
    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
    }
    if (!patternName) {
      return res.status(400).send({ message: "patternName es obligatorio" });
    }

    const assignment = await planAssignmentService.findCoveringDate(userId, date);
    if (!assignment) {
      return res.status(400).send({ message: "No hay ningún plan activo para esta fecha" });
    }
    const plan = await DietTemplate.findById(assignment.planId);
    if (!plan || plan.mode !== "choice" || !(plan.dayPatterns || []).some((p) => p.name === patternName)) {
      return res.status(400).send({ message: "Ese tipo de día no existe en el plan activo" });
    }

    const dietDayDoc = await resolveOwnedDietDay(userId, date);
    await dietDayModel.setDayTypeName(dietDayDoc._id, patternName);

    const result = await planResolver.resolvePlanForDate(userId, date, { chosenPatternName: patternName });
    if (result) {
      await applyResolvedPlanToDietDay(dietDayDoc, date, result.resolved, result.trainerId, userId);
    }

    const user = await require("../users/schema").findById(userId).select("dietInUse").lean();
    const updatedDietDay = await dietDayModel.findByIdDietAndDate(user?.dietInUse, date);
    return res.send(updatedDietDay);
  },
};

module.exports = controller;