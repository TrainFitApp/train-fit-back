/**
 * Utilidad para limpiar y filtrar datos antes de enviar a la base de datos
 * Evita enviar atributos null, undefined, 0, "", false o vacíos al payload
 */

/**
 * Filtra un objeto y retorna solo los campos no nulos/vacíos
 * Útil para operaciones CREATE
 *
 * OPTIMIZACIÓN: Filtra null, undefined, 0, "", y false (booleanos falsos)
 * Principio: Si un valor es "falsy", no se almacena en BD
 *
 * @param {Object} data - Objeto a limpiar
 * @param {Array<string>} excludeFields - Campos a excluir del filtrado
 * @returns {Object} Objeto limpio
 */
function cleanObject(data, excludeFields = []) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const cleaned = {};
  Object.keys(data).forEach((key) => {
    if (excludeFields.includes(key)) {
      cleaned[key] = data[key];
      return;
    }
    const val = data[key];
    // Filtrar valores "falsy": null, undefined, 0, "", false
    // Los booleanos false se tratan como null (optimización de BD)
    if (
      val !== null &&
      val !== undefined &&
      val !== 0 &&
      val !== "" &&
      val !== false
    ) {
      cleaned[key] = val;
    }
  });
  return cleaned;
}

module.exports = { cleanObject };
