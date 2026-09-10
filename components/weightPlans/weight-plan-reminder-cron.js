const cron = require("node-cron");
const { runReminderJob } = require("./weight-plan-reminder-service");

// Hereda el hueco horario del cron al que sustituye (el de peticiones de
// medidas), 5 minutos después del de check-ins para no competir por la
// conexión a Mongo en el mismo instante. Interruptor propio: es una feature
// independiente de los check-ins.
function startWeightPlanReminderCron() {
  if (process.env.DISABLE_WEIGHT_PLAN_REMINDER_CRON === "true") {
    console.log("[weight-plan-reminder] cron desactivado por DISABLE_WEIGHT_PLAN_REMINDER_CRON");
    return null;
  }

  const task = cron.schedule("5 9 * * *", async () => {
    try {
      const result = await runReminderJob();
      console.log(
        `[weight-plan-reminder] job diario: ${result.sent} enviados, ${result.failed} fallidos, ${result.evaluated} evaluados`
      );
    } catch (error) {
      console.error("[weight-plan-reminder] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[weight-plan-reminder] cron programado (09:05 diario)");
  return task;
}

module.exports = { startWeightPlanReminderCron };
