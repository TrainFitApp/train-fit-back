const TrainerCheckinTemplate = require("./trainer-checkin-template-schema");
const CheckinResponse = require("./checkin-response-schema");
const { sendMailSES, generateNotificationMail } = require("../util/mail");
const { isCheckinDue } = require("./checkin-service");

// Calcula, para cada configuración de check-in aplicada, si el cliente
// "toca" (usa el mismo isCheckinDue central que el dashboard, funcionalidad
// 14 — sin redefinir umbrales aparte) y envía un recordatorio por email si
// es así. Exportado aparte de runReminderJob para poder probarlo sin
// enviar emails de verdad.
async function findDueReminders(now = new Date()) {
  const configs = await TrainerCheckinTemplate.find({
    cadence: { $in: ["weekly", "biweekly", "once"] },
  })
    .populate("clientId", "name lastname email")
    .populate("trainerId", "name lastname")
    .lean();

  const due = [];
  for (const config of configs) {
    if (!config.clientId?.email) continue;

    const responses = await CheckinResponse.find({
      trainerId: config.trainerId?._id || config.trainerId,
      clientId: config.clientId._id,
    })
      .sort({ respondedAt: -1 })
      .select("respondedAt")
      .lean();

    if (!isCheckinDue(config, responses)) continue;

    // Evita reenviar el mismo día si el cron corre más de una vez.
    if (config.lastReminderSentAt) {
      const sameDay =
        new Date(config.lastReminderSentAt).toDateString() === now.toDateString();
      if (sameDay) continue;
    }

    due.push(config);
  }

  return due;
}

function sendReminderEmail(config) {
  const trainerName = config.trainerId?.name || "Tu entrenador";
  const header = "Tienes un check-in pendiente";
  const description = `${trainerName} te recuerda que tienes un check-in pendiente en TrainFit. Tómate un momento para rellenarlo y que pueda seguir tu progreso de cerca.`;

  return sendMailSES(
    config.clientId.email,
    "Recordatorio: check-in pendiente - TrainFit",
    generateNotificationMail(header, description, [])
  );
}

async function runReminderJob() {
  const due = await findDueReminders();
  let sent = 0;
  let failed = 0;

  for (const config of due) {
    try {
      await sendReminderEmail(config);
      await TrainerCheckinTemplate.findByIdAndUpdate(config._id, {
        $set: { lastReminderSentAt: new Date() },
      });
      sent++;
    } catch (error) {
      console.error("[CHECKIN_REMINDER] send_failed", {
        clientId: config.clientId?._id,
        message: error?.message,
      });
      failed++;
    }
  }

  return { evaluated: due.length, sent, failed };
}

module.exports = { findDueReminders, runReminderJob };
