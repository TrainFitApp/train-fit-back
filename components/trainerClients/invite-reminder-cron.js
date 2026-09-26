const cron = require("node-cron");
const { runReminderJob } = require("./invite-reminder-service");

// TASK-065 (MASTER_BACKLOG.md) — mismo patrón que TASK-025 (el antiguo
// cron de alertas, ya retirado): corre una vez al día, con su propia válvula
// de apagado por variable de entorno. Horario distinto (09:15 en vez de
// 09:00) para no acumular ambos jobs en el mismo tick del scheduler.
function startInviteReminderCron() {
  if (process.env.DISABLE_INVITE_REMINDER_CRON === "true") {
    console.log("[invite-reminder] cron desactivado por DISABLE_INVITE_REMINDER_CRON");
    return null;
  }

  const task = cron.schedule("15 9 * * *", async () => {
    try {
      const result = await runReminderJob();
      console.log(
        `[invite-reminder] job diario: ${result.sent} enviados, ${result.failed} fallidos, ${result.evaluated} evaluados`
      );
    } catch (error) {
      console.error("[invite-reminder] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[invite-reminder] cron programado (09:15 diario)");
  return task;
}

module.exports = { startInviteReminderCron };
