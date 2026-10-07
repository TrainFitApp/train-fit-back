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

module.exports = {
  createAccentInsensitiveRegex
};