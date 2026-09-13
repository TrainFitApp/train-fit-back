const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { addDaysToIsoDate } = require("../util/period-util");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { summarizeDailyDeviations } = require("../dietDays/food-compliance");
const { cycleMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { expectedWeeklyRateKg } = require("../nutritionalGoals/nutrition-target");
const { suggestNextCycle, scaleFactor } = require("./cycle-progression");
const { windowsUntil, nextWindow, contentCycleDays } = require("./cycle-window");
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
function blocksNewPhase(existing, startDate, today = isoDate(new Date())) {
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
// contenido nuevo) y prepareNextCycle (ciclo dentro de la MISMA fase) — la
// validación de solape y "quién regía antes" no depende de dónde salió el
// contenido, solo de las fechas. Se lee la fase activa ANTES de crear la
// nueva: en cuanto exista, ambas tendrían status "active" a la vez y un
// findOne sin ordenar ya no podría distinguir con garantías cuál es "la
// anterior".
//
// excludePhaseId: solo lo usa prepareNextCycle. El ciclo ABIERTO de esa fase
// (endDate null mientras sigue corriendo) se colaba como "otra fase" y
// bloqueaba cualquier fecha futura aunque no hubiera conflicto real — el
// nuevo empieza justo donde lo deja. Sus ciclos ya cerrados sí siguen
// bloqueando (ver findOverlapping).
async function reserveActivePhaseSlot(clientId, startDate, excludePhaseId = null) {
  const solapadas = await dietTemplateDao.findOverlapping(clientId, startDate, null, { excludePhaseId });
  const bloqueantes = solapadas.filter((fase) => blocksNewPhase(fase, startDate));
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

// --- Ciclos por contenido: helpers ---

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

// Media diaria de kcal/macros del contenido de un ciclo — es lo único que
// "vale" un ciclo: no hay objetivo guardado aparte (plan §9).
function kcalProfileOf(doc) {
  const p = cycleMacroProfile(doc);
  return { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}

function overrideSummary(doc) {
  return {
    id: String(doc._id),
    startDate: doc.startDate,
    mode: doc.mode,
    cycleDays: contentCycleDays(doc),
    daysCount: (doc.days || []).length,
    choiceCycleDays: doc.choiceCycleDays ?? null,
    profile: kcalProfileOf(doc),
  };
}

async function loadPhase(phaseId) {
  const head = await dietTemplateDao.findPhaseHead(phaseId);
  if (!head || !head.startDate) {
    const e = new Error("Fase no encontrada");
    e.code = "DIET_PHASE_NOT_FOUND";
    throw e;
  }
  // Incluye al head (phaseId = self), ordenados por inicio.
  const cycles = await dietTemplateDao.findCyclesOfPhase(phaseId);
  const today = isoDate(new Date());
  const windows = windowsUntil(cycles, today);
  const current = windows[windows.length - 1];
  const next = nextWindow(cycles, current);
  return { head, cycles, today, windows, current, next };
}

// Último peso registrado (antropometría, donde también se vuelca el peso del
// check-in) dentro de una ventana. null si no hay ninguno.
async function lastWeightIn(clientId, window) {
  const rows = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(clientId, window.start, window.end);
  const withWeight = (rows || [])
    .filter((w) => Number.isFinite(w.weight))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = withWeight[withWeight.length - 1];
  return last ? { weightKg: last.weight, date: last.date } : null;
}

// Sugerencia para el ciclo siguiente (plan §7): peso del ciclo actual vs el
// último ciclo anterior que tenga peso; adherencia y desvíos del ciclo
// ACTUAL. Nunca bloquea: con adherencia baja avisa, pero calcula igual.
async function buildSuggestion(clientId, head, windows, current, today) {
  const weightNow = await lastWeightIn(clientId, current);
  let weightBefore = null;
  let comparedTo = null;
  for (let i = windows.length - 2; i >= 0 && !weightBefore; i--) {
    weightBefore = await lastWeightIn(clientId, windows[i]);
    if (weightBefore) comparedTo = windows[i].number;
  }

  const until = today < current.end ? today : current.end;
  const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(clientId, current.start, until);
  const elapsed = Math.max(1, daysElapsed(current.start, until) + 1);
  const adherence = computeRangeAdherence(days, elapsed);
  const deviations = summarizeDailyDeviations(days);

  const previousKcal = kcalProfileOf(current.override).kcal;
  const suggestion = suggestNextCycle({
    previousCycleKcal: previousKcal,
    weightStartKg: weightBefore?.weightKg ?? null,
    weightEndKg: weightNow?.weightKg ?? null,
    daysElapsed: weightBefore && weightNow ? daysElapsed(weightBefore.date, weightNow.date) : 0,
    expectedWeeklyRateKg: expectedWeeklyRateKg(head.phaseTargetKcalDelta || 0),
    adherencePct: adherence.percentage,
    targetRatePerCycle: head.targetRatePerCycle || 0,
  });

  return {
    ...suggestion,
    weightStartKg: weightBefore?.weightKg ?? null,
    weightEndKg: weightNow?.weightKg ?? null,
    comparedToCycle: comparedTo,
    adherencePct: adherence.percentage,
    adherenceDays: adherence.daysWithData,
    deviations,
  };
}

// Contenido "clipboard" normalizado para comparar dos ciclos: qué alimentos
// y en qué cantidad, sin ids ni orden. Si esto coincide, preparar el
// siguiente no cambia nada y no se persiste (plan §4).
function contentSignature({ mode, days, dayPatterns, choiceCycleDays }) {
  const item = (x) => ({
    ref: String(x?.product?._id || x?.product || x?.recipe?._id || x?.recipe || x?.name || ""),
    q: Math.round(Number(x?.quantity) || 0),
  });
  const meal = (m) => ({
    name: m?.name || "",
    alts: (m?.alternatives || []).map((a) => ({
      p: (a?.customProducts || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
      r: (a?.customRecipes || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
    })),
  });
  const container = (c) => ({
    label: c?.dayLabel || c?.name || "",
    appliesTo: [...(c?.appliesTo || [])].sort(),
    meals: (c?.meals || []).map(meal),
  });
  return JSON.stringify({
    mode: mode || "sequential",
    choiceCycleDays: mode === "choice" ? Number(choiceCycleDays) || 7 : null,
    days: (days || []).map(container),
    dayPatterns: (dayPatterns || []).map(container),
  });
}

module.exports = {
  // Exportadas para test unitario: son las reglas con criterio propio.
  blocksNewPhase,
  contentSignature,

  // Crea la copia congelada (que ES la asignación, ver diet-template-schema.js)
  // y, si el cliente ya tenía una activa, la encadena (supersededBy) — así
  // "aplicar un plan nuevo" y "programar la siguiente fase" son la MISMA
  // operación, sin perder el historial de la anterior.
  async applyPlan({ trainerId, clientId, template, startDate, phase = null }) {
    const previousActive = await reserveActivePhaseSlot(clientId, startDate);

    // Nunca se asigna la plantilla en sí — se congela una copia exclusiva de
    // esta asignación (mismo criterio que aplicar una plantilla de rutina a
    // un split, ver workoutTemplateDao#applyToSplit), en una sola escritura:
    // la copia ES la asignación, así que ya no hay un segundo documento que
    // pueda quedar huérfano si algo falla a medias.
    const created = await dietTemplateDao.cloneForAssignment(template, clientId, {
      startDate,
      endDate: null,
      status: "active",
      phase,
    });

    await chainIfNeeded(previousActive, created);
    return created;
  },

  // Editor de fase/ciclo ya asignado — lee/escribe el contenido de la copia
  // congelada de ESTE cliente por su propio _id, nunca por sourceTemplateId
  // (que los ciclos 2+ ni siquiera tienen). getPlanContent/updateAssignmentContent
  // NUNCA tocan una plantilla de biblioteca: dietTemplateDao.updateAssignedContent
  // exige clientId en el filtro, no solo trainerId.
  async getPlanContent(trainerId, clientId, planId) {
    const plan = await dietTemplateDao.findOwnedByTrainer(trainerId, planId);
    if (!plan || String(plan.clientId || "") !== String(clientId)) return null;
    return {
      _id: plan._id,
      name: plan.name,
      mode: plan.mode,
      choiceCycleDays: plan.choiceCycleDays ?? null,
      days: plan.days,
      dayPatterns: plan.dayPatterns,
    };
  },

  async updateAssignmentContent({ trainerId, clientId, planId, name, mode, days, dayPatterns, choiceCycleDays }) {
    return dietTemplateDao.updateAssignedContent(trainerId, clientId, planId, {
      name,
      mode,
      days,
      dayPatterns,
      choiceCycleDays,
    });
  },

  // "Crear dieta" — mismo flujo que applyPlan (valida solape, encadena la
  // fase anterior) pero el contenido no sale de clonar una plantilla: lo
  // construye el trainer directo para este cliente. Sin plantilla de
  // origen, así que la copia nace con sourceTemplateId: null — estado
  // válido, no una plantilla borrada (ver diet-template-schema.js).
  async createDirectPlan({ trainerId, clientId, name, days, mode, dayPatterns, choiceCycleDays, startDate, phase = null }) {
    const previousActive = await reserveActivePhaseSlot(clientId, startDate);

    const created = await dietTemplateDao.createDirectAssignment(trainerId, clientId, name, days, mode, dayPatterns, {
      startDate,
      endDate: null,
      status: "active",
      phase,
      choiceCycleDays,
    });

    await chainIfNeeded(previousActive, created);
    return created;
  },

  // --- Ciclos por contenido (docs/plan-ciclos-por-contenido.md) ---
  //
  // No hay un documento por ciclo: solo se persisten los que cambian algo
  // (el head = C1, y los que el entrenador prepara). El ciclo N es una
  // ventana encadenada (cycle-window.js) y su contenido es el del último
  // persistido que ya había empezado. El actual no se toca; solo se prepara
  // el siguiente.

  // Todo lo que la ficha necesita: actual, siguiente (con sugerencia) y
  // pasados. Una sola llamada.
  async getPhaseCycles(clientId, phaseId) {
    const { head, cycles, today, windows, current, next } = await loadPhase(phaseId);

    const nextPersisted = cycles.find((c) => c.startDate === next.start) || null;
    const suggestion = await buildSuggestion(clientId, head, windows, current, today);

    const past = windows.slice(0, -1).map((w) => ({
      number: w.number,
      start: w.start,
      end: w.end,
      profile: kcalProfileOf(w.override),
      overrideId: String(w.override._id),
    }));

    return {
      phaseId: String(phaseId),
      phaseName: head.phaseName || head.name || null,
      phaseFocus: head.phaseFocus || null,
      phaseStart: head.startDate,
      windows: windows.map((w) => ({ number: w.number, start: w.start, end: w.end })).concat([
        { number: next.number, start: next.start, end: next.end },
      ]),
      current: {
        number: current.number,
        start: current.start,
        end: current.end,
        override: overrideSummary(current.override),
      },
      next: {
        number: next.number,
        start: next.start,
        end: next.end,
        len: next.len,
        override: nextPersisted ? overrideSummary(nextPersisted) : null,
        inherits: nextPersisted ? null : overrideSummary(next.override),
        suggestion,
      },
      past,
    };
  },

  // Contenido del ciclo vigente escalado a `kcal` — para abrir el builder
  // precargado al preparar el siguiente. No escribe nada.
  async scaleNextCycle(clientId, phaseId, kcal) {
    const { current, next } = await loadPhase(phaseId);
    const base = next.override;
    const baseKcal = kcalProfileOf(base).kcal;
    const factor = scaleFactor(baseKcal, Number(kcal));
    return {
      cycleNumber: next.number,
      start: next.start,
      end: next.end,
      baseKcal,
      targetKcal: Number(kcal) || baseKcal,
      factor: round1(factor),
      currentCycleNumber: current.number,
      content: {
        ...dietTemplateDao.scaledCycleContentPopulated(base, factor),
        choiceCycleDays: base.choiceCycleDays ?? null,
      },
    };
  },

  // Preparar el siguiente ciclo. La fecha la pone el servidor (inicio de
  // N+1). Si el contenido es idéntico al que heredaría, no se escribe nada
  // (plan §4) y se devuelve { unchanged: true }.
  async prepareNextCycle({ trainerId, clientId, phaseId, mode, days, dayPatterns, choiceCycleDays }) {
    const { cycles, next } = await loadPhase(phaseId);
    const existing = cycles.find((c) => c.startDate === next.start) || null;
    // Contra qué se compara: si ya había uno preparado, contra él (repetir
    // el guardado sin tocar nada no escribe); si no, contra lo que heredaría.
    const reference = existing || next.override;

    const incoming = contentSignature({ mode, days, dayPatterns, choiceCycleDays });
    const current = contentSignature({
      mode: reference.mode,
      days: reference.days,
      dayPatterns: reference.dayPatterns,
      choiceCycleDays: reference.choiceCycleDays,
    });
    if (incoming === current) return { unchanged: true, cycle: existing };

    if (existing) {
      const updated = await dietTemplateDao.updateCycleOverride(existing._id, { mode, days, dayPatterns, choiceCycleDays });
      return { unchanged: false, cycle: updated };
    }

    // El ciclo abierto de la misma fase se exime del chequeo de solape (el
    // nuevo empieza justo donde lo deja); otras fases sí bloquean.
    const previousActive = await reserveActivePhaseSlot(clientId, next.start, phaseId);
    const created = await dietTemplateDao.createCycle({
      trainerId,
      clientId,
      phaseId,
      mode,
      days,
      dayPatterns,
      choiceCycleDays,
      schedule: { startDate: next.start, endDate: null, status: "active" },
    });
    await chainIfNeeded(previousActive, created);
    return { unchanged: false, cycle: created };
  },

  // Descartar el siguiente ciclo preparado: se borra y el anterior vuelve a
  // ser el tip abierto (hereda hacia delante otra vez).
  async discardNextCycle(clientId, phaseId) {
    const { cycles, next } = await loadPhase(phaseId);
    const existing = cycles.find((c) => c.startDate === next.start) || null;
    if (!existing) return { discarded: false };
    await dietTemplateDao.deleteById(existing._id);
    const previous = cycles.filter((c) => c.startDate < next.start).pop();
    if (previous) await dietTemplateDao.reactivate(previous._id);
    return { discarded: true };
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

  // Ventanas de ciclo de todas las fases de un cliente en un rango de fechas
  // — para el slider del cliente y el calendario del entrenador. Cada fase
  // con su índice de color estable (orden de inicio) y sus ciclos.
  async getCycleTimeline(clientId, from, to) {
    const all = await dietTemplateDao.listByClient(clientId);
    const heads = all.filter((d) => d.phaseId && String(d.phaseId) === String(d._id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const phases = [];
    const cyclesOut = [];
    heads.forEach((head, index) => {
      const members = all
        .filter((d) => String(d.phaseId) === String(head._id))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      // Fin real de la fase: el endDate del último ciclo persistido si está
      // cerrado; si no, abierta.
      const last = members[members.length - 1];
      const phaseEnd = last?.endDate || null;
      const phaseStart = head.startDate;
      if (phaseEnd && phaseEnd < from) return;
      if (phaseStart > to) return;
      phases.push({ id: String(head._id), name: head.phaseName || head.name, start: phaseStart, end: phaseEnd, colorIndex: index });
      const until = phaseEnd && phaseEnd < to ? phaseEnd : to;
      for (const w of windowsUntil(members, until)) {
        if (w.end < from) continue;
        if (phaseEnd && w.start > phaseEnd) break;
        cyclesOut.push({ phaseId: String(head._id), number: w.number, start: w.start, end: phaseEnd && w.end > phaseEnd ? phaseEnd : w.end, colorIndex: index });
      }
    });
    return { phases, cycles: cyclesOut };
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

    // Borrar el head de una fase se lleva sus ciclos preparados: sin head no
    // hay ventanas que calcular.
    if (phase.phaseId && String(phase.phaseId) === String(phase._id)) {
      const members = await dietTemplateDao.findCyclesOfPhase(phase._id);
      for (const m of members) if (String(m._id) !== String(phase._id)) await dietTemplateDao.deleteById(m._id);
    }
    await dietTemplateDao.deleteById(phase._id);

    let newTip = null;
    if (phase.status === "active") {
      [newTip] = await dietTemplateDao.listByClient(clientId);
      if (newTip) await dietTemplateDao.reactivate(newTip._id);
    }

    return { cancelled: phase, newTip };
  },

  async findCoveringDate(clientId, date) {
    return dietTemplateDao.findCoveringDate(clientId, date);
  },
};
