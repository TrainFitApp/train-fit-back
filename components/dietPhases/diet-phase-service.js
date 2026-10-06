const dietPhaseDao = require("./diet-phase-dao");
const dietTemplateService = require("../dietTemplates/diet-template-service");
const { copyMenus, materializeMenus, sanitizeMenus } = require("../dietTemplates/diet-menus");
const { contentMacroProfile } = require("../dietTemplates/diet-macro-profile");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const dietDaysService = require("../dietDays/diet-days-service");
const { resyncPlannedDays } = require("../dietDays/diet-day-resolver");
const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { summarizeDailyDeviations } = require("../dietDays/food-compliance");
const { listSkippedDates, markDaySkipped } = require("../dietDays/diet-skips");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const checkinDao = require("../trainerCheckins/checkin-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const planChangeService = require("../planChanges/plan-change-service");
const { stepsFromHabit, needSnapshot } = require("./week-need");
const { suggestNextWeek, scaleFactor, scaleMealsContent } = require("./week-progression");
const { contentAt, contentEnd, contentSignature } = require("./week-content");
const { weeksOfPhase } = require("./week-service");
const { currentWeek, nextWeek } = require("./week-window");
const { buildPhaseEvents, sortEvents } = require("./nutrition-history");
const { addDaysToIsoDate, daysElapsed } = require("../util/date-util");
const { cutEndDate, sortChain, successorOf, withStates } = require("../util/phase-chain");
const { todayForUser } = require("../users/user-time-zone");
const { badRequest, conflict, notFound } = require("../util/http-error");

// Fases de dieta de un cliente (diet-phase-schema.js). "Hoy" es siempre el
// del cliente, en su zona horaria.

const phaseNotFound = () => notFound("Fase no encontrada", "DIET_PHASE_NOT_FOUND");
const noNextWeek = () =>
  notFound("La fase termina esta semana: no hay una semana siguiente que preparar.", "DIET_NO_NEXT_WEEK");

const toPlain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);
const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);

// --- Cadena de fases ---

/**
 * ¿Esta fase existente impide colocar una nueva que empieza en `startDate`?
 *
 * Solapar NO basta para bloquear: cambiarle el plan al cliente A PARTIR DE YA
 * es el caso normal, y se resuelve cortando la que estaba corriendo. Lo que se
 * rechaza es PROGRAMAR una fase futura encima de una que sigue abierta (o
 * dentro del tramo de una ya cortada). `today` se inyecta para testearla sin
 * reloj; `rulingPhaseId` es la fase que rige en `startDate` si es hoy o antes.
 */
function blocksNewPhase(existing, startDate, today, rulingPhaseId = null) {
  if (startDate > today) return true;
  if (rulingPhaseId && sameId(existing, rulingPhaseId)) return false;
  // Empezar hoy (o con fecha pasada) sobre la fase que está corriendo siempre
  // se permite: es la forma de cerrarla cuando el cliente evoluciona distinto
  // de lo previsto.
  const running = existing.endDate == null && existing.startDate <= startDate;
  return !running;
}

/**
 * Deja sitio para una fase que empieza en `startDate` y devuelve la que
 * queda antes de ella en la cadena (a la que hay que cortar), o null.
 *
 * La fase que rige ese día (si es hoy o antes) se corta, no bloquea, y pierde
 * las semanas que tenía preparadas desde esa fecha: con otra fase encima
 * nunca van a correr.
 */
async function reserveSlot(clientId, startDate) {
  const today = await todayForUser(clientId);
  const ruling = startDate <= today ? await dietPhaseDao.findCoveringDate(clientId, startDate) : null;
  const overlapping = await dietPhaseDao.findOverlapping(clientId, startDate, null);
  const clash = overlapping.find((phase) => blocksNewPhase(phase, startDate, today, ruling?._id));
  if (clash) {
    // Accionable, no solo "no puedes": el camino para cambiar de plan es
    // empezar hoy (corta la anterior), y eso no se adivina.
    const until = clash.endDate ? `hasta el ${clash.endDate}` : "indefinida";
    throw conflict(
      `Esas fechas caen dentro de «${clash.name}» (desde el ${clash.startDate}, ${until}). ` +
        "Empiézala hoy para cortarla, o elige una fecha posterior.",
      "PLAN_OVERLAP"
    );
  }

  if (ruling) {
    await dietPhaseDao.mutate(ruling._id, (phase) => {
      const contents = phase.contents.filter((content, index) => index === 0 || content.startDate < startDate);
      return contents.length === phase.contents.length ? null : { contents };
    });
    return ruling;
  }
  return dietPhaseDao.findLatest(clientId, { populate: false });
}

