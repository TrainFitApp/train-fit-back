const anthropometryModel = require("../anthropometry/anthropometry-service");
const dietDayModel = require("./diet-days-service");
const { resolveOwnedDietDay, applyResolvedPlanToDietDay } = require("./diet-day-resolver");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const planResolver = require("../planAssignments/plan-resolver");
const userSchema = require("../users/schema");
const dietDaysDao = require("./diet-days-dao");
const { buildShoppingList } = require("./shopping-list-service");
const { todayIsoDate, addDaysToIsoDate } = require("../util/date-util");
const { computeDayTracking } = require("./diet-days-nutrition-util");
const { clearPlannedDay, isDaySkipped } = require("./diet-skips");
const { weekForClientAt } = require("../planAssignments/week-service");

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
    const from = req.query.from || todayIsoDate();
    // Una semana por defecto: es como se hace la compra.
    const to = req.query.to || addDaysToIsoDate(from, 6);

    // Refactor nutrición (2026-09) — ya no hace falta leer antes el usuario
    // para sacar su dietInUse: los días se consultan por dueño directo.
    const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(req.user.id, from, to);
    return res.send({ ...buildShoppingList(days), period: { from, to } });
  },

  // GET /dietdays/timeline?from&to — fases (color estable por orden de
  // inicio) y ventanas de semana del propio cliente.
  async getMyDietTimeline(req, res) {
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from y to (YYYY-MM-DD) son obligatorios" });
    }
    return res.send(await planAssignmentService.getDietTimeline(req.user.id, from, to));
  },

  async getDietDays(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const dietDays = await dietDayModel.getDietDays(page, limit);
    return res.send(dietDays);
  },

  // La ruta sigue llevando :id (el viejo dietId) para no romper las apps ya
  // instaladas, pero se ignora: el dueño sale del token.
  async getDietDaysBetweenDatesByUser(req, res) {
    const dietDays = await dietDayModel.getDietDaysBetweenDatesByUser(
      req.user.id,
      req.body.minDate,
      req.body.maxDate,
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

    // La meta del día es lo que suma lo PAUTADO ese día, no un objetivo
    // guardado aparte. null = nada pautado (sin plan, o sin
    // menú elegido todavía).
    const tracking = computeDayTracking(dietDay?.meals);
    const plannedTarget = tracking.hasPlan
      ? {
          kcal: Math.round(tracking.planned.kcal),
          protein: Math.round(tracking.planned.protein * 10) / 10,
          carbs: Math.round(tracking.planned.carbs * 10) / 10,
          fat: Math.round(tracking.planned.fat * 10) / 10,
        }
      : null;
    const week = await weekForClientAt(req.user.id, req.body.date);

    return res.send({
      dietDay,
      anthropometry: anthropometry || null,
      plannedTarget,
      week: week
        ? { phaseId: week.phaseId, number: week.number, start: week.start, end: week.end }
        : null,
    });
  },

  async createDietDay(req, res) {
    const dietDay = await dietDayModel.createDietDay({
      // Sin userId el día nacería huérfano: no lo encontraría ninguna
      // consulta por dueño y quedaría fuera de la cascada de borrado.
      userId: req.user.id,
      date: req.body.date,
      meals: req.body.meals,
    });

    return res.send(dietDay);
  },

  async createDayWeightOnNewDietDay(req, res) {
    const userId = req.user.id;
    const dietDay = await dietDayModel.createDayWeightOnNewDietDay(
      req.body.dayWeight,
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
      req.body.currentDate,
      // El dueño es SIEMPRE el del token, nunca un id del body: si no,
      // cualquiera podría crear días en la dieta de otro.
      req.user.id,
    );

    return res.send(dietDay);
  },

  async createCustomRecipeOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createCustomRecipeOnNewDietDay(
      req.body.customRecipe,
      req.body.indexMeal,
      req.user.id,
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

  async pasteDietDayByUser(req, res) {
    const dietDay = await dietDayModel.pasteDietDayByUser(
      req.user.id,
      req.body.dietDayClipboard,
      req.body.dietDayToPaste,
    );

    return res.send(dietDay);
  },

  async deleteDietDay(req, res) {
    await dietDayModel.deleteDietDay(req.params.idDietDay);
    res.sendStatus(204);
  },

  async deleteDietDayMeal(req, res) {
    const dietDay = await dietDayModel.deleteDietDayMeal(
      req.params.iddietday,
      req.params.idmeal,
    );

    return res.send(dietDay);
  },

  // GET /dietdays/date/:date/menu. Sin plan activo para esta fecha (la
  // inmensa mayoría de los usuarios, siempre) devuelve needsChoice:false —
  // el cliente nunca ve ningún prompt.
  async getMenu(req, res) {
    const userId = req.user.id;
    const date = req.params.date;
    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
    }

    const plan = await planAssignmentService.findCoveringDate(userId, date);
    if (!plan || !(plan.menus || []).length) {
      return res.send({ needsChoice: false, selected: null, options: [], skipped: false });
    }

    // Día saltado por el profesional: no hay nada que elegir, y decirlo
    // evita que el cliente elija un menú que no le va a pautar nada.
    if (await isDaySkipped(userId, date)) {
      return res.send({ needsChoice: false, selected: null, options: [], skipped: true });
    }

    const options = plan.menus.map((m) => m.name);
    // Preview de cada menú (solo lectura) para que el cliente vea qué hay
    // antes de elegir: comidas con sus alimentos y cantidades. La 1ª
    // alternativa de cada comida; las demás llegan como propuestas al
    // elegir (ver applyResolvedPlanToDietDay).
    const previews = plan.menus.map((menu) => ({
      name: menu.name,
      meals: (menu.meals || []).map((m) => {
        const alt = (m.alternatives || [])[0] || {};
        const round = (q) => (Number.isFinite(Number(q)) ? Math.round(Number(q) * 10) / 10 : null);
        return {
          name: m.slot || m.name || "",
          items: [
            ...(alt.customProducts || []).map((cp) => ({
              name: cp?.product?.name || cp?.name || "",
              quantity: round(cp?.quantity),
              unit: cp?.product?.unit || "g",
            })),
            ...(alt.customRecipes || []).map((cr) => ({
              name: cr?.recipe?.name || cr?.name || "",
              quantity: round(cr?.quantity),
              unit: "ración",
            })),
          ],
        };
      }),
    }));
    const dietDay = await dietDayModel.findByUserAndDate(userId, date);
    const selected = dietDay?.menuName || null;
    return res.send({ needsChoice: !selected, selected, options, previews, skipped: false });
  },

  // DELETE /dietdays/date/:date/menu: "salir del menú". El día vuelve a
  // quedar sin menú; se quita lo pautado y sus marcas, lo que el cliente
  // anotó por su cuenta se queda.
  async leaveMenu(req, res) {
    const userId = req.user.id;
    const date = req.params.date;
    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
    }
    const dietDay = await dietDayModel.findByUserAndDate(userId, date);
    if (!dietDay) return res.status(404).send({ message: "No hay día registrado en esa fecha" });

    // Mismo vaciado que usa "marcar día saltado" del profesional.
    await clearPlannedDay(userId, date, dietDay);

    const updated = await dietDayModel.findByUserAndDate(userId, date);
    return res.send(updated);
  },

  // PUT /dietdays/date/:date/menu. Reelegible: volver a llamar sobrescribe
  // el menú del día y re-resuelve el plan (merge:false, mismo criterio que
  // cualquier otro re-pauteo, p.ej. prescribeMeal).
  async chooseMenu(req, res) {
    const userId = req.user.id;
    const date = req.params.date;
    const menuName = (req.body?.menuName || "").toString();
    if (!ISO_DATE.test(date || "")) {
      return res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
    }
    if (!menuName) {
      return res.status(400).send({ message: "menuName es obligatorio" });
    }

    const plan = await planAssignmentService.findCoveringDate(userId, date);
    if (!plan) {
      return res.status(400).send({ message: "No hay ningún plan activo para esta fecha" });
    }
    if (!(plan.menus || []).some((m) => m.name === menuName)) {
      return res.status(400).send({ message: "Ese menú no existe en el plan activo" });
    }
    if (await isDaySkipped(userId, date)) {
      return res.status(409).send({ message: "Ese día está marcado como saltado por tu profesional" });
    }

    const dietDayDoc = await resolveOwnedDietDay(userId, date);
    await dietDayModel.setMenuName(dietDayDoc._id, menuName);

    const result = await planResolver.resolvePlanForDate(userId, date, { chosenMenuName: menuName });
    if (result) {
      await applyResolvedPlanToDietDay(dietDayDoc, date, result.resolved, result.trainerId, userId);
    }

    const updatedDietDay = await dietDayModel.findByUserAndDate(userId, date);
    return res.send(updatedDietDay);
  },
};

module.exports = controller;