const fs = require("fs");
const path = require("path");

/**
 * Servicio para leer y parsear el archivo de logs
 */

const LOG_FILE_PATH = path.join(__dirname, "../../file.log");

/**
 * Parsea una línea de log y extrae información estructurada
 * Formato esperado (Morgan combined con email opcional):
 * [email@example.com] 127.0.0.1 - - [DATE] "METHOD PATH HTTP/VERSION" STATUS SIZE "REFERRER" "USER-AGENT"
 * o sin email:
 * 127.0.0.1 - - [DATE] "METHOD PATH HTTP/VERSION" STATUS SIZE "REFERRER" "USER-AGENT"
 */
function parseLogLine(line) {
  // Regex para parsear el formato Morgan combined con email opcional
  // Ejemplo: [sangovis98@gmail.com] ::1 - - [08/Dec/2025:22:36:28 +0000] "POST /api/meals HTTP/1.1" 200 2784 "http://localhost" "Mozilla/5.0"
  const regex = /^\[?([^\]]*)\]?\s+([^\s]+)\s+-\s+([^\s]+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s]+)\s+HTTP\/([^\s]+)"\s+(\d+)\s+([^\s]+|\-)\s+"([^"]*)"\s+"([^"]*)"\s*$/;
  const match = line.match(regex);

  if (!match) {
    return null;
  }

  const [, emailPart, ipAddress, remoteUser, timestamp, method, path, httpVersion, statusCode, contentLength, referrer, userAgent] = match;

  // Si emailPart contiene @, es un email, si no, es parte del IP
  let email = null;
  let ip = ipAddress;

  if (emailPart && emailPart.includes('@')) {
    email = emailPart;
  } else if (emailPart) {
    // Si no hay email, el primer grupo fue el IP
    ip = emailPart;
  }

  return {
    timestamp,
    method,
    path,
    statusCode: parseInt(statusCode),
    contentLength: contentLength === '-' ? 0 : parseInt(contentLength),
    ip,
    usuario: email || "anónimo",
    referrer,
    userAgent,
    rawLine: line,
  };
}

/**
 * Lee el archivo de logs y retorna todas las líneas parseadas
 */
function readAllLogs() {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return [];
    }

    const fileContent = fs.readFileSync(LOG_FILE_PATH, "utf8");
    const lines = fileContent.split("\n").filter((line) => line.trim());

    const parsedLogs = lines
      .map((line) => parseLogLine(line))
      .filter((log) => log !== null);

    return parsedLogs;
  } catch (error) {
    console.error("Error reading logs file:", error);
    return [];
  }
}

/**
 * Filtra logs por número de líneas (últimas N líneas)
 */
function filterByLineCount(logs, lineCount) {
  const count = parseInt(lineCount) || 100;
  return logs.slice(Math.max(0, logs.length - count));
}

/**
 * Filtra logs por fecha (YYYY-MM-DD)
 */
function filterByDate(logs, dateString) {
  if (!dateString) return logs;

  return logs.filter((log) => {
    const logDate = log.timestamp.split("T")[0];
    return logDate === dateString;
  });
}

/**
 * Filtra logs por método HTTP
 */
function filterByMethod(logs, method) {
  if (!method) return logs;

  const upperMethod = method.toUpperCase();
  return logs.filter((log) => log.method === upperMethod);
}

/**
 * Filtra logs por código HTTP
 */
function filterByStatusCode(logs, statusCode) {
  if (!statusCode) return logs;

  const code = parseInt(statusCode);
  return logs.filter((log) => log.statusCode === code);
}

/**
 * Aplica todos los filtros en orden
 */
function applyFilters(logs, filters) {
  let filtered = logs;

  // Aplicar filtro de líneas primero (siempre)
  filtered = filterByLineCount(filtered, filters.lines || 100);

  // Aplicar otros filtros si existen
  if (filters.date) {
    filtered = filterByDate(filtered, filters.date);
  }

  if (filters.method) {
    filtered = filterByMethod(filtered, filters.method);
  }

  if (filters.statusCode) {
    filtered = filterByStatusCode(filtered, filters.statusCode);
  }

  return filtered;
}

/**
 * Función principal: obtiene logs con filtros aplicados
 * @param {Object} filters - Filtros a aplicar
 * @param {String} userEmail - Email del usuario que realizó la solicitud (no se usa aquí, solo en logger.js)
 */
function getLogs(filters = {}, userEmail = "anonymous") {
  try {
    const allLogs = readAllLogs();
    const filteredLogs = applyFilters(allLogs, filters);

    return {
      success: true,
      total: allLogs.length,
      filtered: filteredLogs.length,
      logs: filteredLogs,
      errors: [],
    };
  } catch (error) {
    console.error("Error getting logs:", error);
    return {
      success: false,
      total: 0,
      filtered: 0,
      logs: [],
      errors: [error.message],
    };
  }
}

module.exports = {
  getLogs,
  readAllLogs,
  parseLogLine,
  filterByLineCount,
  filterByDate,
  filterByMethod,
  filterByStatusCode,
  applyFilters,
};
