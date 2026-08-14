const TrainerCheckinTemplate = require("./trainer-checkin-template-schema");
const CheckinResponse = require("./checkin-response-schema");
const { sendMailSES } = require("../util/mail");

// TASK-025 (MASTER_BACKLOG.md) — antes `cadence` ("weekly"/"biweekly") era
// puramente decorativo: se guardaba al aplicar una plantilla de check-in a
// un cliente, pero nada en el backend lo leía nunca para avisar de nada.
// Este módulo es la pieza que faltaba: calcula, para cada configuración
// aplicada, si el cliente "toca" (han pasado suficientes días desde su
// última respuesta, o desde que se le aplicó la plantilla si nunca
// respondió) y envía un recordatorio por email si es así.
const CADENCE_DAYS = { weekly: 7, biweekly: 14 };

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Exportado aparte de runReminderJob para poder probarlo sin enviar emails
// de verdad — mismo criterio que el resto de esta sesión (lógica pura,
// testable de forma aislada, separada del efecto secundario de I/O).
async function findDueReminders(now = new Date()) {
  const configs = await TrainerCheckinTemplate.find({
    cadence: { $in: Object.keys(CADENCE_DAYS) },
  })
    .populate("clientId", "name lastname email")
    .populate("trainerId", "name lastname")
    .lean();

  const due = [];
  for (const config of configs) {
    if (!config.clientId?.email) continue; // defensivo, mismo criterio que aggregateByOtherParty

    const lastResponse = await CheckinResponse.findOne({
      trainerId: config.trainerId?._id || config.trainerId,
      clientId: config.clientId._id,
    })
      .sort({ respondedAt: -1 })
      .select("respondedAt")
      .lean();

    const anchorDate = lastResponse?.respondedAt || config.updatedAt;
    const dueDate = addDays(new Date(anchorDate), CADENCE_DAYS[config.cadence]);

    if (now < dueDate) continue; // todavía no toca
    if (config.lastReminderSentAt && new Date(config.lastReminderSentAt) >= dueDate) continue; // ya avisado para este ciclo

    due.push({ config, dueDate });
  }

  return due;
}

function buildReminderEmail(config) {
  const trainerName = config.trainerId?.name ? `${config.trainerId.name}` : "tu entrenador";
  const clientName = config.clientId?.name || "";
  const subject = "Recordatorio: check-in pendiente en TrainFit";
  const html = `
    <p>Hola ${clientName || ""},</p>
    <p>${trainerName} te recuerda que tienes un check-in pendiente en TrainFit. Tómate un momento para rellenarlo y que pueda seguir tu progreso de cerca.</p>
    <p>— El equipo de TrainFit</p>
  `.trim();
  return { subject, html };
}

async function sendReminder(config) {
  const { subject, html } = buildReminderEmail(config);
  await sendMailSES(config.clientId.email, subject, html);
  await TrainerCheckinTemplate.updateOne(
    { _id: config._id },
    { $set: { lastReminderSentAt: new Date() } }
  );
}

async function runReminderJob(now = new Date()) {
  const dueList = await findDueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const { config } of dueList) {
    try {
      await sendReminder(config);
      sent++;
    } catch (error) {
      failed++;
      console.error("[checkin-reminder] fallo al enviar recordatorio:", config._id, error.message);
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
