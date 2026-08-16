const cron = require("node-cron");
const { runReminderJob } = require("./checkin-reminder-service");

// `node-cron` ya era una dependencia instalada en package.json sin ningún
// require() en todo el backend — cero infraestructura de scheduler real
// hasta ahora. Corre una vez al día a las 09:00 hora del servidor.
// DISABLE_CHECKIN_REMINDER_CRON=true como válvula de apagado operativo sin
// necesitar un deploy.
function startCheckinReminderCron() {
  if (process.env.DISABLE_CHECKIN_REMINDER_CRON === "true") {
    console.log("[CHECKIN_REMINDER] cron desactivado por DISABLE_CHECKIN_REMINDER_CRON");
    return null;
  }

  const task = cron.schedule("0 9 * * *", async () => {
    try {
      const result = await runReminderJob();
      console.log(
        `[CHECKIN_REMINDER] job diario: ${result.sent} enviados, ${result.failed} fallidos, ${result.evaluated} evaluados`
      );
    } catch (error) {
      console.error("[CHECKIN_REMINDER] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[CHECKIN_REMINDER] cron programado (09:00 diario)");
  return task;
}

module.exports = { startCheckinReminderCron };
