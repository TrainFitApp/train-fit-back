const anthropometryService = require("../anthropometry/anthropometry-service");
const dietDayService = require("./diet-days-service");
const mealService = require("../meals/meal-service");
const { resolveOwnedDietDay, applyResolvedPlanToDietDay } = require("./diet-day-resolver");
const dietPhaseService = require("../dietPhases/diet-phase-service");
const planResolver = require("../dietPhases/diet-phase-resolver");
const { computeDayTracking } = require("./diet-days-nutrition-util");
const { clearPlannedDay, isDaySkipped } = require("./diet-skips");
const { buildMenuPreviews } = require("./menu-preview");
const { shoppingRange } = require("./shopping-list-service");
const { weekForClientAt } = require("../dietPhases/week-service");
const { todayIsoDate } = require("../util/date-util");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Toda lectura o escritura sobre "el día de tal fecha" necesita una fecha
// válida: sin ella el día se crearía con una fecha basura y dejaría de
// encontrarse por (userId, date), que es la clave del módulo. Devuelve null y
// responde 400.
const requireIsoDate = (req, res) => {
  const date = req.params?.date;
  if (ISO_DATE.test(date || "")) return date;

  res.status(400).send({ message: "Fecha inválida (YYYY-MM-DD)" });
  return null;
};

