const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { addDaysToIsoDate } = require("../util/period-util");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { summarizeDailyDeviations } = require("../dietDays/food-compliance");
const { contentMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { expectedWeeklyRateKg } = require("../nutritionalGoals/nutrition-target");
const { resolveClientNutritionTarget } = require("../nutritionalGoals/nutrition-target-resolver");
const { stepsFromHabit, needSnapshot } = require("./week-need");
const { suggestNextWeek, scaleFactor } = require("./week-progression");
const { overrideAt, contentSignature } = require("./week-content");
const { weeksOfPhase } = require("./week-service");
const { currentWeek, nextWeek } = require("./week-window");
const { buildPhaseEvents, sortEvents } = require("./nutrition-history");
const checkinDao = require("../trainerCheckins/checkin-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { listSkippedDates } = require("../dietDays/diet-skips");
const { daysElapsed, isoDate } = require("../util/date-util");

/**
 * ¿Esta fase existente impide colocar una nueva que empieza en `startDate`?
 *
 * Solapar NO basta para bloquear: cambiarle el plan al cliente A PARTIR DE YA
 * es el caso normal, y se resuelve cortando la que estaba corriendo. Lo que se
 * rechaza es PROGRAMAR una fase futura encima de una que sigue abierta (o
 * dentro del tramo de una ya cortada).
 *
 * `today` se inyecta para poder testear sin depender del reloj.
 */
function blocksNewPhase(existing, startDate, today = isoDate(new Date()), rulingPhaseId = null) {
  // La fase que RIGE en `startDate` se corta entera si se empieza hoy (o con
  // fecha pasada) — incluida su semana en curso, que ya lleva endDate si
  // tenía la siguiente preparada, y las semanas preparadas por delante
  // (reserveActivePhaseSlot las borra). Sin esto, preparar la semana
  // siguiente bloqueaba cambiar de fase "a partir de ya".
  if (rulingPhaseId && existing.phaseId && String(existing.phaseId) === String(rulingPhaseId) && startDate <= today) {
    return false;
  }
  // `== null` y no `=== null`: un documento sin la clave significa lo mismo
  // que null ("sin fecha"), y debe leerse igual.
  const yaCortada = existing.endDate != null;
  const enCurso = !yaCortada && existing.startDate <= startDate;

  // "A partir de ya": empezar hoy (o con fecha pasada) sobre la fase que está
  // corriendo siempre se permite — es la forma de cerrarla cuando el cliente
  // evoluciona distinto de lo previsto.
  if (enCurso && startDate <= today) return false;

  return true;
}

// Compartido por applyPlan (clona una plantilla), createDirectPlan (crea
// contenido nuevo) y prepareNextWeek (dentro de la MISMA fase) — la
// validación de solape y "quién regía antes" no depende de dónde salió el
// contenido, solo de las fechas. Se lee la fase activa ANTES de crear la
// nueva: en cuanto exista, ambas tendrían status "active" a la vez y un
// findOne sin ordenar ya no podría distinguir con garantías cuál es "la
// anterior".
//
// excludePhaseId: solo lo usa prepareNextWeek. El contenido ABIERTO de esa fase
// (endDate null mientras sigue corriendo) se colaba como "otra fase" y
// bloqueaba cualquier fecha futura aunque no hubiera conflicto real — el
// nuevo empieza justo donde lo deja. Sus semanas ya cerradas sí siguen
// bloqueando (ver findOverlapping).
async function reserveActivePhaseSlot(clientId, startDate, excludePhaseId = null) {
  const today = isoDate(new Date());
  const solapadas = await dietTemplateDao.findOverlapping(clientId, startDate, null, { excludePhaseId });
  // La fase que rige en `startDate` (solo si es hoy o pasado): se corta, no
  // bloquea. `covering` es su contenido en curso — el que se encadena.
  const covering = startDate <= today ? await dietTemplateDao.findCoveringDate(clientId, startDate) : null;
  const rulingPhaseId = covering?.phaseId ? String(covering.phaseId) : null;
  const bloqueantes = solapadas.filter((fase) => blocksNewPhase(fase, startDate, today, rulingPhaseId));
  if (bloqueantes.length) {
    const choque = bloqueantes[0];
    // Accionable, no solo "no puedes": el camino para cambiar de plan es
    // empezar hoy (corta la anterior), y eso no se adivina.
    const hasta = choque.endDate ? `hasta el ${choque.endDate}` : "indefinida";
    const error = new Error(
      `Esas fechas caen dentro de «${choque.name || "otra fase"}» (desde el ${choque.startDate}, ${hasta}). ` +
        `Empiézala hoy para cortarla, o elige una fecha posterior.`
    );
    error.code = "PLAN_OVERLAP";
    error.conflict = {
      startDate: choque.startDate,
      endDate: choque.endDate,
      planId: choque._id,
    };
    throw error;
  }

  // Cortar la fase que rige se lleva sus semanas preparadas que aún no habían
  // empezado: con otra fase encima nunca van a correr, y findCoveringDate los
  // seguiría encontrando (startDate <= fecha, endDate null). Mismo criterio
  // que cancelPhase con el head. La semana en curso se queda y se encadena
  // (chainIfNeeded le pone su fin real). No aplica cuando es la propia fase
  // preparando su semana siguiente (excludePhaseId).
  if (rulingPhaseId && String(excludePhaseId || "") !== rulingPhaseId) {
    const members = await dietTemplateDao.findPhaseMembers(rulingPhaseId);
    for (const c of members) {
      const esElEnCurso = String(c._id) === String(covering._id);
      if (!esElEnCurso && c.startDate > covering.startDate && c.startDate >= startDate) {
        await dietTemplateDao.deleteById(c._id);
      }
    }
    return covering;
  }
  return dietTemplateDao.findActiveForClient(clientId);
}

async function chainIfNeeded(previousActive, created) {
  if (previousActive && String(previousActive._id) !== String(created._id)) {
    // La que se corta termina el día antes de que empiece la nueva — ese es su
    // fin REAL, y es la única ocasión en que se conoce (ninguna asignación
    // nace ya con fecha de fin, ver diet-template-schema.js#endDate).
    //
    // Nunca por debajo de su propio inicio: sustituir una fase el mismo día en
    // que empezó dejaría un rango invertido (fin < inicio) que no casa con
    // ninguna fecha en findCoveringDate. Comparación de strings ISO, que
    // ordenan igual que las fechas.
    const vispera = created.startDate ? addDaysToIsoDate(created.startDate, -1) : null;
    const finReal =
      vispera && previousActive.startDate && vispera < previousActive.startDate
        ? previousActive.startDate
        : vispera;
    await dietTemplateDao.markSuperseded(previousActive._id, created._id, finReal);
  }
}

// --- Semanas: helpers ---

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

// Media diaria de kcal/macros de un contenido — es lo que "vale" una
// semana: no hay un objetivo guardado aparte, sale de los alimentos.
function kcalProfileOf(doc) {
  const p = contentMacroProfile(doc);
  return { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}

function overrideSummary(doc) {
  return {
    id: String(doc._id),
    startDate: doc.startDate,
    menusCount: (doc.menus || []).length,
    profile: kcalProfileOf(doc),
  };
}

// --- Necesidad por semana (docs/plan-semanas.md) ---

// Pasos del cliente: los que pauta su HÁBITO de pasos y los días que lo
// marcó dentro de la semana que se mira. Si no hay hábito, o lo marcó menos
// de la mitad de los días, manda el rango de su perfil — no se inventa un
// dato que el cliente no ha dado.
async function stepsForWindow(clientId, window, until) {
  const task = await trainerTaskDao.findActiveStepsTask(clientId);
  if (!task || !window) return null;
  const end = window.end && (!until || window.end < until) ? window.end : until;
  if (!end || end < window.start) return null;
  const completions = await trainerTaskDao.listCompletionsForTasksInRange([task._id], window.start, end);
  return stepsFromHabit(task, completions.length, window, until);
}

// g/kg con los que se calcula la necesidad de CUALQUIER semana de la fase:
// los que el entrenador fijó al empezarla (head).
function phaseMacroParams(head) {
  return {
    proteinPerKg: head.phaseProteinPerKg ?? undefined,
    fatPerKg: head.phaseFatPerKg ?? undefined,
  };
}

// Necesidad calculada al vuelo "a fecha de `asOf`" con el último peso hasta
// esa fecha y los pasos de la semana `window` (la que acaba de cerrarse, o
// la que corre).
async function computeNeedAt(clientId, head, asOf, window = null) {
  const steps = await stepsForWindow(clientId, window, asOf);
  const resolved = await resolveClientNutritionTarget(clientId, 0, phaseMacroParams(head), {
    asOf,
    stepsRangeKey: steps?.key || null,
    useClientObjetive: true,
  });
  const snapshot = needSnapshot(resolved);
  return snapshot ? { ...snapshot, stepsFromHabit: steps } : null;
}

// Snapshot que se guarda en el head al EMPEZAR la fase: con los datos que el
// cliente tiene en ese momento (peso hasta la fecha de inicio si ya estaba
// registrado, si no el último; último rango de pasos declarado).
async function buildPhaseNeed(clientId, phase, startDate) {
  if (!phase) return null;
  const today = isoDate(new Date());
  const asOf = startDate && startDate <= today ? startDate : undefined;
  // Al empezar la fase todavía no hay semanas corridas: los pasos se miran
  // en los 14 días anteriores, que es lo último que se sabe de cómo se mueve.
  const steps = await stepsForWindow(
    clientId,
    { start: addDaysToIsoDate(asOf || today, -14), end: asOf || today },
    asOf || today
  );
  const resolved = await resolveClientNutritionTarget(
    clientId,
    0,
    { proteinPerKg: phase.proteinPerKg ?? undefined, fatPerKg: phase.fatPerKg ?? undefined },
    { asOf, stepsRangeKey: steps?.key || null, useClientObjetive: true }
  );
  const snapshot = needSnapshot(resolved);
  return snapshot ? { ...snapshot, stepsFromHabit: steps } : null;
}

async function loadPhase(clientId, phaseId) {
  const head = await dietTemplateDao.findPhaseHead(phaseId);
  if (!head || !head.startDate) {
    const e = new Error("Fase no encontrada");
    e.code = "DIET_PHASE_NOT_FOUND";
    throw e;
  }
  // Incluye al head (phaseId = self), ordenados por inicio.
  const members = await dietTemplateDao.findPhaseMembers(phaseId);
  const today = isoDate(new Date());
  const { weeks, phaseEnd } = await weeksOfPhase(head, members, today);
  const current = currentWeek(weeks, today);
  const next = current ? nextWeek(weeks, current) : null;
  return { head, members, today, weeks, current, next, phaseEnd };
}

// Último peso registrado (antropometría, donde también se vuelca el peso del
// check-in) dentro de una ventana. null si no hay ninguno.
async function lastWeightIn(clientId, window, until) {
  const end = window.end || until;
  const rows = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(clientId, window.start, end);
  const withWeight = (rows || [])
    .filter((w) => Number.isFinite(w.weight))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = withWeight[withWeight.length - 1];
  return last ? { weightKg: last.weight, date: last.date } : null;
}

// Sugerencia para la semana siguiente: el peso de la semana en curso frente
// al de la última anterior que tenga peso, y la adherencia de la semana
// ACTUAL. Nunca bloquea: con adherencia baja avisa, pero calcula igual.
async function buildSuggestion(clientId, weeks, members, current, today, need) {
  const weightNow = await lastWeightIn(clientId, current, today);
  let weightBefore = null;
  let comparedTo = null;
  const index = weeks.findIndex((w) => w.number === current.number);
  for (let i = index - 1; i >= 0 && !weightBefore; i--) {
    weightBefore = await lastWeightIn(clientId, weeks[i], today);
    if (weightBefore) comparedTo = weeks[i].number;
  }

  const until = today < current.end ? today : current.end;
  const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, current.start, until);
  const elapsed = Math.max(1, daysElapsed(current.start, until) + 1);
  const adherence = computeRangeAdherence(days, elapsed);
  const deviations = summarizeDailyDeviations(days);

  const currentContent = overrideAt(members, current.start);
  const suggestion = suggestNextWeek({
    currentKcal: currentContent ? kcalProfileOf(currentContent).kcal : null,
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
    deviations,
  };
}

module.exports = {
  // Exportada para test unitario: es la regla con criterio propio.
  blocksNewPhase,

  // Crea la copia congelada (que ES la asignación, ver diet-template-schema.js)
  // y, si el cliente ya tenía una activa, la encadena (supersededBy) — así
  // "aplicar un plan nuevo" y "programar la siguiente fase" son la MISMA
  // operación, sin perder el historial de la anterior.
  async applyPlan({ trainerId, clientId, template, startDate, phase = null }) {
    const previousActive = await reserveActivePhaseSlot(clientId, startDate);
    const need = await buildPhaseNeed(clientId, phase, startDate);

    // Nunca se asigna la plantilla en sí — se congela una copia exclusiva de
    // esta asignación (mismo criterio que aplicar una plantilla de rutina a
    // un split, ver workoutTemplateDao#applyToSplit), en una sola escritura:
    // la copia ES la asignación, así que ya no hay un segundo documento que
    // pueda quedar huérfano si algo falla a medias.
    const created = await dietTemplateDao.cloneForAssignment(template, clientId, {
      startDate,
      endDate: null,
      status: "active",
      phase: phase ? { ...phase, need } : null,
    });

    await chainIfNeeded(previousActive, created);
    return created;
  },

  // Editor de fase/semana ya asignada — lee/escribe el contenido de la copia
  // congelada de ESTE cliente por su propio _id, nunca por sourceTemplateId
  // (que las semanas 2+ ni siquiera tienen). getPlanContent/updateAssignmentContent
  // NUNCA tocan una plantilla de biblioteca: dietTemplateDao.updateAssignedContent
  // exige clientId en el filtro, no solo trainerId.
  async getPlanContent(trainerId, clientId, planId) {
    const plan = await dietTemplateDao.findOwnedByTrainer(trainerId, planId);
    if (!plan || String(plan.clientId || "") !== String(clientId)) return null;
    return {
      _id: plan._id,
      name: plan.name,
      phaseId: plan.phaseId ?? null,
      startDate: plan.startDate ?? null,
      endDate: plan.endDate ?? null,
      menus: plan.menus,
    };
  },

  async updateAssignmentContent({ trainerId, clientId, planId, name, menus }) {
    return dietTemplateDao.updateAssignedContent(trainerId, clientId, planId, { name, menus });
  },

  // "Crear dieta" — mismo flujo que applyPlan (valida solape, encadena la
  // fase anterior) pero el contenido no sale de clonar una plantilla: lo
  // construye el trainer directo para este cliente. Sin plantilla de
  // origen, así que la copia nace con sourceTemplateId: null — estado
  // válido, no una plantilla borrada (ver diet-template-schema.js).
  async createDirectPlan({ trainerId, clientId, name, menus, startDate, phase = null }) {
    const previousActive = await reserveActivePhaseSlot(clientId, startDate);
    const need = await buildPhaseNeed(clientId, phase, startDate);

    const created = await dietTemplateDao.createDirectAssignment(trainerId, clientId, name, menus, {
      startDate,
      endDate: null,
      status: "active",
      phase: phase ? { ...phase, need } : null,
    });

    await chainIfNeeded(previousActive, created);
    return created;
  },

  // --- Semanas (docs/plan-semanas.md) ---
  //
  // Una fase se parte en SEMANAS naturales de lunes a domingo. No hay un
  // documento por semana — solo se persiste el contenido que cambia, y el
  // resto hereda del último persistido que ya había empezado.

  // Todo lo que la ficha necesita: semana en curso, siguiente (con
  // sugerencia) y pasadas. Una sola llamada.
  async getPhaseWeeks(clientId, phaseId) {
    const { head, members, today, weeks, current, next, phaseEnd } = await loadPhase(clientId, phaseId);

    // La necesidad se calcula con los pasos de la semana EN CURSO: es lo
    // último que se sabe de cómo se está moviendo el cliente.
    const need = await computeNeedAt(clientId, head, today, current);
    const suggestion = current ? await buildSuggestion(clientId, weeks, members, current, today, need) : null;
    const nextPersisted = next ? members.find((m) => m.startDate === next.start) || null : null;

    const past = weeks
      .filter((w) => !current || w.number < current.number)
      .map((w) => ({
        number: w.number,
        start: w.start,
        end: w.end,
        profile: kcalProfileOf(overrideAt(members, w.start) || head),
        overrideId: String((overrideAt(members, w.start) || head)._id),
      }));

    const currentOverride = current ? overrideAt(members, current.start) || head : head;

    return {
      phaseId: String(phaseId),
      phaseName: head.phaseName || head.name || null,
      phaseStart: head.startDate,
      phaseEnd,
      phaseTarget: head.phaseTarget || null,
      weeks: weeks.map((w) => ({ number: w.number, start: w.start, end: w.end })),
      current: current
        ? {
            number: current.number,
            start: current.start,
            end: current.end,
            override: overrideSummary(currentOverride),
          }
        : null,
      next: next
        ? {
            number: next.number,
            start: next.start,
            end: next.end,
            override: nextPersisted ? overrideSummary(nextPersisted) : null,
            inherits: nextPersisted ? null : overrideSummary(currentOverride),
            suggestion,
            needNow: need,
          }
        : null,
      past,
    };
  },

  // Cómo se calculó la necesidad de UNA semana: la primera usa el snapshot
  // guardado al empezar la fase; el resto se calculan al vuelo a su fecha de
  // inicio, con el último peso hasta ese día y el último rango de pasos
  // declarado en un check-in. Devuelve además las kcal pautadas, para
  // compararlas con las calculadas.
  async getWeekNeed(clientId, phaseId, number) {
    const { head, members, today, weeks, current } = await loadPhase(clientId, phaseId);
    const n = Number(number);
    const window = weeks.find((w) => w.number === n);
    if (!window) {
      const e = new Error("Semana no encontrada");
      e.code = "DIET_WEEK_NOT_FOUND";
      throw e;
    }

    let need;
    let source;
    if (n === 1 && head.phaseNeed) {
      need = head.phaseNeed.toObject?.() ?? head.phaseNeed;
      source = "snapshot";
    } else {
      // Con los pasos de la semana ANTERIOR: es la que ya cerró cuando
      // empieza esta.
      const previous = weeks.find((w) => w.number === n - 1) || null;
      need = await computeNeedAt(clientId, head, window.start > today ? today : window.start, previous);
      source = "computed";
    }

    const override = overrideAt(members, window.start) || head;
    return {
      weekNumber: n,
      start: window.start,
      end: window.end,
      isCurrent: current ? n === current.number : false,
      source,
      need,
      // Una semana puede contener varios check-ins (un diario, siete): van
      // todos, del más reciente al más antiguo.
      checkins: await checkinDao.listWeekResponses(clientId, head._id, n),
      plannedKcal: kcalProfileOf(override).kcal || null,
      phaseTarget: head.phaseTarget || null,
    };
  },

  // Contenido vigente escalado a `kcal` — para abrir el builder precargado
  // al preparar la semana siguiente. No escribe nada.
  async scaleNextWeek(clientId, phaseId, kcal) {
    const { head, members, current, next } = await loadPhase(clientId, phaseId);
    if (!next) {
      const e = new Error("La fase termina esta semana: no hay una semana siguiente que preparar.");
      e.code = "DIET_NO_NEXT_WEEK";
      throw e;
    }
    const base = overrideAt(members, next.start) || overrideAt(members, current.start) || head;
    const baseKcal = kcalProfileOf(base).kcal;
    const factor = scaleFactor(baseKcal, Number(kcal));
    return {
      weekNumber: next.number,
      start: next.start,
      end: next.end,
      baseKcal,
      targetKcal: Number(kcal) || baseKcal,
      factor: round1(factor),
      currentWeekNumber: current?.number ?? null,
      content: dietTemplateDao.scaledWeekContentPopulated(base, factor),
    };
  },

  // Preparar la semana siguiente. La fecha la pone el servidor (el lunes en
  // que empieza). Si el contenido es idéntico al que heredaría, no se
  // escribe nada y se devuelve { unchanged: true }.
  async prepareNextWeek({ trainerId, clientId, phaseId, menus }) {
    const { head, members, current, next } = await loadPhase(clientId, phaseId);
    if (!next) {
      const e = new Error("La fase termina esta semana: no hay una semana siguiente que preparar.");
      e.code = "DIET_NO_NEXT_WEEK";
      throw e;
    }
    const existing = members.find((m) => m.startDate === next.start) || null;
    // Contra qué se compara: si ya había una preparada, contra ella; si no,
    // contra lo que heredaría.
    const reference = existing || overrideAt(members, current.start) || head;

    const incoming = contentSignature({ menus });
    const actual = contentSignature({ menus: reference.menus });
    if (incoming === actual) return { unchanged: true, week: existing };

    if (existing) {
      const updated = await dietTemplateDao.updateWeekOverride(existing._id, { menus });
      return { unchanged: false, week: updated };
    }

    // El contenido abierto de la misma fase se exime del chequeo de solape
    // (el nuevo empieza justo donde lo deja); otras fases sí bloquean.
    const previousActive = await reserveActivePhaseSlot(clientId, next.start, phaseId);
    const created = await dietTemplateDao.createWeekOverride({
      trainerId,
      clientId,
      phaseId,
      menus,
      schedule: { startDate: next.start, endDate: null, status: "active" },
    });
    await chainIfNeeded(previousActive, created);
    return { unchanged: false, week: created };
  },

  // Descartar la semana siguiente ya preparada: se borra y la anterior
  // vuelve a ser el tip abierto (hereda hacia delante otra vez).
  async discardNextWeek(clientId, phaseId) {
    const { members, next } = await loadPhase(clientId, phaseId);
    if (!next) return { discarded: false };
    const existing = members.find((m) => m.startDate === next.start) || null;
    if (!existing) return { discarded: false };
    await dietTemplateDao.deleteById(existing._id);
    const previous = members.filter((m) => m.startDate < next.start).pop();
    if (previous) await dietTemplateDao.reactivate(previous._id);
    return { discarded: true };
  },

  // Mover las fechas de una fase ya aplicada. El inicio y el fin se editan
  // desde la ficha (Plan > Nutrición) y no pueden pisar otra fase: es la
  // única forma de corregir una fase que se creó con la fecha de hoy y
  // tenía que empezar otro día.
  async updatePhaseDates({ clientId, phaseId, startDate, endDate }) {
    const head = await dietTemplateDao.findPhaseHead(phaseId);
    if (!head || String(head.clientId || "") !== String(clientId)) {
      const e = new Error("Fase no encontrada");
      e.code = "DIET_PHASE_NOT_FOUND";
      throw e;
    }
    const members = await dietTemplateDao.findPhaseMembers(phaseId);
    const nextStart = startDate || head.startDate;
    const nextEnd = endDate === undefined ? members[members.length - 1]?.endDate ?? null : endDate;

    if (nextEnd && nextEnd < nextStart) {
      const e = new Error("El fin de la fase no puede ser anterior a su inicio");
      e.code = "PLAN_INVALID_RANGE";
      throw e;
    }

    // Cualquier otra fase que se solape con el rango nuevo bloquea: mover
    // fechas no corta a nadie, a diferencia de empezar una fase hoy.
    const overlapping = await dietTemplateDao.findOverlapping(clientId, nextStart, nextEnd, {
      excludePhaseId: phaseId,
    });
    const blocking = overlapping.filter((other) => String(other.phaseId || other._id) !== String(phaseId));
    if (blocking.length) {
      const clash = blocking[0];
      const error = new Error(
        `Esas fechas se solapan con «${clash.name || "otra fase"}» (desde el ${clash.startDate}${clash.endDate ? `, hasta el ${clash.endDate}` : ""}).`
      );
      error.code = "PLAN_OVERLAP";
      throw error;
    }

    // El contenido preparado que caía dentro de la fase se mueve con ella el
    // mismo número de días.
    const shift = daysElapsed(head.startDate, nextStart);
    for (const member of members) {
      const updates = {};
      if (shift !== 0 && member.startDate) updates.startDate = addDaysToIsoDate(member.startDate, shift);
      if (String(member._id) === String(members[members.length - 1]._id)) updates.endDate = nextEnd;
      else if (shift !== 0 && member.endDate) updates.endDate = addDaysToIsoDate(member.endDate, shift);
      if (Object.keys(updates).length) await dietTemplateDao.updateSchedule(member._id, updates);
    }
    return dietTemplateDao.findPhaseHead(phaseId);
  },

  async getActivePhaseId(clientId) {
    return dietTemplateDao.findActivePhaseId(clientId);
  },

  async getActiveForClient(clientId) {
    return dietTemplateDao.findActiveForClient(clientId);
  },

  async listForClient(clientId) {
    return dietTemplateDao.listByClient(clientId);
  },

  // Historial de nutrición (feed de eventos, ver nutrition-history.js). Una
  // sola llamada para toda la vida del cliente: por fase, sus DietDays de
  // una vez (no una consulta por semana); los días saltados del cliente
  // enteros, en una sola consulta.
  async getNutritionHistory(clientId) {
    const today = isoDate(new Date());
    const all = await dietTemplateDao.listByClient(clientId);
    const heads = all
      .filter((d) => d.phaseId && String(d.phaseId) === String(d._id) && d.startDate && d.startDate <= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (!heads.length) return { events: [] };

    const skippedDates = await listSkippedDates(clientId, 1000);

    const events = [];
    for (const head of heads) {
      const phaseId = String(head._id);
      const members = all
        .filter((d) => String(d.phaseId) === phaseId)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.createdAt).localeCompare(String(b.createdAt)));
      // Fin de la fase = endDate del último contenido persistido.
      const tipEnd = members[members.length - 1]?.endDate || null;
      const until = tipEnd && tipEnd < today ? tipEnd : today;
      const [days, { weeks }] = await Promise.all([
        dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, head.startDate, until),
        weeksOfPhase(head, members, today),
      ]);
      events.push(
        ...buildPhaseEvents({
          head,
          members,
          weeks,
          days,
          skippedDates,
          today,
        })
      );
    }
    return { events: sortEvents(events) };
  },

  // Ventanas de semana de todas las fases de un cliente en un rango de
  // fechas — para el slider del cliente y el calendario del entrenador. Cada
  // fase con su índice de color estable (orden de inicio) y sus semanas.
  async getDietTimeline(clientId, from, to) {
    const all = await dietTemplateDao.listByClient(clientId);
    const heads = all
      .filter((d) => d.phaseId && String(d.phaseId) === String(d._id))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const phases = [];
    const weeksOut = [];
    const today = isoDate(new Date());

    for (const [index, head] of heads.entries()) {
      const members = all
        .filter((d) => String(d.phaseId) === String(head._id))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      const phaseEnd = members[members.length - 1]?.endDate || null;
      const phaseStart = head.startDate;
      if (phaseEnd && phaseEnd < from) continue;
      if (phaseStart > to) continue;
      phases.push({ id: String(head._id), name: head.phaseName || head.name, start: phaseStart, end: phaseEnd, colorIndex: index });

      const { weeks } = await weeksOfPhase(head, members, to > today ? to : today);
      for (const w of weeks) {
        if (w.end < from) continue;
        if (w.start > to) break;
        weeksOut.push({
          phaseId: String(head._id),
          number: w.number,
          start: w.start,
          end: phaseEnd && w.end > phaseEnd ? phaseEnd : w.end,
          colorIndex: index,
        });
      }
    }
    return { phases, weeks: weeksOut };
  },

  // Borrado coherente de fases (nutrición) — "me he equivocado" / el cliente
  // cambia de objetivo: quitar CUALQUIER fase (futura, pasada/sustituida, o
  // la vigente ahora mismo).
  //
  // Nutrición no mantiene un puntero tipo `tableInUse`: "qué plan rige hoy"
  // se resuelve siempre al vuelo por fecha (findCoveringDate /
  // plan-resolver.js), así que borrar una fase nunca deja ese cálculo
  // desincronizado. Lo único que sí hay que mantener es el TIP de la cadena:
  // como mucho una fase por cliente con status "active" (la última que se
  // aplicó, sea cual sea su fecha de inicio), y si la borrada era esa, la
  // siguiente más reciente pasa a serlo (y vuelve a quedar abierta).
  async cancelPhase(clientId, planId) {
    const phase = await dietTemplateDao.findByIdAndClient(planId, clientId);
    if (!phase) {
      const error = new Error("Fase no encontrada");
      error.code = "DIET_PHASE_NOT_FOUND";
      throw error;
    }

    // Rango de fechas que deja de tener plan: el de la fase y, si es el head,
    // también el de sus semanas (null = abierto). El controller vacía ahí lo
    // pautado de los días ya abiertos.
    const removedRange = { from: phase.startDate, to: phase.endDate || null };

    // Borrar el head de una fase se lleva sus semanas preparadas: sin head no
    // hay ventanas que calcular.
    if (phase.phaseId && String(phase.phaseId) === String(phase._id)) {
      const members = await dietTemplateDao.findPhaseMembers(phase._id);
      for (const m of members) {
        if (String(m._id) === String(phase._id)) continue;
        if (removedRange.to && (!m.endDate || m.endDate > removedRange.to)) removedRange.to = m.endDate || null;
        await dietTemplateDao.deleteById(m._id);
      }
    }
    await dietTemplateDao.deleteById(phase._id);

    let newTip = null;
    if (phase.status === "active") {
      [newTip] = await dietTemplateDao.listByClient(clientId);
      if (newTip) await dietTemplateDao.reactivate(newTip._id);
    }

    return { cancelled: phase, newTip, removedRange };
  },

  async findCoveringDate(clientId, date) {
    return dietTemplateDao.findCoveringDate(clientId, date);
  },
};
