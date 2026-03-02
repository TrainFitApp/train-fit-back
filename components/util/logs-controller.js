const logsService = require("./logs-service");

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
  try {
    // Extraer parámetros de query
    const { lines = "100", date, method, statusCode } = req.query;

    // Extraer email del usuario del token JWT
    const userEmail = req.userData?.email || "anonymous";

    // Validar que líneas sea uno de los valores permitidos
    const allowedLines = ["10", "100", "1000"];
    if (!allowedLines.includes(String(lines))) {
      return res.status(400).json({
        success: false,
        message: "El parámetro 'lines' debe ser 10, 100 o 1000",
        errors: ["Invalid lines parameter"],
      });
    }

    // Validar que method sea uno de los verbos permitidos
    if (method) {
      const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
      if (!allowedMethods.includes(method.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: "El método debe ser GET, POST, PUT o DELETE",
          errors: ["Invalid method parameter"],
        });
      }
    }

    // Construir objeto de filtros
    const filters = {
      lines,
      date: date || undefined,
      method: method ? method.toUpperCase() : undefined,
      statusCode: statusCode ? parseInt(statusCode) : undefined,
    };

    // Obtener logs del servicio (pasar el email del usuario)
    const result = logsService.getLogs(filters, userEmail);

    // Retornar resultado
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error in readLogs:", error);
    return res.status(500).json({
      success: false,
      message: "Error al leer los logs",
      errors: [error.message],
    });
  }
}

module.exports = {
  readLogs,
};
