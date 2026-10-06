const logsService = require("./logs-service");
const { badRequest } = require("./http-error");

const ALLOWED_LINES = ["10", "100", "1000"];
const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE"];

/**
 * GET /logs/read
 * Endpoint para leer logs del servidor
 * Requiere: rol ADMIN
 * Query parameters:
 *   - lines: 10, 100, 1000 (default: 100)
 *   - date: YYYY-MM-DD (opcional)
 *   - method: GET, POST, PUT, DELETE (opcional)
 *   - statusCode: código HTTP (opcional)
 */
async function readLogs(req, res) {
  const { lines = "100", date, method, statusCode } = req.query;
  if (!ALLOWED_LINES.includes(String(lines))) throw badRequest("El parámetro 'lines' debe ser 10, 100 o 1000");
  if (method && !ALLOWED_METHODS.includes(method.toUpperCase())) {
    throw badRequest("El método debe ser GET, POST, PUT o DELETE");
  }
  const filters = {
    lines,
    date: date || undefined,
    method: method ? method.toUpperCase() : undefined,
    statusCode: statusCode ? parseInt(statusCode, 10) : undefined,
  };
  res.json(logsService.getLogs(filters, req.userData?.email || "anonymous"));
}

module.exports = {
  readLogs,
};