const requireMealIndex = (req, res) => {
  const mealIndex = Number(req.params?.mealIndex);
  if (Number.isInteger(mealIndex) && mealIndex >= 0) return mealIndex;

  res.status(400).send({ message: "Comida inválida" });
  return null;
};

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
    const range = shoppingRange(req.query, todayIsoDate(req.auth.timeZone));
    if (!range) return res.status(400).send({ message: "Rango inválido (YYYY-MM-DD, máx. 62 días)" });
    return res.send(await dietDayService.getShoppingList(req.user.id, range.from, range.to));
  },

  // GET /dietdays/timeline?from&to — fases (color estable por orden de
  // inicio) y ventanas de semana del propio cliente.
  async getMyDietTimeline(req, res) {
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from y to (YYYY-MM-DD) son obligatorios" });
    }
    return res.send(await dietPhaseService.getDietTimeline(req.user.id, from, to));
  },

  async getDietDays(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const dietDays = await dietDayService.getDietDays(page, limit);
    return res.send(dietDays);
  },

  // GET /dietdays/range?from&to — los días del propio usuario (con su peso)
  // para el calendario y el peso diario.
  async getMyDietDaysInRange(req, res) {
    const { from, to } = req.query || {};
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) {
      return res.status(400).send({ message: "from y to (YYYY-MM-DD) son obligatorios" });
    }
    return res.send(await dietDayService.getDietDaysBetweenDatesByUser(req.user.id, from, to));
  },

  // PUT /dietdays/pinned-note — la nota fijada de la pantalla de dieta.
  async setPinnedNote(req, res) {
    const notes = (req.body?.notes ?? "").toString();
    return res.send(await dietDayService.setPinnedNote(req.user.id, notes));
  },

  // POST /dietdays/date/:date — el día del usuario en esa fecha, con el plan
  // ya aplicado. resolveOwnedDietDay lo crea si no existe y resincroniza un
  // día vacío con el plan vigente, así que pautar una fase a un cliente se
  // ve en su día sin más. Junto al día: su peso, la meta pautada (lo que
  // suma lo pautado; null = nada pautado) y la semana de la fase.
  async getDay(req, res) {
    const date = requireIsoDate(req, res);
    if (!date) return;

    const dietDay = await resolveOwnedDietDay(req.user.id, date);
    const anthropometry = await anthropometryService.getAnthropometryByUserIdAndDate(req.user.id, date, { ownOnly: true });

    const tracking = computeDayTracking(dietDay?.meals);
    const plannedTarget = tracking.hasPlan
      ? {
          kcal: Math.round(tracking.planned.kcal),
          protein: Math.round(tracking.planned.protein * 10) / 10,
          carbs: Math.round(tracking.planned.carbs * 10) / 10,
          fat: Math.round(tracking.planned.fat * 10) / 10,
        }
      : null;
    const week = await weekForClientAt(req.user.id, date);

    return res.send({
      dietDay,
      anthropometry: anthropometry || null,
      plannedTarget,
      week: week
        ? { phaseId: week.phaseId, number: week.number, start: week.start, end: week.end }
        : null,
    });
  },

  // Añadir un alimento a una comida de una fecha, en UNA llamada: el día se
  // resuelve (o se crea) y el producto se añade dentro de la misma petición,
  // así que dos añadidos seguidos a una fecha sin día nunca dejan dos días.
  async addCustomProductToDay(req, res) {
    const date = requireIsoDate(req, res);
    if (!date) return;
    const mealIndex = requireMealIndex(req, res);
    if (mealIndex === null) return;

    const dietDay = await resolveOwnedDietDay(req.user.id, date);
    return res.send(await dietDayService.addCustomProductToMeal(dietDay, mealIndex, req.body?.customProduct, req.user.id));
  },

  // PUT /dietdays/date/:date/notes — la nota del día, asegurando el día en
  // la misma llamada.
  async setNotes(req, res) {
    const date = requireIsoDate(req, res);
    if (!date) return;

    await resolveOwnedDietDay(req.user.id, date);
    return res.send(await dietDayService.setNotes(req.user.id, date, req.body?.notes));
  },

  // PUT /dietdays/date/:date/paste — pega sobre el día de esa fecha las
  // comidas del portapapeles. No se puede pegar encima de comida pautada.
  async pasteDay(req, res) {
    const date = requireIsoDate(req, res);
    if (!date) return;

    const target = await dietDayService.findByUserAndDate(req.user.id, date);
    mealService.assertDayPasteAllowed(target);

    return res.send(await dietDayService.pasteDietDayByUser(req.user.id, req.body?.dietDayClipboard, date));
  },

  // DELETE /dietdays/date/:date — borra el día de esa fecha (sus comidas van
  // dentro).
  async deleteDay(req, res) {
    const date = requireIsoDate(req, res);
    if (!date) return;

    await dietDayService.deleteDietDay(req.user.id, date);
    res.sendStatus(204);
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

    const menus = await dietPhaseService.menusAt(userId, date);
    if (!menus?.length) {
      return res.send({ needsChoice: false, selected: null, options: [], skipped: false });
    }

    // Día saltado por el profesional: no hay nada que elegir, y decirlo
    // evita que el cliente elija un menú que no le va a pautar nada.
    if (await isDaySkipped(userId, date)) {
      return res.send({ needsChoice: false, selected: null, options: [], skipped: true });
    }

    const options = menus.map((m) => m.name);
    // Preview de cada menú (solo lectura) para que el cliente vea qué hay
    // antes de elegir: comidas con sus alimentos, cantidades y alternativas
    // (ver menu-preview.js).
    const previews = buildMenuPreviews(menus);
    const dietDay = await dietDayService.findByUserAndDate(userId, date);
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
    const dietDay = await dietDayService.findByUserAndDate(userId, date);
    if (!dietDay) return res.status(404).send({ message: "No hay día registrado en esa fecha" });

    // Mismo vaciado que usa "marcar día saltado" del profesional.
    await clearPlannedDay(userId, date, dietDay);

    const updated = await dietDayService.findByUserAndDate(userId, date);
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

    const menus = await dietPhaseService.menusAt(userId, date);
    if (!menus) {
      return res.status(400).send({ message: "No hay ningún plan activo para esta fecha" });
    }
    if (!menus.some((m) => m.name === menuName)) {
      return res.status(400).send({ message: "Ese menú no existe en el plan activo" });
    }
    if (await isDaySkipped(userId, date)) {
      return res.status(409).send({ message: "Ese día está marcado como saltado por tu profesional" });
    }

    const dietDayDoc = await resolveOwnedDietDay(userId, date);
    await dietDayService.setMenuName(dietDayDoc._id, menuName);

    // clearMissing: los huecos que el menú nuevo no tiene se vacían de lo
    // pautado por el anterior (lo que el cliente añadió se queda). Sin esto
    // conservaban la comida del menú viejo, que seguía sumando en la meta.
    const result = await planResolver.resolvePlanForDate(userId, date, { chosenMenuName: menuName });
    if (result) {
      await applyResolvedPlanToDietDay(dietDayDoc, date, result.resolved, result.trainerId, userId, { clearMissing: true });
    }

    const updatedDietDay = await dietDayService.findByUserAndDate(userId, date);
    return res.send(updatedDietDay);
  },
};

module.exports = controller;