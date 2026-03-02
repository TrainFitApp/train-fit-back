/**
 * Convierte un término de búsqueda en una expresión regular insensible a tildes/acentos
 * @param {string} term - El término de búsqueda
 * @returns {string} - Expresión regular como string
 */
function createAccentInsensitiveRegex(term) {
  return term
    .replace(/[aáàäâ]/gi, '[aáàäâ]')
    .replace(/[eéèëê]/gi, '[eéèëê]')
    .replace(/[iíìïî]/gi, '[iíìïî]')
    .replace(/[oóòöô]/gi, '[oóòöô]')
    .replace(/[uúùüû]/gi, '[uúùüû]')
    .replace(/[nñ]/gi, '[nñ]')
    .replace(/[cç]/gi, '[cç]');
}

/**
 * Convierte múltiples términos en una expresión regular insensible a tildes
 * @param {string[]} terms - Array de términos de búsqueda
 * @returns {string[]} - Array de expresiones regulares como strings
 */
function createAccentInsensitiveRegexArray(terms) {
  return terms.map(term => createAccentInsensitiveRegex(term));
}

module.exports = {
  createAccentInsensitiveRegex,
  createAccentInsensitiveRegexArray
};