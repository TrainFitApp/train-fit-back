// PURO — paginación de POST /exercises/search.
//
// La búsqueda devolvía solo un array de 10 ejercicios, sin total ni forma de
// saber si había más: el buscador no podía decir cuántos coincidían ni
// cuándo dejar de pedir páginas. Con ?withTotal=1 responde una página con
// sus datos ({ items, total, page, limit, hasMore }). Sin el parámetro sigue
// devolviendo el array de siempre, que es lo que esperan las versiones de la
// app del cliente ya publicadas.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Query de la ruta → { page, limit, withTotal }. Una página negativa o basura
// es la primera; el límite va de 1 a MAX_LIMIT (un límite enorme convertiría
// la búsqueda en un volcado del catálogo).
function parseSearchPaging(query = {}) {
  const page = Math.max(0, toInt(query.page, 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(query.limit, DEFAULT_LIMIT)));
  const withTotal = query.withTotal === "1" || query.withTotal === "true";
  return { page, limit, withTotal };
}

function toSearchPage(items, total, page, limit) {
  const list = Array.isArray(items) ? items : [];
  const count = Math.max(0, Number(total) || 0);
  return {
    items: list,
    total: count,
    page,
    limit,
    hasMore: page * limit + list.length < count,
  };
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, parseSearchPaging, toSearchPage };
