// Historial de nutrición del entrenador (ficha del cliente, abajo del todo):
// un feed plano de EVENTOS, del más reciente al más antiguo, que desglosa
// fases y SEMANAS (docs/plan-semanas.md). Responde "¿qué pasó, cuándo y cómo
// fue?": en qué fase/semana estaba el cliente, si lo cumplió, si metió
// check-in, y qué días se saltó.
//
// PURO: recibe los datos ya cargados (fase, contenidos persistidos, ventanas
// de semana, DietDays, check-ins y días saltados) y la fecha de hoy. La
// E/S vive en plan-assignment-service.js#getNutritionHistory.

const { computeRangeAdherence } = require("../dietDays/diet-days-nutrition-util");
const { contentMacroProfile } = require("../dietTemplates/diet-macro-profile");
const { LOW_ADHERENCE_PCT } = require("./week-progression");
const { overrideAt } = require("./week-content");
const { daysInRange } = require("../util/date-util");

// Tipos ordenados de "más envolvente" a "más puntual": con la misma fecha,
// primero va lo que cierra (fin de fase), luego la semana, luego lo que
// pasó dentro (check-in, día saltado) y por último el inicio de fase — así
// al apilar del más reciente al más antiguo, el inicio de una fase queda
// debajo de su S1 y el fin encima de su última semana.
const TYPE_RANK = { phase_ended: 4, week: 3, checkin: 2, skipped_day: 1, phase_started: 0 };

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
 * @param weeks      ventanas de semana ya calculadas (week-window.js)
 * @param days       DietDays del cliente entre head.startDate y hoy (o fin de fase)
 * @param checkins   CheckinResponse con week.phaseId = esta fase
 * @param skippedDates fechas saltadas del cliente (todas; se filtran aquí)
 * @param today      "YYYY-MM-DD"
 */
function buildPhaseEvents({ head, members, weeks, days, checkins, skippedDates, today }) {
  if (!head?.startDate || head.startDate > today) return [];

  const phaseId = String(head._id);
  const phaseName = head.phaseName || head.name || null;
  const base = { phaseId, phaseName };

  // Una fase cortada acaba en su endDate real; sus ventanas se calculan
  // hasta ahí y la última se recorta (la semana que estaba en marcha cuando
  // la sustituyeron no llegó a completarse).
  const tip = members[members.length - 1] || head;
  const phaseEnd = tip.endDate && tip.endDate < today ? tip.endDate : null;
  const until = phaseEnd || today;
  const windows = (weeks || []).filter((w) => w.start <= until);

  // Una semana puede contener VARIOS check-ins: con una programación diaria
  // son siete. Antes era uno por ventana porque la ventana la abría el
  // propio check-in.
  const checkinsByNumber = new Map();
  for (const c of checkins || []) {
    const number = Number(c.week?.number);
    if (!checkinsByNumber.has(number)) checkinsByNumber.set(number, []);
    checkinsByNumber.get(number).push(c);
  }
  const dayList = days || [];
  const skippedList = (skippedDates || []).filter((date) => date >= head.startDate && date <= until);

  const events = [];
  events.push({ type: "phase_started", date: head.startDate, ...base });

  let previousKcal = null;
  for (const w of windows) {
    const end = phaseEnd && w.end > phaseEnd ? phaseEnd : w.end;
    const measuredUntil = end < today ? end : today;
    const inWindow = dayList.filter((d) => d.date >= w.start && d.date <= measuredUntil);
    const adherence = computeRangeAdherence(inWindow, daysInRange(w.start, measuredUntil));
    const override = overrideAt(members, w.start) || head;
    const profile = profileOf(override);
    const weekCheckins = checkinsByNumber.get(w.number) || [];
    const weekSkipped = skippedList.filter((date) => date >= w.start && date <= end);

    events.push({
      type: "week",
      date: w.start,
      ...base,
      number: w.number,
      start: w.start,
      end,
      truncated: end !== w.end,
      overrideId: String(override._id),
      profile,
      kcalDelta: previousKcal == null ? null : Math.round(profile.kcal - previousKcal),
      adherencePct: adherence.percentage,
      adherenceDays: adherence.daysWithData,
      periodDays: adherence.periodDays,
      status: weekStatus({ end, today, adherencePct: adherence.percentage }),
      checkins: weekCheckins.map(checkinSummary),
      skippedDays: weekSkipped,
    });
    previousKcal = profile.kcal;

    for (const checkin of weekCheckins) {
      events.push({
        type: "checkin",
        date: String(new Date(checkin.respondedAt).toISOString()).slice(0, 10),
        ...base,
        number: w.number,
        checkin: checkinSummary(checkin),
      });
    }
    for (const date of weekSkipped) {
      events.push({ type: "skipped_day", date, ...base, number: w.number });
    }
  }

  if (phaseEnd) {
    events.push({
      type: "phase_ended",
      date: phaseEnd,
      ...base,
      status: tip.status === "superseded" ? "superseded" : "finished",
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
