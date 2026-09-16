// Historial de nutrición del entrenador (ficha del cliente, abajo del todo):
// un feed plano de EVENTOS, del más reciente al más antiguo, que desglosa
// fases y ciclos (docs/plan-ciclos-por-contenido.md). Responde "¿qué pasó,
// cuándo y cómo fue?": en qué fase/ciclo estaba el cliente, si lo cumplió,
// si metió check-in, y las excepciones puntuales.
//
// PURO: recibe los datos ya cargados (fase, ciclos persistidos, DietDays,
// check-ins y excepciones) y la fecha de hoy. La E/S vive en
// plan-assignment-service.js#getNutritionHistory.

const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { cycleMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { LOW_ADHERENCE_PCT } = require("./cycle-progression");
const { windowsUntil } = require("./cycle-window");
const { daysInRange } = require("../util/date-util");

// Tipos ordenados de "más envolvente" a "más puntual": con la misma fecha,
// primero va lo que cierra (fin de fase), luego el ciclo, luego lo que pasó
// dentro (check-in, excepción) y por último el inicio de fase — así al
// apilar del más reciente al más antiguo, el inicio de una fase queda debajo
// de su C1 y el fin encima de su último ciclo.
const TYPE_RANK = { phase_ended: 4, cycle: 3, checkin: 2, exception: 1, phase_started: 0 };

function profileOf(doc) {
  const p = cycleMacroProfile(doc);
  return { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}

// Veredicto de un ciclo. `running` mientras no haya acabado; después, según
// la adherencia media de sus días con plan (mismo umbral que la sugerencia).
function cycleStatus({ end, today, adherencePct }) {
  if (end >= today) return "running";
  if (adherencePct == null) return "no_data";
  return adherencePct >= LOW_ADHERENCE_PCT ? "met" : "missed";
}

function checkinSummary(response) {
  if (!response) return null;
  return {
    id: String(response._id),
    respondedAt: response.respondedAt,
    values: response.values || {},
  };
}

/**
 * Eventos de UNA fase.
 *
 * @param head       doc cabecera de la fase (phaseId = self)
 * @param cycles     docs persistidos de la fase (head incluido), por startDate asc.
 *                   El fin de la fase es el endDate del ÚLTIMO (cada ciclo
 *                   preparado encadena al anterior con supersededBy, así que
 *                   el head lleva endDate en cuanto se prepara C2).
 * @param days       DietDays del cliente entre head.startDate y hoy (o fin de fase)
 * @param checkins   CheckinResponse con cycle.phaseId = esta fase
 * @param exceptions [{ _id, date, mealSlot, action }] del cliente (todas; se filtran aquí)
 * @param today      "YYYY-MM-DD"
 */
function buildPhaseEvents({ head, cycles, days, checkins, exceptions, today }) {
  if (!head?.startDate || head.startDate > today) return [];

  const phaseId = String(head._id);
  const phaseName = head.phaseName || head.name || null;
  const base = { phaseId, phaseName, phaseFocus: head.phaseFocus || null };

  // Una fase cortada acaba en su endDate real; sus ventanas se calculan
  // hasta ahí y la última se recorta (el ciclo que estaba en marcha cuando
  // la sustituyeron no llegó a completarse).
  const tip = cycles[cycles.length - 1] || head;
  const phaseEnd = tip.endDate && tip.endDate < today ? tip.endDate : null;
  const until = phaseEnd || today;
  const windows = windowsUntil(cycles, until);

  const checkinByNumber = new Map((checkins || []).map((c) => [Number(c.cycle?.number), c]));
  const dayList = days || [];
  const exceptionList = (exceptions || []).filter((e) => e.date >= head.startDate && e.date <= until);

  const events = [];
  events.push({ type: "phase_started", date: head.startDate, ...base, mode: head.mode || null });

  let previousKcal = null;
  for (const w of windows) {
    const end = phaseEnd && w.end > phaseEnd ? phaseEnd : w.end;
    const measuredUntil = end < today ? end : today;
    const inWindow = dayList.filter((d) => d.date >= w.start && d.date <= measuredUntil);
    const adherence = computeRangeAdherence(inWindow, daysInRange(w.start, measuredUntil));
    const profile = profileOf(w.override);
    const checkin = checkinByNumber.get(w.number) || null;
    const cycleExceptions = exceptionList.filter((e) => e.date >= w.start && e.date <= end);

    events.push({
      type: "cycle",
      date: w.start,
      ...base,
      number: w.number,
      start: w.start,
      end,
      truncated: end !== w.end,
      overrideId: String(w.override._id),
      profile,
      kcalDelta: previousKcal == null ? null : Math.round(profile.kcal - previousKcal),
      adherencePct: adherence.percentage,
      adherenceDays: adherence.daysWithData,
      periodDays: adherence.periodDays,
      status: cycleStatus({ end, today, adherencePct: adherence.percentage }),
      checkin: checkinSummary(checkin),
      exceptions: cycleExceptions.map((e) => ({ id: String(e._id), date: e.date, action: e.action, mealSlot: e.mealSlot })),
    });
    previousKcal = profile.kcal;

    if (checkin) {
      events.push({
        type: "checkin",
        date: String(new Date(checkin.respondedAt).toISOString()).slice(0, 10),
        ...base,
        number: w.number,
        checkin: checkinSummary(checkin),
      });
    }
    for (const e of cycleExceptions) {
      events.push({
        type: "exception",
        date: e.date,
        ...base,
        number: w.number,
        exception: { id: String(e._id), date: e.date, action: e.action, mealSlot: e.mealSlot },
      });
    }
  }

  if (phaseEnd) {
    events.push({
      type: "phase_ended",
      date: phaseEnd,
      ...base,
      status: tip.status === "superseded" ? "superseded" : "finished",
      cyclesCount: windows.length,
    });
  }

  return events;
}

/** Del más reciente al más antiguo; a igual fecha, ver TYPE_RANK. */
function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const rank = (TYPE_RANK[b.type] ?? 0) - (TYPE_RANK[a.type] ?? 0);
    if (rank !== 0) return rank;
    return (b.number || 0) - (a.number || 0);
  });
}

module.exports = { buildPhaseEvents, sortEvents, cycleStatus };
