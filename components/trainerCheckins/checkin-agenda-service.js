// La agenda de check-ins: qué solicitudes existen, cuál está abierta y qué
// se puede responder (docs/plan-semanas.md).
//
// No hay colección de solicitudes ni cron que las materialice: una ocurrencia
// es una fecha calculada a partir de la programación (checkin-schedule-dates.js)
// y lo único que se guarda es la respuesta. Una ocurrencia está ABIERTA desde
// su día hasta la víspera de la siguiente — dentro de esa ventana el cliente
// puede escribirla y reescribirla; fuera, ni entrar.

const checkinDao = require("./checkin-dao");
const checkinScheduleDao = require("./checkin-schedule-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { ownViews, checkinWritableFields } = require("../anthropometry/anthropometry-origin");
const notificationDao = require("../notifications/notification-dao");
const { CHECKIN_FIELDS_BY_KEY, isPlausibleValue, scaleLevelsFor } = require("./checkin-field-catalog");
const { validateCustomAnswer, normalizeCustomAnswer } = require("../forms/custom-question");
const { prefillWindow, anthropometryPrefill, changedAnthropometryFields } = require("./checkin-prefill");
const { occurrenceDatesBetween, occurrenceCovering, historyOccurrences } = require("./checkin-schedule-dates");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");

// `today` en todas las funciones = hoy en la zona horaria del CLIENTE (es su
// check-in): lo resuelve quien llama, ver util/date-util.js.


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
async function agendaFor(trainerId, clientId, from, to, today) {
  const filtro = trainerId ? { trainerId, clientId } : { clientId };
  const schedules = await checkinScheduleDao.listWhere(filtro);
  const responses = await checkinDao.listResponsesWhere({ ...filtro, occurrenceDate: { $gte: from, $lte: to } });
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
async function scheduleHistory(schedule, { before = null, limit = 50, today } = {}) {
  const { occurrences, nextBefore, total } = historyOccurrences(schedule, { before, limit, today });
  if (!occurrences.length) return { entries: [], nextBefore: null, total };

  const responses = await checkinDao.listResponsesWhere({
    scheduleId: schedule._id,
    occurrenceDate: { $gte: occurrences[occurrences.length - 1].date, $lte: occurrences[0].date },
  });
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
async function openForClient(clientId, today, trainerIds = null) {
  const filtro = { clientId, active: true };
  if (trainerIds) filtro.trainerId = { $in: trainerIds };
  const schedules = await checkinScheduleDao.listWhere(filtro);
  const out = [];
  for (const schedule of schedules) {
    const occurrence = occurrenceCovering(schedule, today);
    if (!occurrence || !isOpen(occurrence, today)) continue;
    const response = await checkinDao.findOccurrenceResponse(schedule._id, occurrence.date);
    out.push({ schedule, occurrence, response, entry: entryOf(schedule, occurrence, response, today) });
  }
  return out;
}

/**
 * Medidas que el cliente ya apuntó dentro del periodo de este check-in, para
 * rellenar el formulario (checkin-prefill.js). Solo rellena: no responde.
 */
async function prefillFor(clientId, schedule, occurrence, today) {
  const window = prefillWindow(schedule, occurrence, today);
  // Solo lo que apuntó el cliente: las respuestas de check-ins anteriores no
  // rellenan el siguiente.
  const anthropometries = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(clientId, window.from, window.to);
  return anthropometryPrefill(schedule.enabledFields, ownViews(anthropometries), window);
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
async function summaryFor(trainerId, clientId, sinceDays, today) {
  const schedules = await checkinScheduleDao.listWhere({ trainerId, clientId });
  const responses = await checkinDao.listResponsesWhere(
    { trainerId, clientId, occurrenceDate: { $gte: addDaysToIsoDate(today, -sinceDays) } },
    "scheduleId occurrenceDate",
  );
  const answered = new Set(responses.map((r) => `${r.scheduleId}:${r.occurrenceDate}`));
  const { open, missed } = missedOccurrences(schedules, answered, today, sinceDays);
  return { open, missed };
}

/** La ocurrencia abierta HOY de una programación, si aún no tiene respuesta. */
async function openUnanswered(schedule, today) {
  const occurrence = occurrenceCovering(schedule, today);
  if (!occurrence || !isOpen(occurrence, today)) return null;
  const answered = await checkinDao.findOccurrenceResponse(schedule._id, occurrence.date, "_id");
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
    // Fotos: el _id del día de progreso. Que sea suyo y tenga fotos lo
    // comprueba validatePhotoAnswers (necesita Mongo).
    if (field.type === "photos" && !/^[a-f0-9]{24}$/i.test(String(value))) {
      return { error: `Añade las fotos de ${field.label}` };
    }
    values[key] = typeof value === "string" ? value.trim() : value;
  }
  return Object.keys(values).length ? { values } : { error: "Responde al menos una pregunta" };
}

/**
 * Las respuestas de tipo fotos apuntan a un día de progreso del propio
 * cliente con al menos una foto. Devuelve { error } o {}.
 */
async function validatePhotoAnswers(clientId, values) {
  const progressMediaService = require("../progressMedia/progress-media-service");
  for (const [key, value] of Object.entries(values || {})) {
    if (CHECKIN_FIELDS_BY_KEY.get(key)?.type !== "photos") continue;
    const day = await progressMediaService.dayForCheckin(clientId, value);
    if (!day) return { error: "Añade al menos una foto antes de enviar" };
  }
  return {};
}

/**
 * Guarda (o reescribe) la respuesta de una ocurrencia abierta. Sella la
 * semana de dieta a la que pertenece y vuelca a Anthropometry lo que sea
 * composición corporal.
 */
async function saveResponse({ schedule, occurrence, values, today }) {
  const { weekForClientAt } = require("../dietPhases/week-service");
  const week = await weekForClientAt(schedule.clientId, occurrence.date);
  const prefill = await prefillFor(schedule.clientId, schedule, occurrence, today);
  const now = new Date();

  const previous = await checkinDao.findOccurrenceResponse(schedule._id, occurrence.date);
  const response = await checkinDao.upsertOccurrenceResponse(schedule._id, occurrence.date, {
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
  });

  // La composición corporal alimenta las gráficas de peso: se escribe con la
  // fecha en que se responde, no con la de la solicitud. Lo que llegó del
  // autorrelleno sin tocar ya está guardado en su día: no se duplica hoy.
  // Se marca como check-in (el cliente no lo ve en sus pantallas) y nunca
  // pisa lo que el cliente apuntó él mismo ese día.
  const existing = await anthropometryDao.getAnthropometryByUserIdAndDate(schedule.clientId, today);
  const anthropometryFields = checkinWritableFields(existing, changedAnthropometryFields(values, prefill));
  let anthropometry = null;
  if (Object.keys(anthropometryFields).length) {
    anthropometry = await anthropometryDao.mergeAnthropometryFields(schedule.clientId, today, anthropometryFields, {
      fromCheckin: true,
    });
  }

  // Los días de fotos enviados quedan enlazados a esta respuesta: para este
  // profesional son visibles siempre (responder ya es enviárselos).
  for (const [key, value] of Object.entries(values)) {
    if (CHECKIN_FIELDS_BY_KEY.get(key)?.type !== "photos") continue;
    await require("../progressMedia/progress-media-service").linkCheckin(value, response._id, schedule.trainerId);
  }

  await notificationDao.createForTrainer(schedule.trainerId, schedule.clientId, "checkin_responded", {
    scheduleName: schedule.name,
    occurrenceDate: occurrence.date,
  });

  return { response, anthropometry, updated: !!previous };
}

/**
 * La agenda de un cliente para la ficha: programaciones (con su próxima
 * fecha), ocurrencias del rango y todas sus respuestas. Las respuestas viajan
 * con la MISMA forma que las entradas de la agenda (no el documento crudo):
 * "Por revisar" y la comparación entre respuestas leen `responseId`/`date`
 * igual que el calendario.
 */
async function agendaView(trainerId, clientId, from, to) {
  const today = await todayForUser(clientId);
  const { schedules, entries } = await agendaFor(trainerId, clientId, from, to, today);
  const responses = (await checkinDao.listResponses(trainerId, clientId)).map(entryOfResponse);
  return {
    schedules: schedules.map((schedule) => ({ ...schedule, nextDate: nextDateOf(schedule, today) })),
    entries,
    responses,
    reviewCount: responses.filter((response) => response.status === "responded").length,
  };
}

module.exports = {
  agendaView,
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
  prefillFor,
  validateAnswers,
  validatePhotoAnswers,
  saveResponse,
};
