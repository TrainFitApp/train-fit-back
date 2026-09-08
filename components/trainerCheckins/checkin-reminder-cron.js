const cron = require("node-cron");
const { runReminderJob } = require("./checkin-reminder-service");

// TASK-025 (MASTER_BACKLOG.md) — `node-cron` ya era una dependencia
// instalada en package.json, pero sin ningún `require()` en todo el
// backend (confirmado por grep antes de escribir esto) — cero
// infraestructura de scheduler real, coincide con el hallazgo A8 del
// audit. Corre una vez al día a las 09:00 hora del servidor. Guardado
// tras `DISABLE_CHECKIN_REMINDER_CRON=true` como válvula de apagado
// operativo sin necesitar un deploy (p. ej. si el envío de emails empieza
// a fallar en producción y hay que cortarlo mientras se investiga).
function startCheckinReminderCron() {
  if (process.env.DISABLE_CHECKIN_SCHEDULE_CRON !== "true") {
    let running = false;
    cron.schedule("* * * * *", async () => {
      if (running) return;
      running = true;
      try {
        await require("./checkin-calendar-service").processCalendar();
      } catch (error) { console.error("[checkin-calendar] Error al procesar la agenda", error.message); }
      finally { running = false; }
    });
  }
  if (process.env.DISABLE_CHECKIN_REMINDER_CRON === "true") {
    console.log("[checkin-reminder] cron desactivado por DISABLE_CHECKIN_REMINDER_CRON");
    return null;
  }

  const task = cron.schedule("0 9 * * *", async () => {
    try {
      const result = await runReminderJob();
      console.log(
        `[checkin-reminder] job diario: ${result.sent} enviados, ${result.failed} fallidos, ${result.evaluated} evaluados`
      );
    } catch (error) {
      console.error("[checkin-reminder] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[checkin-reminder] cron programado (09:00 diario)");
  return task;
}

module.exports = { startCheckinReminderCron };
