// Error de negocio con su código HTTP: middleware/index.js#errorHandler lo
// devuelve tal cual (mensaje, `code` y los campos de `details`) en vez de
// sanearlo como un 500. Así un servicio puede rechazar una petición sin que
// el controller tenga que traducir cada caso con try/catch.
function httpError(status, message, code, details) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

// Para `.catch` de una escritura que choca con un índice único (E11000):
// la convierte en un 409 con `message`; cualquier otro error sigue igual.
function onDuplicate(message, code) {
  return (error) => {
    if (error?.code === 11000) throw httpError(409, message, code);
    throw error;
  };
}

module.exports = {
  httpError,
  onDuplicate,
  badRequest: (message, code, details) => httpError(400, message, code, details),
  forbidden: (message, code, details) => httpError(403, message, code, details),
  notFound: (message, code, details) => httpError(404, message, code, details),
  conflict: (message, code, details) => httpError(409, message, code, details),
};