// La anterior termina el día antes de que empiece la nueva — su fin REAL — si
// seguía abierta o acababa después; si ya había acabado antes (hueco entre
// fases), se queda como estaba. Nunca antes de su propio inicio: sustituirla
// el mismo día en que empezó la deja cubriendo ese día (y findCoveringDate da
// la más reciente).
async function chain(previous, created) {
  if (!previous || sameId(previous, created)) return;
  if (previous.endDate != null && previous.endDate < created.startDate) return;
  await dietPhaseDao.setEndDate(previous._id, cutEndDate(previous, created.startDate));
}

// --- Necesidad del cliente (docs/plan-semanas.md) ---

// Pasos del cliente: los que pauta su HÁBITO de pasos y los días que lo marcó
// dentro de la ventana. Sin hábito, o marcado menos de la mitad de los días,
// manda el rango de su perfil: no se inventa un dato que el cliente no ha dado.
async function stepsForWindow(clientId, window, until) {
  const task = await trainerTaskDao.findActiveStepsTask(clientId);
  if (!task || !window) return null;
  const end = window.end && (!until || window.end < until) ? window.end : until;
  if (!end || end < window.start) return null;
  const completions = await trainerTaskDao.listCompletionsForTasksInRange([task._id], window.start, end);
  return stepsFromHabit(task, completions.length, window, until);
}

// Necesidad con el último peso hasta `asOf` (undefined = el último que haya),
// los pasos de la ventana `window` hasta `until` y los g/kg de la fase.
async function computeNeed(clientId, macros, { asOf, window, until = asOf }) {
  const steps = await stepsForWindow(clientId, window, until);
  const resolved = await resolveClientNutritionTarget(
    clientId,
    0,
    { proteinPerKg: macros.proteinPerKg ?? undefined, fatPerKg: macros.fatPerKg ?? undefined },
    { asOf, stepsRangeKey: steps?.key || null, useClientObjetive: true }
  );
  const snapshot = needSnapshot(resolved);
  return snapshot ? { ...snapshot, stepsFromHabit: steps } : null;
}

// Snapshot que se guarda al EMPEZAR la fase, con los datos de ese momento
// (el peso hasta su inicio si ya ha llegado; si es futura, el último). Aún no
// hay semanas corridas: los pasos se miran en los 14 días anteriores.
async function needAtStart(clientId, macros, startDate) {
  const today = await todayForUser(clientId);
  const asOf = startDate <= today ? startDate : undefined;
  const until = asOf || today;
  return computeNeed(clientId, macros, { asOf, window: { start: addDaysToIsoDate(until, -14), end: until }, until });
}

// --- Semanas ---

function profileOf(content) {
  const profile = contentMacroProfile(content);
  return { kcal: profile.kcal, protein: profile.protein, carbs: profile.carbs, fat: profile.fat };
}

function contentSummary(content) {
  return {
    id: String(content._id),
    startDate: content.startDate,
    menusCount: (content.menus || []).length,
    profile: profileOf(content),
  };
}

async function getPhase(clientId, phaseId) {
  const phase = await dietPhaseDao.findForClient(phaseId, clientId);
  if (!phase) throw phaseNotFound();
  return phase;
}

async function loadPhase(clientId, phaseId) {
  const phase = await getPhase(clientId, phaseId);
  const today = await todayForUser(clientId);
  const weeks = weeksOfPhase(phase, today);
  const current = currentWeek(weeks, today);
  const next = current ? nextWeek(weeks, current) : null;
  return { phase, today, weeks, current, next };
}

// Último peso registrado (antropometría, donde también va el del check-in)
// dentro de una ventana, o null.
async function lastWeightIn(clientId, window, until) {
  const rows = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(clientId, window.start, window.end || until);
  const withWeight = (rows || []).filter((row) => Number.isFinite(row.weight)).sort((a, b) => a.date.localeCompare(b.date));
  const last = withWeight[withWeight.length - 1];
  return last ? { weightKg: last.weight, date: last.date } : null;
}

