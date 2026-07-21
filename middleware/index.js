const createError = require("http-errors");
const { auth, basicAuth } = require("./validateAuth");

module.exports.validateAuth = auth(["user", "admin"]);
module.exports.auth = auth;
module.exports.basicAuth = basicAuth;

module.exports.error404Handler = (req, res, next) => {
  next(createError(404));
};

const DEFAULT_ERROR_MESSAGE = "Ha ocurrido un error inesperado";
const CLIENT_ERROR_MESSAGES = {
  400: "Solicitud inválida",
  401: "No autorizado",
  403: "Acceso no permitido",
  404: "Recurso no encontrado",
  429: "Demasiadas solicitudes. Inténtalo de nuevo más tarde",
};
const TECHNICAL_ERROR_PATTERN =
  /(\/api\/|https?:\/\/|stack|trace|TypeError|ReferenceError|SyntaxError|AxiosError|Mongo|CastError|ECONN|ETIMEDOUT|ENOTFOUND|Cannot\s)/i;

function getStatusCode(err) {
  if (err?.name === "ValidationError") return 400;
  const status = Number(err?.status || err?.statusCode || 500);
  return status >= 400 && status < 600 ? status : 500;
}

function getPublicErrorMessage(err, status) {
  if (status >= 500) {
    return DEFAULT_ERROR_MESSAGE;
  }

  const message =
    typeof err?.publicMessage === "string" ? err.publicMessage.trim() : "";
  if (message && !TECHNICAL_ERROR_PATTERN.test(message)) {
    return message;
  }

  return CLIENT_ERROR_MESSAGES[status] || DEFAULT_ERROR_MESSAGE;
}

// eslint-disable-next-line
module.exports.errorHandler = (err, req, res, _next) => {
  const status = getStatusCode(err);
  const message = getPublicErrorMessage(err, status);

  // set locals, only providing error in development
  res.locals.message = message;
  res.locals.error = ["dev", "development"].includes(req.app.get("env"))
    ? err
    : {};

  res.status(status);
  res.send({ message });
};
