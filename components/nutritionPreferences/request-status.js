// PURO — ¿el cliente tiene pendiente responder una solicitud de
// preferencias? Pendiente si la solicitud es posterior a la última
// respuesta. Antes bastaba con "sin respondedAt", pero el intake y la
// edición del entrenador ya lo estampan, y una solicitud posterior nunca
// llegaba a "Pendiente de ti".
function isRequestPending(preferences) {
  if (!preferences?.requestedAt) return false;
  if (!preferences.respondedAt) return true;
  return new Date(preferences.requestedAt) > new Date(preferences.respondedAt);
}

module.exports = { isRequestPending };
