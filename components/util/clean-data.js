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

/**
 * Prepara un objeto para operación UPDATE con $set/$unset
 * Útil para operaciones UPDATE que requieren separar campos a establecer vs desestablecer
 *
 * OPTIMIZACIÓN: Filtra null, undefined, 0, "", y false (booleanos falsos)
 * Principio: Si un valor es "falsy", se hace UNSET en BD (no se almacena)
 *
 * @param {Object} data - Objeto a limpiar
 * @param {Object} options - Opciones adicionales
 *  - booleanFields: Array de campos booleanos (se unset si false)
 *  - criticalFields: Array de campos críticos que no se deben unset
 *  - excludeFields: Array de campos a excluir completamente
 * @returns {Object} { $set: {...}, $unset: {...} }
 */
function prepareUpdateQuery(data, options = {}) {
  if (!data || typeof data !== "object") {
    return {};
  }

  const {
    booleanFields = [],
    criticalFields = [],
    excludeFields = [],
    unsetMissingFields = false,
    allFields = [],
    protectedUnsetFields = [],
  } = options;

  const toSet = {};
  const toUnset = {};

  Object.keys(data).forEach((key) => {
    // Saltar campos excluidos
    if (excludeFields.includes(key)) return;

    const val = data[key];

    // Manejo especial de campos booleanos
    if (booleanFields.includes(key)) {
      if (val) {
        toSet[key] = true;
      } else {
        // false = unset (no se almacena en BD)
        toUnset[key] = "";
      }
      return;
    }

    // Manejo especial de campos críticos (nunca se unset, pero validar valor)
    if (criticalFields.includes(key)) {
      if (val !== null && val !== undefined && val !== "" && val !== false) {
        toSet[key] = val;
      }
      return;
    }

    // Manejo estándar: si es null/0/vacío/false, unset; si no, set
    // false se trata igual que null (optimización de BD)
    if (
      val === null ||
      val === undefined ||
      val === 0 ||
      val === "" ||
      val === false
    ) {
      toUnset[key] = "";
    } else {
      toSet[key] = val;
    }
  });

  if (unsetMissingFields && Array.isArray(allFields) && allFields.length > 0) {
    allFields.forEach((field) => {
      if (excludeFields.includes(field)) return;
      if (protectedUnsetFields.includes(field)) return;
      if (criticalFields.includes(field)) return;
      if (Object.prototype.hasOwnProperty.call(data, field)) return;
      toUnset[field] = "";
    });
  }

  const queryUpdate = {};
  if (Object.keys(toSet).length > 0) queryUpdate.$set = toSet;
  if (Object.keys(toUnset).length > 0) queryUpdate.$unset = toUnset;

  return queryUpdate;
}

module.exports = { cleanObject, prepareUpdateQuery };
