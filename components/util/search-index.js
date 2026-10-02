// Campos derivados que hacen buscable un nombre (productos y recetas) y las
// utilidades que comparten el indexado y la búsqueda. Todo lo que se escriba
// aquí tiene que escribirse igual en los dos lados: si el indexado normaliza
// distinto que la query, la búsqueda no encuentra nada.
//
// Modelo de datos (ver components/util/food-search.js para las queries):
//
//   nameNormalized   nombre normalizado completo  -> igualdad y prefijo de frase
//   brandNormalized  marca normalizada completa   -> igualdad y prefijo de marca
//   searchTokens     palabras únicas de nombre+marca -> AND de prefijos por palabra
//
// `searchTokens` sustituye a los antiguos `namePrefixes`/`brandPrefixes`, que
// guardaban TODOS los prefijos de cada palabra (de 2 a 20 caracteres): unas 60
// entradas de índice por producto. Con millones de productos eso eran varios
// GB de índice que no caben en RAM, y aun así no resolvían una búsqueda de
// varias palabras (el array solo contenía prefijos de palabras sueltas, nunca
// la frase entera). Con las palabras a secas son ~8 entradas por producto y el
// prefijo se resuelve con un rango sobre el índice.

const MAX_TOKENS_PER_DOC = 40;
const MAX_TOKEN_LENGTH = 24;

// Límite superior de un rango de prefijo: todo lo que empieza por `prefix`
// está entre `prefix` y `prefix + ￿` en orden de índice.
const PREFIX_UPPER_BOUND_SUFFIX = "￿";

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Apóstrofes pegados, no separadores: "Braswell's" -> "braswells" y
    // "Lagg's" -> "laggs". Con el separador genérico quedaba "lagg s", y
    // nadie busca escribiendo ese espacio.
    .replace(/['‘’´`]+/g, "")
    // El resto de puntuación y símbolos sí separan: "+Proteinas" -> "proteinas".
    // Se conservan letras y cifras de CUALQUIER alfabeto: el catálogo viene de
    // Open Food Facts y trae nombres en árabe, cirílico o chino. Con la clase
    // [a-z0-9] esos nombres quedaban en cadena vacía, es decir, imposibles de
    // encontrar y los primeros en cualquier listado alfabético.
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitSearchTokens(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

// Palabras únicas de nombre + marca, en orden de aparición. Es el array que
// se indexa, así que está acotado por arriba: un nombre de 300 caracteres no
// debe poder generar 80 entradas de índice.
function buildSearchTokens({ name, brand } = {}) {
  const tokens = [];
  const seen = new Set();

  for (const token of [...splitSearchTokens(name), ...splitSearchTokens(brand)]) {
    const trimmed = token.length > MAX_TOKEN_LENGTH
      ? token.slice(0, MAX_TOKEN_LENGTH)
      : token;

    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    tokens.push(trimmed);

    if (tokens.length >= MAX_TOKENS_PER_DOC) break;
  }

  return tokens;
}

function buildSearchFields({ name, brand } = {}) {
  return {
    nameNormalized: normalizeSearchText(name),
    brandNormalized: normalizeSearchText(brand),
    searchTokens: buildSearchTokens({ name, brand }),
  };
}

function prefixUpperBound(prefix) {
  return `${prefix}${PREFIX_UPPER_BOUND_SUFFIX}`;
}

// Singular aproximado para el pase de rescate: el prefijo cubre el caso
// "escribo singular, el producto está en plural" (galleta -> galletas), pero
// no el inverso. Solo se usa cuando la búsqueda literal no ha dado resultados.
function stripPluralSuffix(token) {
  if (token.length >= 6 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length >= 5 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

// Distancia de edición acotada (Levenshtein con tope). Sale en cuanto sabe
// que se pasa del máximo: se llama una vez por candidato y palabra.
function editDistanceWithin(a, b, maxDistance = 1) {
  const left = String(a || "");
  const right = String(b || "");

  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return -1;
  if (!left.length) return right.length <= maxDistance ? right.length : -1;
  if (!right.length) return left.length <= maxDistance ? left.length : -1;

  let previous = new Array(right.length + 1);
  let current = new Array(right.length + 1);

  for (let j = 0; j <= right.length; j += 1) previous[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let rowBest = current[0];

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      if (current[j] < rowBest) rowBest = current[j];
    }

    if (rowBest > maxDistance) return -1;

    const swap = previous;
    previous = current;
    current = swap;
  }

  const distance = previous[right.length];
  return distance <= maxDistance ? distance : -1;
}

module.exports = {
  MAX_TOKENS_PER_DOC,
  MAX_TOKEN_LENGTH,
  normalizeSearchText,
  splitSearchTokens,
  buildSearchTokens,
  buildSearchFields,
  prefixUpperBound,
  stripPluralSuffix,
  editDistanceWithin,
};
