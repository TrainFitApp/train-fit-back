// Quién aporta las fechas que parten una fase en revisiones: los check-ins
// programados del cliente (docs/plan-revisiones.md). Une CheckinSchedule con
// revision-window.js y con las fases de dieta.
//
// Las fechas PASADAS salen de todas las programaciones (aunque hoy estén
// pausadas: esos check-ins existieron y partieron el tiempo igual); las
// FUTURAS solo de las activas, y únicamente las tres siguientes — lo justo
// para saber cuándo acaba la revisión en curso y cuándo empieza la próxima.

const CheckinSchedule = require("../trainerCheckins/checkin-schedule-schema");
const { occurrenceDatesBetween, occurrenceDate, occurrenceCovering } = require("../trainerCheckins/checkin-schedule-dates");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { buildRevisions, revisionAt, currentRevision, nextRevision } = require("./revision-window");
const { isoDate } = require("../util/date-util");

const FUTURE_OCCURRENCES = 3;

/** Todas las programaciones de check-in del cliente. */
async function schedulesOfClient(clientId) {
  return CheckinSchedule.find({ clientId }).sort({ createdAt: 1 }).lean();
}

/** Fechas de check-in que cortan el tiempo del cliente en revisiones. */
function boundariesFromSchedules(schedules, from, today) {
  const dates = [];
  for (const schedule of schedules) {
    for (const { date } of occurrenceDatesBetween(schedule, from, today)) dates.push(date);
    if (!schedule.active) continue;
    const covering = occurrenceCovering(schedule, today);
    let index = covering ? covering.index + 1 : 0;
    for (let i = 0; i < FUTURE_OCCURRENCES; i++, index++) {
      const date = occurrenceDate(schedule, index);
      if (!date) break;
      if (date > today) dates.push(date);
    }
  }
  return [...new Set(dates)].sort();
}

/**
 * Revisiones de una fase: sus ventanas numeradas, más la programación que
 * las genera (para avisar en la ficha cuando no hay ninguna).
 */
async function revisionsOfPhase(clientId, head, members, today = isoDate(new Date())) {
  const phaseStart = head.startDate;
  const last = members[members.length - 1];
  const phaseEnd = last?.endDate || null;
  const schedules = await schedulesOfClient(clientId);
  const hasta = phaseEnd && phaseEnd < today ? phaseEnd : today;
  const boundaries = boundariesFromSchedules(schedules, phaseStart, hasta);
  const revisions = buildRevisions(phaseStart, phaseEnd, boundaries);
  return { revisions, schedules, phaseEnd };
}

/**
 * ¿En qué revisión de qué fase está el cliente en esa fecha? null si ese día
 * no hay fase de dieta. Lo usan el check-in (para sellar la respuesta) y la
 * app del cliente.
 */
async function revisionForClientAt(clientId, date) {
  const covering = await dietTemplateDao.findCoveringDate(clientId, date);
  if (!covering?.phaseId) return null;
  const head = await dietTemplateDao.findPhaseHead(covering.phaseId);
  if (!head?.startDate) return null;
  const members = await dietTemplateDao.findPhaseMembers(covering.phaseId);
  const { revisions } = await revisionsOfPhase(clientId, head, members, date);
  const window = revisionAt(revisions, date) || currentRevision(revisions, date);
  if (!window) return null;
  return {
    phaseId: String(head._id),
    phaseName: head.phaseName || head.name || null,
    number: window.number,
    start: window.start,
    end: window.end,
  };
}

module.exports = {
  schedulesOfClient,
  boundariesFromSchedules,
  revisionsOfPhase,
  revisionForClientAt,
  revisionAt,
  currentRevision,
  nextRevision,
};
