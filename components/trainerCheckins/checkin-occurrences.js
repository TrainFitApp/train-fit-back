// "¿Cuántos check-ins tocaban y cuántos contestó?" en UN solo sitio.
//
// Sustituye a checkin-due.js, que contaba ciclos a partir de una cadencia
// declarada (weekly/biweekly) y de la fecha de la última respuesta. Aquello
// tenía dos problemas: solo entendía el sistema legacy —un check-in del
// calendario devolvía "sin cadencia", no puntuaba en la adherencia y salía
// como "Sin check-in configurado" en la Cartera aunque el cliente estuviera
// respondiendo— y además inventaba los ciclos en vez de mirarlos.
//
// Ahora no hay nada que inventar: cada ocurrencia es un CheckinRequest real,
// con su fecha de apertura y su fecha de cierre. Se cuentan documentos, no
// semanas teóricas.
//
// Qué entra en el denominador y qué no:
//   · Respondida (o ya revisada)  → cuenta, y cuenta a favor.
//   · Cerrada sin responder       → cuenta, y cuenta en contra. Es el hueco
//                                   que se decidió dejar visible en vez de
//                                   acumular formularios atrasados.
//   · Todavía abierta             → NO cuenta. El cliente aún está a tiempo;
//                                   meterla en el denominador sería contar
//                                   como fallo algo que puede contestar hoy.
//   · Cancelada por el trainer    → NO cuenta. No es un incumplimiento del
//                                   cliente.

const ANSWERED_STATUSES = new Set(["responded", "reviewed"]);

function isAnswered(request) {
  return ANSWERED_STATUSES.has(request?.status);
}

// Cerrada: o el sistema ya la marcó "unanswered", o pasó su fecha de cierre
// sin respuesta. Sin closesAt (una solicitud puntual sin siguiente
// ocurrencia) nunca se cierra sola: se queda esperando indefinidamente, que
// es justo lo que significa "cuando puedas".
function isClosedUnanswered(request, now = new Date()) {
  if (!request || isAnswered(request) || request.status === "cancelled") return false;
  if (request.status === "unanswered") return true;
  return !!request.closesAt && new Date(request.closesAt) <= now;
}

function isOpen(request, now = new Date()) {
  if (!request || isAnswered(request) || request.status === "cancelled") return false;
  return !isClosedUnanswered(request, now);
}

/**
 * Reparte las ocurrencias de una ventana en respondidas / perdidas / abiertas.
 *
 * `requests` ya viene acotado a la ventana por quien consulta; aquí solo se
 * descartan las que todavía no habían llegado a abrirse.
 */
function summarizeOccurrences(requests = [], now = new Date()) {
  let answered = 0;
  let missed = 0;
  let open = 0;

  for (const request of requests) {
    // Una ocurrencia futura no se le debe a nadie todavía.
    if (request?.scheduledAt && new Date(request.scheduledAt) > now) continue;
    if (isAnswered(request)) answered++;
    else if (isClosedUnanswered(request, now)) missed++;
    else if (isOpen(request, now)) open++;
  }

  return { answered, missed, open, resolved: answered + missed };
}

module.exports = {
  isAnswered,
  isClosedUnanswered,
  isOpen,
  summarizeOccurrences,
};
