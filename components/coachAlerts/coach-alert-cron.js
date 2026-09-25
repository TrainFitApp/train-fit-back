const cron = require("node-cron");
const { runAlertEvaluationJob } = require("./coach-alert-service");

// Fase 1 Coach Pro — una tarea diaria, apagable por variable de entorno sin
// necesidad de deploy.
//
// 05:00 y no 09:00 (la hora de los crons de email): este job lee la
// ventana completa de antropometría y los días de dieta de todos los
// clientes de la plataforma. Corriendo de madrugada no compite con el
// tráfico real, y el panel del profesional ya está calculado cuando abre la
// app por la mañana. Además evita solaparse con los dos crons de email, que
// tocan las mismas colecciones.
//
// PM2 arranca una sola instancia en modo fork (ver ecosystem.config.js), así
// que no hay riesgo de dos procesos ejecutando el job a la vez. Aun así, el
// índice único parcial sobre dedupeKey de CoachAlert impide el duplicado si
// alguien lanzara el script a mano mientras corre la tarea programada.
function startCoachAlertCron() {
  if (process.env.DISABLE_COACH_ALERT_CRON === "true") {
    console.log("[coach-alerts] cron desactivado por DISABLE_COACH_ALERT_CRON");
    return null;
  }

  const task = cron.schedule("0 5 * * *", async () => {
    try {
      const result = await runAlertEvaluationJob();
      console.log(
        `[coach-alerts] job diario: ${result.trainers} profesionales, ` +
          `${result.created} alertas nuevas, ${result.refreshed} actualizadas, ` +
          `${result.autoResolved} cerradas solas, ${result.failed} fallidos`
      );
    } catch (error) {
      console.error("[coach-alerts] error inesperado en el job diario:", error.message);
    }
  });
  console.log("[coach-alerts] cron programado (05:00 diario)");
  return task;
}

module.exports = { startCoachAlertCron };
