// Función para normalizar términos de búsqueda eliminando acentos y caracteres especiales
const normalizeSearchTerm = (term) => {
  return term.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

module.exports = { normalizeSearchTerm };