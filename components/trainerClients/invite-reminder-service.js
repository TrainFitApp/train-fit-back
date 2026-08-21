const TrainerClient = require("./trainer-client-schema");
const userSchema = require("../users/schema");
const { sendMailSES, generateMail } = require("../util/mail");

// TASK-065 (MASTER_BACKLOG.md) — una invitación en "pending" (enviada, el
// cliente nunca la aceptó ni rechazó) se quedaba ahí para siempre, sin
// caducidad ni ningún aviso adicional aparte del email inicial de
// inviteClient(). Recordatorio ÚNICO (no repetido, a diferencia de
// TASK-025) a los REMINDER_AFTER_DAYS de la invitación si sigue "pending" —
// no se implementa caducidad automática (cambiar el estado de una relación
// sin acción del trainer/cliente es una decisión de producto con más
// blast radius, fuera de alcance de "Complejidad: Baja").
const REMINDER_AFTER_DAYS = 3;

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function findDueReminders(now = new Date()) {
  const cutoff = addDays(now, -REMINDER_AFTER_DAYS);
  const relations = await TrainerClient.find({
    status: "pending",
    invitedAt: { $lte: cutoff },
    lastReminderSentAt: null,
  })
    .populate("trainerId", "name lastname")
    .lean();

  return relations;
}

function buildReminderEmail(relation) {
  const trainerName =
    [relation.trainerId?.name, relation.trainerId?.lastname].filter(Boolean).join(" ") || "Un profesional";
  const scopeLabel = relation.scope === "training" ? "entrenamiento" : "nutrición";
  const subject = "Tienes una invitación pendiente en TrainFit";
  const html = generateMail(
    "Invitación pendiente",
    `${trainerName} te invitó a TrainFit para llevar tu ${scopeLabel} hace unos días y todavía no has respondido. Abre la app para aceptarla o rechazarla.`,
    "https://www.trainfit.net/#/Mas",
    "Abrir TrainFit"
  );
  return { subject, html };
}

async function sendReminder(relation) {
  const { subject, html } = buildReminderEmail(relation);
  await sendMailSES(relation.clientEmail, subject, html);
  await TrainerClient.updateOne({ _id: relation._id }, { $set: { lastReminderSentAt: new Date() } });
}

async function runReminderJob(now = new Date()) {
  const dueList = await findDueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const relation of dueList) {
    try {
      await sendReminder(relation);
      sent++;
    } catch (error) {
      failed++;
      console.error("[invite-reminder] fallo al enviar recordatorio:", relation._id, error.message);
    }
  }

  return { evaluated: dueList.length, sent, failed };
}

module.exports = {
  REMINDER_AFTER_DAYS,
  findDueReminders,
  sendReminder,
  runReminderJob,
};
