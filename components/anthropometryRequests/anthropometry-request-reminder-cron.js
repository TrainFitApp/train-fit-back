const cron = require("node-cron");
const { runReminderJob } = require("./anthropometry-request-reminder-service");

// Mismo patrón que checkin-reminder-cron.js — corre una vez al día, 5 min
// después del de check-ins para no competir por conexión a Mongo en el
// mismo instante. Interruptor de apagado propio (no comparte el de
// check-ins: son features independientes).
function startAnthropometryRequestReminderCron() {
  if (process.env.DISABLE_ANTHROPOMETRY_REMINDER_CRON === "true") {
    console.log("[anthropometry-request-reminder] cron desactivado por DISABLE_ANTHROPOMETRY_REMINDER_CRON");
    return null;
  }

  const task = cron.schedule("5 9 * * *", async () => {
    try {
      const result = await runReminderJob();
      console.log(
        `[anthropometry-request-reminder] job diario: ${result.sent} enviados, ${result.failed} fallidos, ${result.evaluated} evaluados`
      );
    } catch (error) {
      console.error("[anthropometry-request-reminder] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[anthropometry-request-reminder] cron programado (09:05 diario)");
  return task;
}

module.exports = { startAnthropometryRequestReminderCron };
