// Historial de nutrición del entrenador (ficha del cliente, abajo del todo):
// un feed plano de EVENTOS, del más reciente al más antiguo, que desglosa
// fases y REVISIONES (docs/plan-revisiones.md). Responde "¿qué pasó, cuándo
// y cómo fue?": en qué fase/revisión estaba el cliente, si lo cumplió, si
// metió check-in, y qué días se saltó.
//
// PURO: recibe los datos ya cargados (fase, contenidos persistidos, ventanas
// de revisión, DietDays, check-ins y días saltados) y la fecha de hoy. La
// E/S vive en plan-assignment-service.js#getNutritionHistory.

const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { contentMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { LOW_ADHERENCE_PCT } = require("./revision-progression");
const { overrideAt } = require("./revision-content");
const { daysInRange } = require("../util/date-util");

// Tipos ordenados de "más envolvente" a "más puntual": con la misma fecha,
// primero va lo que cierra (fin de fase), luego la revisión, luego lo que
// pasó dentro (check-in, día saltado) y por último el inicio de fase — así
// al apilar del más reciente al más antiguo, el inicio de una fase queda
// debajo de su R1 y el fin encima de su última revisión.
const TYPE_RANK = { phase_ended: 4, revision: 3, checkin: 2, skipped_day: 1, phase_started: 0 };

function profileOf(doc) {
  const p = contentMacroProfile(doc);
  return { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}

// Veredicto de una revisión. `running` mientras no haya acabado; después,
// según la adherencia media de sus días con plan (mismo umbral que la
// sugerencia).
function revisionStatus({ end, today, adherencePct }) {
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
 * @param members    docs persistidos de la fase (head incluido), por startDate asc.
 *                   El fin de la fase es el endDate del ÚLTIMO.
 * @param revisions  ventanas de revisión ya calculadas (revision-window.js)
 * @param days       DietDays del cliente entre head.startDate y hoy (o fin de fase)
 * @param checkins   CheckinResponse con revision.phaseId = esta fase
 * @param skippedDates fechas saltadas del cliente (todas; se filtran aquí)
 * @param today      "YYYY-MM-DD"
 */
function buildPhaseEvents({ head, members, revisions, days, checkins, skippedDates, today }) {
  if (!head?.startDate || head.startDate > today) return [];

  const phaseId = String(head._id);
  const phaseName = head.phaseName || head.name || null;
  const base = { phaseId, phaseName };

  // Una fase cortada acaba en su endDate real; sus ventanas se calculan
  // hasta ahí y la última se recorta (la revisión que estaba en marcha cuando
  // la sustituyeron no llegó a completarse).
  const tip = members[members.length - 1] || head;
  const phaseEnd = tip.endDate && tip.endDate < today ? tip.endDate : null;
  const until = phaseEnd || today;
  const windows = (revisions || []).filter((w) => w.start <= until);

  const checkinByNumber = new Map((checkins || []).map((c) => [Number(c.revision?.number), c]));
  const dayList = days || [];
  const skippedList = (skippedDates || []).filter((date) => date >= head.startDate && date <= until);

  const events = [];
  events.push({ type: "phase_started", date: head.startDate, ...base });

  let previousKcal = null;
  for (const w of windows) {
    const windowEnd = w.end || until;
    const end = phaseEnd && windowEnd > phaseEnd ? phaseEnd : windowEnd;
    const measuredUntil = end < today ? end : today;
    const inWindow = dayList.filter((d) => d.date >= w.start && d.date <= measuredUntil);
    const adherence = computeRangeAdherence(inWindow, daysInRange(w.start, measuredUntil));
    const override = overrideAt(members, w.start) || head;
    const profile = profileOf(override);
    const checkin = checkinByNumber.get(w.number) || null;
    const revisionSkipped = skippedList.filter((date) => date >= w.start && date <= end);

    events.push({
      type: "revision",
      date: w.start,
      ...base,
      number: w.number,
      start: w.start,
      end,
      truncated: end !== windowEnd,
      overrideId: String(override._id),
      profile,
      kcalDelta: previousKcal == null ? null : Math.round(profile.kcal - previousKcal),
      adherencePct: adherence.percentage,
      adherenceDays: adherence.daysWithData,
      periodDays: adherence.periodDays,
      status: revisionStatus({ end, today, adherencePct: adherence.percentage }),
      checkin: checkinSummary(checkin),
      skippedDays: revisionSkipped,
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
    for (const date of revisionSkipped) {
      events.push({ type: "skipped_day", date, ...base, number: w.number });
    }
  }

  if (phaseEnd) {
    events.push({
      type: "phase_ended",
      date: phaseEnd,
      ...base,
      status: tip.status === "superseded" ? "superseded" : "finished",
      revisionsCount: windows.length,
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

module.exports = { buildPhaseEvents, sortEvents, revisionStatus };
