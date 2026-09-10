const weightPlanDao = require("./weight-plan-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const notificationDao = require("../notifications/notification-dao");
const { complianceFor, reminderIsDue } = require("./weight-plan-service");

// Exportado aparte de runReminderJob para poder probarlo sin escribir
// notificaciones de verdad — mismo criterio que el resto de servicios de
// recordatorio de este backend.
async function findDueReminders(now = new Date()) {
  const plans = await weightPlanDao.findAllPopulated();
  if (!plans.length) return [];

  // Un solo viaje a Anthropometry para todas las pautas, no uno por cliente.
  const clientIds = plans.map((plan) => plan.clientId?._id).filter(Boolean);
  const lastWeightByClient = await anthropometryDao.lastWeightByUsers(clientIds);

  const due = [];
  for (const plan of plans) {
    if (!plan.clientId?._id) continue; // defensivo: cliente borrado
    const compliance = complianceFor(plan, lastWeightByClient.get(String(plan.clientId._id)), now);
    if (reminderIsDue(plan, compliance, now)) due.push({ plan, compliance });
  }
  return due;
}

async function sendReminder(plan, compliance) {
  await notificationDao.create(plan.clientId._id, plan.trainerId._id ?? plan.trainerId, "weight_due", {
    intervalDays: compliance.intervalDays,
    overdueDays: compliance.overdueDays,
  });
  await weightPlanDao.markReminderSent(plan._id, new Date());
}

async function runReminderJob(now = new Date()) {
  const dueList = await findDueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const { plan, compliance } of dueList) {
    try {
      await sendReminder(plan, compliance);
      sent++;
    } catch (error) {
      failed++;
      console.error("[weight-plan-reminder] fallo al notificar:", plan._id, error.message);
    }
  }

  return { evaluated: dueList.length, sent, failed };
}

module.exports = { findDueReminders, sendReminder, runReminderJob };
