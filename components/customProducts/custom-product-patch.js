// PURO — cómo se aplica a un alimento guardado (CustomProduct embebido) lo
// que manda el cliente. Un alimento solo guarda los valores que DIFIEREN de
// su Product: un valor igual al del producto, vacío o ausente se quita (el
// alimento vuelve a leer el del producto); null se guarda tal cual ("sin
// dato", distinto de "el del producto").
//
// Antes esto se traducía a $set/$unset sobre la colección customproducts
// (custom-product-dao.js y custom-recipe-dao.js tenían cada uno su copia);
// ahora se aplica sobre el objeto embebido y se escribe el documento que lo
// contiene.

const hasOwn = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

const isBlankString = (value) => typeof value === "string" && value.trim() === "";

function areValuesEqual(left, right, epsilon = 1e-9) {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < epsilon;
  return false;
}

/**
 * Devuelve el alimento nuevo (objeto plano) a partir del guardado (`current`)
 * y lo que llega (`data`).
 *
 * - `overrideFields`: los valores que se comparan con el Product.
 * - `baseProduct`: el Product poblado (sus valores son la referencia).
 * - `blankUnsets`: en el resto de campos, una cadena vacía también los quita
 *   (así lo hacía la vía del diario; la de recetas escribía lo que llegase).
 * - `protectedFields`: campos que `data` nunca puede cambiar.
 */
function patchCustomProduct(current, data, { overrideFields, baseProduct = null, blankUnsets = true, protectedFields = [] }) {
  const next = { ...current };
  const skip = new Set(["_id", ...overrideFields, ...protectedFields]);

  for (const key of Object.keys(data || {})) {
    if (skip.has(key)) continue;
    const value = data[key];
    if (value === undefined) continue;
    if (blankUnsets && isBlankString(value)) delete next[key];
    else next[key] = value;
  }

  for (const field of overrideFields) {
    if (protectedFields.includes(field)) continue;
    const value = data?.[field];
    if (!hasOwn(data, field) || value === undefined || isBlankString(value)) {
      delete next[field];
    } else if (value === null) {
      next[field] = null;
    } else if (areValuesEqual(value, baseProduct?.[field])) {
      delete next[field];
    } else {
      next[field] = value;
    }
  }

  return next;
}

module.exports = { patchCustomProduct, areValuesEqual, isBlankString, hasOwn };
