// La agenda de check-ins: qué solicitudes existen, cuál está abierta y qué
// se puede responder (docs/plan-semanas.md).
//
// No hay colección de solicitudes ni cron que las materialice: una ocurrencia
// es una fecha calculada a partir de la programación (checkin-schedule-dates.js)
// y lo único que se guarda es la respuesta. Una ocurrencia está ABIERTA desde
// su día hasta la víspera de la siguiente — dentro de esa ventana el cliente
// puede escribirla y reescribirla; fuera, ni entrar.

const Schedule = require("./checkin-schedule-schema");
const Response = require("./checkin-response-schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const notificationDao = require("../notifications/notification-dao");
const { CHECKIN_FIELDS_BY_KEY, isPlausibleValue, scaleLevelsFor } = require("./checkin-field-catalog");
const { validateCustomAnswer, normalizeCustomAnswer } = require("./checkin-custom-question");
const { occurrenceDatesBetween, occurrenceCovering, historyOccurrences } = require("./checkin-schedule-dates");
const { isoDate, addDaysToIsoDate } = require("../util/date-util");

function todayIso() {
  return isoDate(new Date());
}

/** Estado visible de una ocurrencia, con o sin respuesta. */
function occurrenceStatus(occurrence, response, today) {
  if (response) return response.status;
  if (occurrence.date > today) return "scheduled";
  if (!occurrence.next || today < occurrence.next) return "open";
  return "unanswered";
}

function isOpen(occurrence, today) {
  return occurrence.date <= today && (!occurrence.next || today < occurrence.next);
}

function entryOf(schedule, occurrence, response, today) {
  return {
    _id: `${schedule._id}:${occurrence.date}`,
    scheduleId: String(schedule._id),
    name: schedule.name,
    date: occurrence.date,
    time: schedule.time,
    closesDate: occurrence.next || null,
    status: occurrenceStatus(occurrence, response, today),
    // Lo YA respondido se lee con las preguntas que tenía entonces, no con
    // las de hoy: la programación puede haber cambiado desde entonces y el
    // histórico quedaría contado contra un formulario que nunca se usó.
    enabledFields: response?.enabledFields?.length ? response.enabledFields : schedule.enabledFields || [],
    requiredFields: response?.requiredFields?.length ? response.requiredFields : schedule.requiredFields || [],
    customQuestions: response?.customQuestions?.length ? response.customQuestions : schedule.customQuestions || [],
    values: response?.values || null,
    respondedAt: response?.respondedAt || null,
    updatedAt: response?.updatedAt || null,
    reviewedAt: response?.reviewedAt || null,
    reviewComment: response?.reviewComment || "",
    responseId: response ? String(response._id) : null,
    week: response?.week || null,
  };
}

/**
 * Una respuesta ya guardada, con la misma forma que una entrada de agenda.
 * Lo usan el histórico y "Por revisar", que necesitan `responseId` y la
 * fecha de la ocurrencia igual que el calendario.
 */
function entryOfResponse(response) {
  return {
    _id: `${response.scheduleId}:${response.occurrenceDate}`,
    scheduleId: String(response.scheduleId),
    name: response.name || "",
    date: response.occurrenceDate,
    time: "",
    closesDate: null,
    status: response.status || "responded",
    enabledFields: response.enabledFields || [],
    requiredFields: response.requiredFields || [],
    customQuestions: response.customQuestions || [],
    values: response.values || {},
    respondedAt: response.respondedAt || null,
    updatedAt: response.updatedAt || null,
    reviewedAt: response.reviewedAt || null,
    reviewComment: response.reviewComment || "",
    responseId: String(response._id),
    week: response.week || null,
  };
}

/** Agenda de un cliente entre dos fechas, con las respuestas ya unidas. */
async function agendaFor(trainerId, clientId, from, to, today = todayIso()) {
  const filtro = trainerId ? { trainerId, clientId } : { clientId };
  const schedules = await Schedule.find(filtro).sort({ createdAt: 1 }).lean();
  const responses = await Response.find({ ...filtro, occurrenceDate: { $gte: from, $lte: to } }).lean();
  const byKey = new Map(responses.map((r) => [`${r.scheduleId}:${r.occurrenceDate}`, r]));

  const entries = [];
  for (const schedule of schedules) {
    for (const occurrence of occurrenceDatesBetween(schedule, from, to)) {
      // Una programación pausada deja de generar solicitudes nuevas; las que
      // ya se respondieron siguen en la agenda.
      const response = byKey.get(`${schedule._id}:${occurrence.date}`) || null;
      if (!schedule.active && !response && occurrence.date > today) continue;
      entries.push(entryOf(schedule, occurrence, response, today));
    }
  }
  return { schedules, entries: entries.sort((a, b) => a.date.localeCompare(b.date)) };
}

/**
 * Histórico completo de UNA programación, de la ocurrencia más reciente a la
 * más antigua, respondidas o no. Pagina hacia atrás con `before` (la fecha
 * que devuelve `nextBefore`).
 */
async function scheduleHistory(schedule, { before = null, limit = 50, today = todayIso() } = {}) {
  const { occurrences, nextBefore, total } = historyOccurrences(schedule, { before, limit, today });
  if (!occurrences.length) return { entries: [], nextBefore: null, total };

  const responses = await Response.find({
    scheduleId: schedule._id,
    occurrenceDate: { $gte: occurrences[occurrences.length - 1].date, $lte: occurrences[0].date },
  }).lean();
  const byDate = new Map(responses.map((r) => [r.occurrenceDate, r]));

  return {
    entries: occurrences.map((o) => entryOf(schedule, o, byDate.get(o.date) || null, today)),
    nextBefore,
    total,
  };
}

/**
 * Las solicitudes ABIERTAS hoy de un cliente, una por programación activa.
 * Es lo que ve el cliente en su app: el aviso de "toca check-in".
 */
async function openForClient(clientId, today = todayIso(), trainerIds = null) {
  const filtro = { clientId, active: true };
  if (trainerIds) filtro.trainerId = { $in: trainerIds };
  const schedules = await Schedule.find(filtro).sort({ createdAt: 1 }).lean();
  const out = [];
  for (const schedule of schedules) {
    const occurrence = occurrenceCovering(schedule, today);
    if (!occurrence || !isOpen(occurrence, today)) continue;
    const response = await Response.findOne({ scheduleId: schedule._id, occurrenceDate: occurrence.date }).lean();
    out.push({ schedule, occurrence, response, entry: entryOf(schedule, occurrence, response, today) });
  }
  return out;
}

/**
 * Solicitudes ya CERRADAS sin respuesta, mirando hacia atrás `sinceDays`.
 * Es lo que hace que un check-in esté "vencido": no que hayan pasado N días
 * desde la última respuesta, sino que una ventana concreta se cerró vacía.
 * `open` son las que siguen sin respuesta pero todavía se pueden responder.
 *
 * Sin tope de ocurrencias: el resumen de Seguimiento mira hasta 3 años atrás
 * y una programación diaria pasa de las 400 de occurrenceDatesBetween.
 *
 * `answered` es un Set de claves "scheduleId:fecha".
 */
function missedOccurrences(schedules, answered, today, sinceDays = 60) {
  const from = addDaysToIsoDate(today, -sinceDays);
  let missed = 0;
  let expected = 0;
  let answeredCount = 0;
  let open = 0;
  let lastMissedDate = null;
  for (const schedule of schedules) {
    for (const occurrence of occurrenceDatesBetween(schedule, from, today, Infinity)) {
      const respondida = answered.has(`${schedule._id}:${occurrence.date}`);
      expected++;
      if (respondida) {
        answeredCount++;
        continue;
      }
      // Solo cuenta como perdida si su ventana ya cerró: la de hoy todavía
      // se puede responder.
      if (isOpen(occurrence, today)) {
        open++;
        continue;
      }
      missed++;
      if (!lastMissedDate || occurrence.date > lastMissedDate) lastMissedDate = occurrence.date;
    }
  }
  return { missed, expected, answered: answeredCount, open, lastMissedDate };
}

/** Abiertas y cerradas sin respuesta de un cliente en los últimos `sinceDays`. */
async function summaryFor(trainerId, clientId, sinceDays, today = todayIso()) {
  const schedules = await Schedule.find({ trainerId, clientId }).lean();
  const responses = await Response.find({
    trainerId,
    clientId,
    occurrenceDate: { $gte: addDaysToIsoDate(today, -sinceDays) },
  })
    .select("scheduleId occurrenceDate")
    .lean();
  const answered = new Set(responses.map((r) => `${r.scheduleId}:${r.occurrenceDate}`));
  const { open, missed } = missedOccurrences(schedules, answered, today, sinceDays);
  return { open, missed };
}

/** La ocurrencia abierta HOY de una programación, si aún no tiene respuesta. */
async function openUnanswered(schedule, today = todayIso()) {
  const occurrence = occurrenceCovering(schedule, today);
  if (!occurrence || !isOpen(occurrence, today)) return null;
  const answered = await Response.exists({ scheduleId: schedule._id, occurrenceDate: occurrence.date });
  return answered ? null : occurrence;
}

/** Próxima fecha (posterior a hoy) de UNA programación activa, o null. */
function nextDateOf(schedule, today) {
  if (!schedule.active) return null;
  const covering = occurrenceCovering(schedule, today);
  const candidate = covering ? covering.next : schedule.startDate;
  return candidate && candidate > today ? candidate : null;
}

/** ¿Cuándo toca el próximo check-in? La más cercana de las programaciones activas. */
function nextOccurrenceForClient(schedules, today) {
  let next = null;
  for (const schedule of schedules) {
    const candidate = nextDateOf(schedule, today);
    if (candidate && (!next || candidate < next)) next = candidate;
  }
  return next;
}

/** Valida las respuestas contra la programación. Devuelve {values} o {error}. */
function validateAnswers(schedule, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Responde al menos una pregunta" };
  const values = {};
  const questions = new Map(
    (schedule.customQuestions || []).filter((q) => q.enabled !== false).map((q) => [`custom:${q._id}`, q])
  );

  for (const key of schedule.requiredFields || []) {
    if (input[key] == null || input[key] === "") {
      return { error: `Falta responder: ${CHECKIN_FIELDS_BY_KEY.get(key)?.label || key}` };
    }
  }
  for (const [key, question] of questions) {
    if (question.required && (input[key] == null || input[key] === "")) {
      return { error: `Falta responder: ${question.label}` };
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (questions.has(key)) {
      const question = questions.get(key);
      const error = validateCustomAnswer(question, value);
      if (error) return { error };
      values[key] = normalizeCustomAnswer(question, value);
      continue;
    }
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (!field || !(schedule.enabledFields || []).includes(key)) {
      return { error: "Esa pregunta no pertenece a este check-in" };
    }
    if (field.type === "number" && !isPlausibleValue(field, value)) return { error: `Revisa el valor de ${field.label}` };
    if (field.type === "scale_1_5" && (!Number.isInteger(value) || value < 1 || value > scaleLevelsFor(field))) {
      return { error: `Revisa la escala de ${field.label}` };
    }
    if (field.type === "select" && !(field.options || []).some((o) => o.key === value)) {
      return { error: `Elige una opción de ${field.label}` };
    }
    if (field.type === "yes_no" && typeof value !== "boolean") return { error: `Responde sí o no a ${field.label}` };
    if (field.type === "text" && (typeof value !== "string" || !value.trim() || value.length > 1000)) {
      return { error: "El comentario debe tener entre 1 y 1000 caracteres" };
    }
    values[key] = typeof value === "string" ? value.trim() : value;
  }
  return Object.keys(values).length ? { values } : { error: "Responde al menos una pregunta" };
}

/**
 * Guarda (o reescribe) la respuesta de una ocurrencia abierta. Sella la
 * semana de dieta a la que pertenece y vuelca a Anthropometry lo que sea
 * composición corporal.
 */
async function saveResponse({ schedule, occurrence, values, today = todayIso() }) {
  const { weekForClientAt } = require("../planAssignments/week-service");
  const week = await weekForClientAt(schedule.clientId, occurrence.date);
  const now = new Date();

  const previous = await Response.findOne({ scheduleId: schedule._id, occurrenceDate: occurrence.date }).lean();
  const response = await Response.findOneAndUpdate(
    { scheduleId: schedule._id, occurrenceDate: occurrence.date },
    {
      $set: {
        values,
        updatedAt: now,
        seenByTrainer: false,
        status: "responded",
        reviewedAt: null,
        name: schedule.name,
        enabledFields: schedule.enabledFields || [],
        requiredFields: schedule.requiredFields || [],
        customQuestions: schedule.customQuestions || [],
        ...(week
          ? { week: { phaseId: week.phaseId, number: week.number, start: week.start, end: week.end } }
          : { week: undefined }),
      },
      $setOnInsert: {
        trainerId: schedule.trainerId,
        clientId: schedule.clientId,
        respondedAt: now,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  // La composición corporal alimenta las gráficas de peso: se escribe con la
  // fecha en que se responde, no con la de la solicitud.
  const anthropometryFields = {};
  for (const [key, value] of Object.entries(values)) {
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (field?.storage === "anthropometry") anthropometryFields[field.anthropometryField] = value;
  }
  let anthropometry = null;
  if (Object.keys(anthropometryFields).length) {
    anthropometry = await anthropometryDao.mergeAnthropometryFields(schedule.clientId, today, anthropometryFields);
  }

  await notificationDao.createForTrainer(schedule.trainerId, schedule.clientId, "checkin_responded", {
    scheduleName: schedule.name,
    occurrenceDate: occurrence.date,
  });

  return { response, anthropometry, updated: !!previous };
}

module.exports = {
  todayIso,
  missedOccurrences,
  summaryFor,
  openUnanswered,
  nextDateOf,
  nextOccurrenceForClient,
  isOpen,
  occurrenceStatus,
  entryOf,
  entryOfResponse,
  agendaFor,
  scheduleHistory,
  openForClient,
  validateAnswers,
  saveResponse,
};
