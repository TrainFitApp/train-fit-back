// Fase 1 Coach Pro — "¿toca ya el check-in de este cliente?" en UN solo
// sitio. Antes vivía dentro de coach-dashboard-controller.js y
// trainer-client-controller.js lo importaba DESDE ALLÍ (controller ->
// controller, saltándose la capa de servicios), mientras
// checkin-reminder-service.js mantenía su propia copia de la tabla de
// cadencias. Tres consumidores, dos definiciones del mismo número: al
// añadir el evaluador de alertas (coach-alert-service.js) habría sido una
// cuarta. Módulo puro, sin BD — el mismo criterio que ya usaban los tres.
//
// Días sin respuesta que hacen que un check-in se considere "pendiente"
// para cada cadencia recurrente (ver TrainerCheckinTemplate.cadence).
// "once" NO está aquí a propósito: no es recurrente, no vence nunca tras la
// primera respuesta — checkin-reminder-service.js usa las claves de este
// objeto para filtrar en la query justamente por eso.
const CHECKIN_CADENCE_DAYS = { weekly: 7, biweekly: 14 };

const DEFAULT_CADENCE_DAYS = 7;

function cadenceDays(cadence) {
  return CHECKIN_CADENCE_DAYS[cadence] || DEFAULT_CADENCE_DAYS;
}

// `responses` viene ordenado desc por respondedAt (listResponses ya lo
// garantiza) — solo se mira el primero.
// `now` inyectable, igual que checkinOverdueCycles: usaba Date.now() fijo,
// así que detectCheckinOverdue recibía un `now` que esta puerta de entrada
// IGNORABA. Con el reloj real cerca del `now` pedido la diferencia no se
// nota, pero cualquier evaluación fuera del presente (un test con fecha
// fija, reevaluar un histórico) decidía "pendiente" con otro reloj distinto
// al que luego contaba los ciclos.
function isCheckinDue(config, responses, now = new Date()) {
  const lastResponse = responses[0];
  // "once": pendiente únicamente si nunca se ha respondido — a diferencia de
  // weekly/biweekly, una vez respondida no vuelve a estar pendiente.
  if (config.cadence === "once") return !lastResponse;
  if (!lastResponse) return true;
  const elapsedDays = (now.getTime() - new Date(lastResponse.respondedAt).getTime()) / 86400000;
  return elapsedDays >= cadenceDays(config.cadence);
}

// Cuántos ciclos completos de cadencia lleva vencido — 0 si no está
// pendiente. Sirve para priorizar: un check-in de hace 3 semanas con
// cadencia semanal es más urgente que uno de hace 8 días, algo que el
// booleano de isCheckinDue por sí solo no distingue. Para "once" siempre
// devuelve 1 cuando está pendiente (no hay ciclos que acumular).
function checkinOverdueCycles(config, responses, now = new Date()) {
  if (!isCheckinDue(config, responses, now)) return 0;
  const lastResponse = responses[0];
  if (config.cadence === "once" || !lastResponse) return 1;
  const elapsedDays = (now.getTime() - new Date(lastResponse.respondedAt).getTime()) / 86400000;
  return Math.max(1, Math.floor(elapsedDays / cadenceDays(config.cadence)));
}

module.exports = { CHECKIN_CADENCE_DAYS, cadenceDays, isCheckinDue, checkinOverdueCycles };
