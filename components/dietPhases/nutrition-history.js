// Historial de nutrición del entrenador (ficha del cliente, abajo del todo):
// un feed plano de EVENTOS, del más reciente al más antiguo, que desglosa
// fases y SEMANAS (docs/plan-semanas.md). Responde "¿qué pasó, cuándo y cómo
// fue?": en qué fase/semana estaba el cliente, con qué kcal y macros, si lo
// cumplió y qué días se saltó (dentro de su semana). Los check-ins no van
// aquí: tienen su propio historial.
//
// PURO: recibe los datos ya cargados (fase con su contenido, ventanas de
// semana, DietDays y días saltados) y la fecha de hoy. La E/S vive en
// diet-phase-service.js#getNutritionHistory.

const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { contentMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { LOW_ADHERENCE_PCT } = require("./week-progression");
const { contentAt } = require("./week-content");
const { daysInRange } = require("../util/date-util");
const { cutEndDate } = require("../util/phase-chain");

// Tipos ordenados de "más envolvente" a "más puntual": con la misma fecha,
// primero va lo que cierra (fin de fase), luego la semana y por último el
// inicio de fase — así al apilar del más reciente al más antiguo, el inicio
// de una fase queda debajo de su S1 y el fin encima de su última semana.
const TYPE_RANK = { phase_ended: 2, week: 1, phase_started: 0 };

function profileOf(doc) {
  const p = contentMacroProfile(doc);
  return { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}

// Veredicto de una semana. `running` mientras no haya acabado; después,
// según la adherencia media de sus días con plan (mismo umbral que la
// sugerencia).
function weekStatus({ end, today, adherencePct }) {
  if (end >= today) return "running";
  if (adherencePct == null) return "no_data";
  return adherencePct >= LOW_ADHERENCE_PCT ? "met" : "missed";
}

/**
 * Eventos de UNA fase.
 *
 * @param phase      DietPhase con su contenido (contents por startDate asc)
 * @param successor  la fase siguiente en la cadena, o null (util/phase-chain.js)
 * @param weeks      ventanas de semana ya calculadas (week-window.js)
 * @param days       DietDays del cliente entre el inicio de la fase y hoy (o su fin)
 * @param skippedDates fechas saltadas del cliente (todas; se filtran aquí)
 * @param today      "YYYY-MM-DD"
 */
function buildPhaseEvents({ phase, successor = null, weeks, days, skippedDates, today }) {
  if (!phase?.startDate || phase.startDate > today) return [];

  const base = { phaseId: String(phase._id), phaseName: phase.name };

  // Una fase cortada acaba en su endDate real; sus ventanas se calculan
  // hasta ahí y la última se recorta (la semana que estaba en marcha cuando
  // la sustituyeron no llegó a completarse).
  const phaseEnd = phase.endDate && phase.endDate < today ? phase.endDate : null;
  const until = phaseEnd || today;
  const windows = (weeks || []).filter((w) => w.start <= until);

  const dayList = days || [];
  const skippedList = (skippedDates || []).filter((date) => date >= phase.startDate && date <= until);

  const events = [];
  events.push({ type: "phase_started", date: phase.startDate, ...base });

  let previousKcal = null;
  for (const w of windows) {
    const end = phaseEnd && w.end > phaseEnd ? phaseEnd : w.end;
    const measuredUntil = end < today ? end : today;
    const inWindow = dayList.filter((d) => d.date >= w.start && d.date <= measuredUntil);
    const adherence = computeRangeAdherence(inWindow, daysInRange(w.start, measuredUntil));
    const content = contentAt(phase.contents, w.start);
    const profile = profileOf(content);
    const weekSkipped = skippedList.filter((date) => date >= w.start && date <= end);

    events.push({
      type: "week",
      date: w.start,
      ...base,
      number: w.number,
      start: w.start,
      end,
      truncated: end !== w.end,
      contentId: String(content._id),
      profile,
      kcalDelta: previousKcal == null ? null : Math.round(profile.kcal - previousKcal),
      adherencePct: adherence.percentage,
      adherenceDays: adherence.daysWithData,
      periodDays: adherence.periodDays,
      status: weekStatus({ end, today, adherencePct: adherence.percentage }),
      skippedDays: weekSkipped,
    });
    previousKcal = profile.kcal;
  }

  if (phaseEnd) {
    events.push({
      type: "phase_ended",
      date: phaseEnd,
      ...base,
      // Sustituida si la cortó la siguiente; terminada si acabó por su fecha.
      status: successor && phase.endDate === cutEndDate(phase, successor.startDate) ? "superseded" : "finished",
      weeksCount: windows.length,
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

module.exports = { buildPhaseEvents, sortEvents, weekStatus };