// Sugerencia para la semana siguiente: el peso de la semana en curso frente
// al de la última anterior que tenga peso, y la adherencia de la semana en
// curso. Nunca bloquea: con adherencia baja avisa, pero calcula igual.
async function buildSuggestion(clientId, phase, weeks, current, today, need) {
  const weightNow = await lastWeightIn(clientId, current, today);
  let weightBefore = null;
  let comparedTo = null;
  const index = weeks.findIndex((week) => week.number === current.number);
  for (let i = index - 1; i >= 0 && !weightBefore; i--) {
    weightBefore = await lastWeightIn(clientId, weeks[i], today);
    if (weightBefore) comparedTo = weeks[i].number;
  }

  const until = today < current.end ? today : current.end;
  const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, current.start, until);
  const adherence = computeRangeAdherence(days, Math.max(1, daysElapsed(current.start, until) + 1));

  const suggestion = suggestNextWeek({
    currentKcal: profileOf(contentAt(phase.contents, current.start)).kcal,
    // El gasto (no el objetivo): lo que separa a las kcal pautadas del gasto
    // ES el déficit o superávit con el que se pautó.
    needKcal: need?.breakdown?.expenditure ?? null,
    weightStartKg: weightBefore?.weightKg ?? null,
    weightEndKg: weightNow?.weightKg ?? null,
    daysElapsed: weightBefore && weightNow ? daysElapsed(weightBefore.date, weightNow.date) : 0,
    adherencePct: adherence.percentage,
  });

  return {
    ...suggestion,
    weightStartKg: weightBefore?.weightKg ?? null,
    weightEndKg: weightNow?.weightKg ?? null,
    comparedToWeek: comparedTo,
    adherencePct: adherence.percentage,
    adherenceDays: adherence.daysWithData,
    deviations: summarizeDailyDeviations(days),
  };
}

const earliest = (...dates) => dates.filter(Boolean).sort()[0];
// null = abierta, que gana a cualquier fecha.
const latestEnd = (...dates) => (dates.some((date) => date == null) ? null : dates.sort().pop());

