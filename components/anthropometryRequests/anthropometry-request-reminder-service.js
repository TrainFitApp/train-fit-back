const anthropometryRequestDao = require("./anthropometry-request-dao");
const notificationDao = require("../notifications/notification-dao");

// Mismo criterio que checkin-reminder-service.js (CADENCE_DAYS), pero en
// notificación in-app en vez de email: "que le aparezcan las
// notificaciones" es justo eso — no hace falta infraestructura de correo
// nueva para una notificación que el cliente ya ve en su bandeja (mismo
// canal que "goal_assigned"/"checkin_requested").
const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 30 };

function intervalDaysFor(request) {
  if (request.cadence === "custom") return request.customIntervalDays || 1;
  return CADENCE_DAYS[request.cadence] || 7;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Exportado aparte de runReminderJob para poder probarlo sin escribir
// notificaciones de verdad — mismo criterio que checkin-reminder-service.js.
async function findDueReminders(now = new Date()) {
  const requests = await anthropometryRequestDao.findActiveRecurring();

  const due = [];
  for (const request of requests) {
    if (!request.clientId?._id) continue; // defensivo, cliente borrado/no poblado

    const anchorDate = request.lastFulfilledAt || request.lastRequestedAt;
    const dueDate = addDays(new Date(anchorDate), intervalDaysFor(request));

    if (now < dueDate) continue; // todavía no toca
    if (request.lastReminderSentAt && new Date(request.lastReminderSentAt) >= dueDate) continue; // ya avisado este ciclo

    due.push({ request, dueDate });
  }

  return due;
}

async function sendReminder(request) {
  await notificationDao.create(request.clientId._id, request.trainerId._id, "anthropometry_requested", {
    fields: request.fields,
    cadence: request.cadence,
  });
  await anthropometryRequestDao.markReminderSent(request._id, new Date());
}

async function runReminderJob(now = new Date()) {
  const dueList = await findDueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const { request } of dueList) {
    try {
      await sendReminder(request);
      sent++;
    } catch (error) {
      failed++;
      console.error("[anthropometry-request-reminder] fallo al notificar:", request._id, error.message);
    }
  }

  return { evaluated: dueList.length, sent, failed };
}

module.exports = {
  CADENCE_DAYS,
  findDueReminders,
  sendReminder,
  runReminderJob,
};