module.exports = {
  // Exportada para test unitario: es la regla con criterio propio.
  blocksNewPhase,

  /**
   * Empieza una fase para el cliente: con la copia de una plantilla de su
   * biblioteca (`templateId`) o con menús construidos para él (`menus`). Si
   * ya tenía una, la corta (encadenado de fases) — "aplicar un plan nuevo" y
   * "programar la siguiente fase" son la MISMA operación.
   *
   * `target`, `proteinPerKg`, `fatPerKg`: con qué números se pauta (los
   * calculados del cliente o los tecleados en el cajón).
   */
  async createPhase({ trainerId, clientId, startDate, templateId, name, menus, target, proteinPerKg, fatPerKg, reason }) {
    let sourceTemplateId = null;
    let firstMenus;
    if (templateId) {
      const template = await dietTemplateService.getOwned(trainerId, templateId);
      sourceTemplateId = template._id;
      firstMenus = await copyMenus(template.menus);
      name = name || template.name;
    } else {
      if (!name) throw badRequest("El nombre es obligatorio");
      firstMenus = await materializeMenus(sanitizeMenus(menus));
    }

    const previousLatest = await dietPhaseDao.findLatest(clientId, { populate: false });
    const previous = await reserveSlot(clientId, startDate);
    const macros = { proteinPerKg: proteinPerKg ?? null, fatPerKg: fatPerKg ?? null };
    const created = await dietPhaseDao.create({
      clientId,
      trainerId,
      name,
      sourceTemplateId,
      startDate,
      ...(target ? { target } : {}),
      ...macros,
      need: (await needAtStart(clientId, macros, startDate)) || undefined,
      contents: [{ startDate, menus: firstMenus }],
    });
    await chain(previous, created);

    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment: previousLatest,
      newAssignment: created,
      planName: created.name,
      reason,
    });
    await resyncPlannedDays(clientId, startDate, null);
    return created;
  },

  getPhase,

  async listForClient(clientId) {
    return dietPhaseDao.listByClient(clientId, { populate: false });
  },

  async listWithStates(clientId) {
    const [phases, today] = await Promise.all([
      dietPhaseDao.listByClient(clientId, { populate: false }),
      todayForUser(clientId),
    ]);
    return withStates(phases, today);
  },

  // La fase que rige hoy (por fecha, no por status: una fase programada para
  // más adelante ya es la última de la cadena, pero hoy rige la anterior), y
  // cuántos días de ella el cliente nunca eligió menú (plan atascado).
  async getCurrent(clientId) {
    const today = await todayForUser(clientId);
    const phase = await dietPhaseDao.findCoveringDate(clientId, today);
    if (!phase) return null;
    const stuckDaysCount = await dietDaysService.countDaysWithoutChoice(clientId, phase.startDate, today);
    return { phase, stuckDaysCount };
  },

  async findCoveringDate(clientId, date) {
    return dietPhaseDao.findCoveringDate(clientId, date);
  },

  // Los menús entre los que el cliente elige en esa fecha (la versión del
  // contenido que rige ese día), o null si ninguna fase la cubre.
  async menusAt(clientId, date) {
    const phase = await dietPhaseDao.findCoveringDate(clientId, date);
    return phase ? contentAt(phase.contents, date)?.menus || [] : null;
  },

  /**
   * Renombrar la fase y/o mover sus fechas. Mover fechas no corta a nadie (a
   * diferencia de empezar una fase hoy): si pisa otra fase, se rechaza. El
   * contenido preparado se mueve con la fase el mismo número de días, y el
   * que quede después del fin nuevo sobra.
   */
  async updatePhase({ clientId, phaseId, name, startDate, endDate }) {
    const phase = await getPhase(clientId, phaseId);
    const nextStart = startDate || phase.startDate;
    const nextEnd = endDate === undefined ? phase.endDate : endDate;
    if (nextEnd && nextEnd < nextStart) throw conflict("El fin de la fase no puede ser anterior a su inicio", "PLAN_INVALID_RANGE");

    const datesChange = nextStart !== phase.startDate || nextEnd !== phase.endDate;
    if (datesChange) {
      const clash = (await dietPhaseDao.findOverlapping(clientId, nextStart, nextEnd, { excludeId: phase._id }))[0];
      if (clash) {
        throw conflict(
          `Esas fechas se solapan con «${clash.name}» (desde el ${clash.startDate}${clash.endDate ? `, hasta el ${clash.endDate}` : ""}).`,
          "PLAN_OVERLAP"
        );
      }
    }

    const shift = daysElapsed(phase.startDate, nextStart);
    const updated = await dietPhaseDao.mutate(phase._id, (current) => {
      const changes = {};
      if (name !== undefined && name !== current.name) changes.name = name;
      if (datesChange) {
        changes.startDate = nextStart;
        changes.endDate = nextEnd;
        changes.contents = current.contents
          .map((content) => ({ ...content, startDate: addDaysToIsoDate(content.startDate, shift) }))
          .filter((content, index) => index === 0 || !nextEnd || content.startDate <= nextEnd);
      }
      return Object.keys(changes).length ? changes : null;
    });

    if (datesChange) {
      await resyncPlannedDays(clientId, earliest(phase.startDate, nextStart), latestEnd(phase.endDate, nextEnd));
    }
    return updated;
  },

  // Editar el contenido de una versión (la primera o una semana preparada).
  // Los días que el cliente ya tenía abiertos dentro de ella lo recogen.
  async updateContent({ clientId, phaseId, contentId, menus }) {
    const phase = await getPhase(clientId, phaseId);
    const content = phase.contents.find((candidate) => sameId(candidate, contentId));
    if (!content) throw notFound("Contenido no encontrado", "DIET_CONTENT_NOT_FOUND");
    const nextMenus = await materializeMenus(sanitizeMenus(menus));
    const updated = await dietPhaseDao.mutate(phase._id, (current) => ({
      contents: current.contents.map((candidate) => (sameId(candidate, contentId) ? { ...candidate, menus: nextMenus } : candidate)),
    }));
    await resyncPlannedDays(clientId, content.startDate, contentEnd(phase, content));
    return updated;
  },

  /**
   * Quitar CUALQUIER fase (futura, pasada o la vigente): "me he equivocado",
   * el cliente cambia de objetivo. Si era la última de la cadena y había
   * cortado a la anterior, la anterior vuelve a quedar abierta. Los días que
   * el cliente ya había abierto con ella se vacían de lo pautado y recogen lo
   * que rija.
   */
  async cancelPhase({ trainerId, clientId, phaseId, reason }) {
    const phase = await getPhase(clientId, phaseId);
    const chainPhases = sortChain(await dietPhaseDao.listByClient(clientId, { populate: false }));
    const index = chainPhases.findIndex((candidate) => sameId(candidate, phase));
    const previous = index > 0 ? chainPhases[index - 1] : null;
    const wasLatest = index === chainPhases.length - 1;
    await dietPhaseDao.deleteById(phase._id);

    let reopened = null;
    if (wasLatest && previous && previous.endDate === cutEndDate(previous, phase.startDate)) {
      reopened = await dietPhaseDao.setEndDate(previous._id, null);
    }

    await resyncPlannedDays(clientId, phase.startDate, reopened ? null : phase.endDate);
    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment: phase,
      newAssignment: reopened,
      planName: reopened?.name,
      reason,
    });
  },

  // Ese día el cliente no sigue el plan: se vacía de lo pautado y deja de
  // contar. Lo que anotó por su cuenta se queda.
  async skipDay(clientId, date) {
    if (!(await dietPhaseDao.findCoveringDate(clientId, date))) {
      throw badRequest("Este cliente no tiene una fase de dieta en esa fecha");
    }
    const skipped = await markDaySkipped(clientId, date);
    if (!skipped) throw notFound("No hay día registrado en esa fecha");
    return skipped;
  },

  // --- Semanas (docs/plan-semanas.md) ---
  //
  // Una fase se parte en SEMANAS naturales de lunes a domingo. No hay un
  // contenido por semana: cada una hereda de la última versión que ya empezó.

  // Todo lo que la ficha necesita: semana en curso, siguiente (con sugerencia)
  // y pasadas. La necesidad se calcula con los pasos de la semana EN CURSO.
  async getPhaseWeeks(clientId, phaseId) {
    const { phase, today, weeks, current, next } = await loadPhase(clientId, phaseId);
    const need = await computeNeed(clientId, phase, { asOf: today, window: current });
    const suggestion = current ? await buildSuggestion(clientId, phase, weeks, current, today, need) : null;
    const nextPrepared = next ? phase.contents.find((content) => content.startDate === next.start) || null : null;
    const currentContent = contentAt(phase.contents, current ? current.start : phase.startDate);

    return {
      phaseId: String(phase._id),
      phaseName: phase.name,
      phaseStart: phase.startDate,
      phaseEnd: phase.endDate,
      target: phase.target || null,
      weeks: weeks.map((week) => ({ number: week.number, start: week.start, end: week.end })),
      current: current
        ? { number: current.number, start: current.start, end: current.end, content: contentSummary(currentContent) }
        : null,
      next: next
        ? {
            number: next.number,
            start: next.start,
            end: next.end,
            content: nextPrepared ? contentSummary(nextPrepared) : null,
            inherits: nextPrepared ? null : contentSummary(currentContent),
            suggestion,
            needNow: need,
          }
        : null,
      past: weeks
        .filter((week) => !current || week.number < current.number)
        .map((week) => {
          const content = contentAt(phase.contents, week.start);
          return { number: week.number, start: week.start, end: week.end, profile: profileOf(content), contentId: String(content._id) };
        }),
    };
  },

  // Cómo se calculó la necesidad de UNA semana: la primera usa el snapshot
  // guardado al empezar la fase; el resto se calcula al vuelo a su fecha de
  // inicio, con los pasos de la semana anterior (la que ya cerró).
  async getWeekNeed(clientId, phaseId, number) {
    const { phase, today, weeks, current } = await loadPhase(clientId, phaseId);
    const window = weeks.find((week) => week.number === number);
    if (!window) throw notFound("Semana no encontrada", "DIET_WEEK_NOT_FOUND");

    const fromSnapshot = number === 1 && phase.need;
    const need = fromSnapshot
      ? toPlain(phase.need)
      : await computeNeed(clientId, phase, {
          asOf: window.start > today ? today : window.start,
          window: weeks.find((week) => week.number === number - 1) || null,
        });

    return {
      weekNumber: number,
      start: window.start,
      end: window.end,
      isCurrent: current ? number === current.number : false,
      source: fromSnapshot ? "snapshot" : "computed",
      need,
      // Una semana puede contener varios check-ins: van todos, del más
      // reciente al más antiguo.
      checkins: await checkinDao.listWeekResponses(clientId, phase._id, number),
      plannedKcal: profileOf(contentAt(phase.contents, window.start)).kcal || null,
      target: phase.target || null,
    };
  },

  // Contenido vigente escalado a `kcal`, para abrir el constructor precargado
  // al preparar la semana siguiente. No escribe nada.
  async scaleNextWeek(clientId, phaseId, kcal) {
    const { phase, current, next } = await loadPhase(clientId, phaseId);
    if (!next) throw noNextWeek();
    const base = toPlain(contentAt(phase.contents, next.start));
    const baseKcal = profileOf(base).kcal;
    const factor = scaleFactor(baseKcal, kcal);
    return {
      weekNumber: next.number,
      start: next.start,
      end: next.end,
      baseKcal,
      targetKcal: kcal || baseKcal,
      factor: Math.round(factor * 10) / 10,
      currentWeekNumber: current?.number ?? null,
      menus: (base.menus || []).map((menu) => ({ name: menu.name, meals: scaleMealsContent(menu.meals, factor) })),
    };
  },

  // Preparar la semana siguiente (desde su lunes). Si el contenido es igual
  // al que heredaría (o al ya preparado), no se escribe nada: null.
  async prepareNextWeek({ clientId, phaseId, menus }) {
    const { phase, next } = await loadPhase(clientId, phaseId);
    if (!next) throw noNextWeek();
    const sanitized = sanitizeMenus(menus);
    if (!sanitized.length) throw badRequest("La semana necesita al menos un menú");
    if (contentSignature({ menus: sanitized }) === contentSignature(toPlain(contentAt(phase.contents, next.start)))) {
      return null;
    }

    const nextMenus = await materializeMenus(sanitized);
    const updated = await dietPhaseDao.mutate(phase._id, (current) => {
      const others = current.contents.filter((content) => content.startDate !== next.start);
      return { contents: [...others, { startDate: next.start, menus: nextMenus }].sort((a, b) => a.startDate.localeCompare(b.startDate)) };
    });
    // Rige desde su lunes hasta la siguiente versión (o el fin de la fase).
    await resyncPlannedDays(clientId, next.start, contentEnd(updated, contentAt(updated.contents, next.start)));
    return updated;
  },

  // Descartar la semana siguiente ya preparada: vuelve a heredar.
  async discardNextWeek(clientId, phaseId) {
    const { phase, next } = await loadPhase(clientId, phaseId);
    if (!next || !phase.contents.some((content) => content.startDate === next.start)) return;
    const updated = await dietPhaseDao.mutate(phase._id, (current) => ({
      contents: current.contents.filter((content) => content.startDate !== next.start),
    }));
    // La versión anterior vuelve a regir esos días.
    await resyncPlannedDays(clientId, next.start, contentEnd(updated, contentAt(updated.contents, next.start)));
  },

  // Historial de nutrición (feed de eventos, ver nutrition-history.js). Por
  // fase, sus DietDays de una vez; los días saltados, en una sola consulta.
  async getNutritionHistory(clientId) {
    const today = await todayForUser(clientId);
    const chainPhases = sortChain(await dietPhaseDao.listByClient(clientId));
    const phases = chainPhases.filter((phase) => phase.startDate <= today);
    if (!phases.length) return { events: [] };

    const skippedDates = await listSkippedDates(clientId, 1000);
    const events = [];
    for (const phase of phases) {
      const until = phase.endDate && phase.endDate < today ? phase.endDate : today;
      const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, phase.startDate, until);
      events.push(
        ...buildPhaseEvents({
          phase: toPlain(phase),
          successor: successorOf(chainPhases, phase),
          weeks: weeksOfPhase(phase, today),
          days,
          skippedDates,
          today,
        })
      );
    }
    return { events: sortEvents(events) };
  },

  // Fases y sus semanas en un rango de fechas — para el slider del cliente y
  // el calendario del profesional. Cada fase con su índice de color estable
  // (orden de inicio).
  async getDietTimeline(clientId, from, to) {
    const today = await todayForUser(clientId);
    const phases = (await dietPhaseDao.listByClient(clientId, { populate: false })).sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );
    const out = { phases: [], weeks: [] };
    phases.forEach((phase, colorIndex) => {
      if ((phase.endDate && phase.endDate < from) || phase.startDate > to) return;
      const id = String(phase._id);
      out.phases.push({ id, name: phase.name, start: phase.startDate, end: phase.endDate, colorIndex });
      for (const week of weeksOfPhase(phase, to > today ? to : today)) {
        if (week.end < from) continue;
        if (week.start > to) break;
        out.weeks.push({
          phaseId: id,
          number: week.number,
          start: week.start,
          end: phase.endDate && week.end > phase.endDate ? phase.endDate : week.end,
          colorIndex,
        });
      }
    });
    return out;
  },
};
