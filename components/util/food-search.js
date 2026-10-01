// Motor único de búsqueda de alimentos (productos y recetas). Lo usan los tres
// puntos de entrada que antes tenían implementaciones distintas y con
// resultados distintos para la misma query:
//
//   POST /api/meals/search/all   (search-foods del cliente y del profesional)
//   POST /api/products/search    (ProductSearchModalComponent de trainers)
//   GET  /api/recipes/search     (pestaña Recetas de search-foods)
//
// Qué resuelve, y por qué la implementación anterior no lo resolvía:
//
// 1. BÚSQUEDAS DE VARIAS PALABRAS. Antes la única etapa que las atendía era
//    `$text`, que es un OR con stemming: "leche entera" devolvía cualquier
//    cosa con "leche" O "entera" (todos los "dulce de leche" del catálogo),
//    ordenado por textScore y recortado a 220 candidatos. Con millones de
//    productos el producto correcto no entraba ni en la lista. Ahora la etapa
//    principal es un AND de prefijos por palabra sobre `searchTokens`, así que
//    "leche entera" exige las dos palabras, y "atun hacendado" cruza nombre
//    con marca (antes imposible: eran dos arrays separados y ninguna etapa
//    los combinaba).
//
// 2. EXACTITUD. El orden es por niveles de coincidencia (`MATCH_TIER`), no por
//    una suma de puntos en la que un prefijo largo podía ganar a una palabra
//    exacta: buscando "pollo", "Pollo" va antes que "Pollo adobado", y los dos
//    antes que "Pollock fillets". A igual nivel gana el nombre más corto — el
//    producto escueto es casi siempre el que se busca.
//
// 3. COSTE. Cinco queries acotadas y con bounds de índice en vez de siete, sin
//    los arrays de prefijos (ver components/util/search-index.js), sin la rama
//    redundante `{userId: {$exists: false}}` del `$or` (la igualdad a null ya
//    cubre el campo ausente) y trayendo solo los campos del ranking: los
//    documentos completos se leen al final, únicamente los de la página que se
//    devuelve. Cada etapa lleva `maxTimeMS` y si falla devuelve vacío en vez
//    de tumbar la búsqueda entera.
//
// 4. RESCATE. Si la búsqueda literal no llena la página se añaden, por ese
//    orden, `$text` (stemming), la misma query sin su última palabra y un pase
//    de typos (prefijo corto + distancia de edición). Son queries que solo se
//    pagan cuando hacen falta.

const {
  normalizeSearchText,
  splitSearchTokens,
  prefixUpperBound,
  stripPluralSuffix,
  editDistanceWithin,
} = require("./search-index");

const QUERY_MAX_TOKENS = 8;
const STAGE_TIMEOUT_MS = 1500;
const RESCUE_TIMEOUT_MS = 2500;

const STAGE_LIMITS = {
  namePrefix: 150,
  brandPrefix: 90,
  text: 150,
  relaxed: 200,
  typo: 300,
};

// Niveles de coincidencia. El orden entre niveles es absoluto: ningún bonus
// (verificado, propio, favorito) sube un producto de nivel.
const MATCH_TIER = {
  EXACT_FULL: 100, // el nombre normalizado ES la query
  NAME_PHRASE_PREFIX: 90, // el nombre empieza por la query entera (palabra completa)
  NAME_ALL_WORDS: 80, // todas las palabras de la query son palabras del nombre
  ALL_WORDS: 70, // todas, repartidas entre nombre y marca
  NAME_ALL_PREFIX: 60, // todas como prefijo de alguna palabra del nombre
  ALL_PREFIX: 50, // todas como prefijo, entre nombre y marca
  NAME_CONTAINS: 40, // el nombre contiene la query como subcadena
  PARTIAL: 30, // solo algunas palabras
  TEXT: 20, // únicamente el índice de texto (stemming)
  TYPO: 10, // solo con faltas de ortografía
};

function parseSearchQuery(raw) {
  const trimmed = String(raw || "").trim();
  const normalized = normalizeSearchText(trimmed);
  const allTokens = splitSearchTokens(normalized);

  // Con varias palabras, las de una sola letra no aportan selectividad y
  // ensanchan el AND sin motivo.
  const meaningful = allTokens.length > 1
    ? allTokens.filter((token) => token.length > 1)
    : allTokens;

  const tokens = [];
  for (const token of meaningful.length ? meaningful : allTokens) {
    if (tokens.includes(token)) continue;
    tokens.push(token);
    if (tokens.length >= QUERY_MAX_TOKENS) break;
  }

  return {
    raw: trimmed,
    normalized,
    tokens,
    hasSearch: normalized.length > 0,
  };
}

// Un documento entra si ALGUNA de sus palabras empieza por `token`. El
// $elemMatch es obligatorio: sin él, los dos límites del rango los pueden
// satisfacer elementos distintos del array y entran documentos que no
// corresponden (semántica de multikey de Mongo).
function tokenPrefixClause(token) {
  return {
    searchTokens: {
      $elemMatch: { $gte: token, $lt: prefixUpperBound(token) },
    },
  };
}

function tokensAndFilter(tokens) {
  if (!tokens.length) return null;
  if (tokens.length === 1) return tokenPrefixClause(tokens[0]);
  return { $and: tokens.map(tokenPrefixClause) };
}

function toComparableId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value);
}

// Una etapa que falla (índice de texto ausente, timeout, query degenerada) no
// puede dejar la búsqueda sin resultados: se registra y se sigue con el resto.
async function runStage(label, buildQuery, timeoutMs = STAGE_TIMEOUT_MS) {
  try {
    return await buildQuery().maxTimeMS(timeoutMs).lean().exec();
  } catch (error) {
    console.warn(`[food-search] etapa "${label}" descartada: ${error.message}`);
    return [];
  }
}

// El filtro de visibilidad (`scope`) y el de la etapa se combinan SIEMPRE con
// AND, y ninguna clave repetida puede sobrescribir a la otra: las dos usan
// `$or` y `$and` (visibilidad por dueño, variantes de una errata...), y un
// `{...scope, ...extra}` a secas se llevaba por delante el `$or` de la
// visibilidad — la etapa acababa buscando en el catálogo entero y devolvía
// productos de otros usuarios.
function mergeScope(scope, extra) {
  const base = scope && typeof scope === "object" ? scope : {};
  const merged = { ...base };
  const conflicts = [];

  for (const [key, value] of Object.entries(extra || {})) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      conflicts.push({ [key]: value });
      continue;
    }
    merged[key] = value;
  }

  if (conflicts.length) {
    merged.$and = [...(base.$and || []), ...conflicts];
  }

  return merged;
}

/**
 * Candidatos de una búsqueda, ya deduplicados. Devuelve solo los campos que
 * necesita el ranking: los documentos completos se leen después, y únicamente
 * los de la página que se devuelve.
 */
async function collectCandidates({ model, scope, query, poolSize, config }) {
  const { normalized, tokens } = query;
  const projection = config.candidateProjection;
  const upperBound = prefixUpperBound(normalized);
  const candidates = new Map();

  const addDocs = (docs, source) => {
    for (const doc of docs || []) {
      const key = toComparableId(doc?._id);
      if (!key || candidates.has(key)) continue;
      candidates.set(key, { doc, source });
    }
  };

  const stages = [
    // Prefijo de frase, en orden de índice. No hace falta una etapa aparte
    // para la igualdad: el nombre que ES la query es el primero de este rango
    // (y el recorte se queda con los nombres más cortos, "pollo" antes que
    // "pollo adobado con especias").
    runStage("namePrefix", () =>
      model
        .find(
          mergeScope(scope, {
            nameNormalized: { $gte: normalized, $lt: upperBound },
          }),
          projection,
        )
        .sort({ nameNormalized: 1, _id: 1 })
        .limit(STAGE_LIMITS.namePrefix),
    ),
  ];

  // Lo mismo para la marca. Con más de cuatro palabras ya no es una marca lo
  // que se está escribiendo.
  if (config.hasBrand && tokens.length <= 4) {
    stages.push(
      runStage("brandPrefix", () =>
        model
          .find(
            mergeScope(scope, {
              brandNormalized: { $gte: normalized, $lt: upperBound },
            }),
            projection,
          )
          .sort({ brandNormalized: 1, _id: 1 })
          .limit(STAGE_LIMITS.brandPrefix),
      ),
    );
  }

  const tokensFilter = tokensAndFilter(tokens);
  if (tokensFilter) {
    stages.push(
      runStage("tokens", () =>
        model.find(mergeScope(scope, tokensFilter), projection).limit(poolSize),
      ),
    );
  }

  const results = await Promise.all(stages);
  results.forEach((docs) => addDocs(docs, "literal"));

  return candidates;
}

const FUZZY_VOWELS = "aeiou";
const FUZZY_MAX_VARIANTS = 48;

// Variantes de una palabra a una errata de distancia, pensadas para usarse
// como PREFIJO (así "avena" también encuentra "avenas"):
//
//   letra de más      avennna -> avena
//   letras cambiadas  aevna   -> avena
//   vocal que falta   avna    -> avena
//   final mal escrito avenx   -> aven
//
// Solo vocales en las inserciones: son las que se escapan al escribir, y
// probar las 26 letras en cada hueco multiplicaría las ramas del $or sin
// mejorar casi nada. Una consonante omitida en medio de la palabra se queda
// sin cubrir; para eso haría falta un índice de n-gramas o Atlas Search.
function buildFuzzyPrefixVariants(token) {
  const length = token.length;
  const variants = new Set();

  for (let i = 0; i < length; i += 1) {
    variants.add(token.slice(0, i) + token.slice(i + 1));
  }

  for (let i = 0; i < length - 1; i += 1) {
    variants.add(token.slice(0, i) + token[i + 1] + token[i] + token.slice(i + 2));
  }

  if (length > 4) variants.add(token.slice(0, length - 1));
  if (length > 5) variants.add(token.slice(0, length - 2));

  for (let i = 0; i <= length; i += 1) {
    for (const vowel of FUZZY_VOWELS) {
      variants.add(token.slice(0, i) + vowel + token.slice(i));
    }
  }

  variants.delete(token);

  return Array.from(variants)
    .filter((variant) => variant.length >= 3)
    .slice(0, FUZZY_MAX_VARIANTS);
}

/**
 * Etapas de rescate. Solo se lanzan si la búsqueda literal no da para llenar
 * la página pedida, que es justo el caso en el que el usuario diría "no me
 * encuentra nada".
 */
async function collectRescueCandidates({
  model,
  scope,
  query,
  candidates,
  config,
}) {
  const { raw, tokens } = query;
  const projection = config.candidateProjection;

  const addDocs = (docs, source) => {
    for (const doc of docs || []) {
      const key = toComparableId(doc?._id);
      if (!key || candidates.has(key)) continue;
      candidates.set(key, { doc, source });
    }
  };

  // 1. Índice de texto: OR con stemming ("galletas" encuentra "galleta").
  if (config.hasTextIndex) {
    const textDocs = await runStage(
      "text",
      () =>
        model
          .find(mergeScope(scope, { $text: { $search: raw } }), {
            ...projection,
            score: { $meta: "textScore" },
          })
          .sort({ score: { $meta: "textScore" } })
          .limit(STAGE_LIMITS.text),
      RESCUE_TIMEOUT_MS,
    );
    addDocs(textDocs, "text");
  }

  // 2. Misma query sin la última palabra: cubre la falta de ortografía o la
  //    palabra de más al final de una frase larga.
  if (tokens.length >= 2) {
    const relaxedFilter = tokensAndFilter(tokens.slice(0, -1));
    const relaxedDocs = await runStage(
      "relaxed",
      () =>
        model
          .find(mergeScope(scope, relaxedFilter), projection)
          .limit(STAGE_LIMITS.relaxed),
      RESCUE_TIMEOUT_MS,
    );
    addDocs(relaxedDocs, "relaxed");
  }

  // 3. Plural/singular y faltas de ortografía. No se puede buscar "parecido a"
  //    con un índice normal, así que se buscan las variantes de la palabra
  //    escrita que están a una errata de distancia (ver
  //    buildFuzzyPrefixVariants) y después se filtra por distancia de edición
  //    ya en memoria. Cada variante es un rango de índice, y todo esto solo se
  //    ejecuta si la búsqueda literal no ha dado para llenar la página.
  const singleToken = tokens.length === 1 ? tokens[0] : null;
  if (singleToken && singleToken.length >= 4) {
    const singular = stripPluralSuffix(singleToken);
    const maxDistance = singleToken.length >= 6 ? 2 : 1;
    const variants = buildFuzzyPrefixVariants(singleToken);

    const typoDocs = variants.length
      ? await runStage(
          "typo",
          () =>
            model
              .find(
                mergeScope(scope, { $or: variants.map(tokenPrefixClause) }),
                projection,
              )
              .limit(STAGE_LIMITS.typo),
          RESCUE_TIMEOUT_MS,
        )
      : [];

    const close = typoDocs.filter((doc) => {
      const docTokens = [
        ...splitSearchTokens(doc.nameNormalized || doc.name),
        ...(config.hasBrand ? splitSearchTokens(doc.brandNormalized || doc.brand) : []),
      ];

      return docTokens.some(
        (docToken) =>
          docToken === singular ||
          editDistanceWithin(docToken, singleToken, maxDistance) >= 0,
      );
    });

    addDocs(close, "typo");
  }

  return candidates;
}

function startsWithToken(tokenList, prefix) {
  return tokenList.some((token) => token.startsWith(prefix));
}

function scoreCandidate({ doc, source }, query, context, config) {
  const { normalized, tokens } = query;
  const nameNormalized = doc.nameNormalized || normalizeSearchText(doc.name);
  const brandNormalized = config.hasBrand
    ? doc.brandNormalized || normalizeSearchText(doc.brand)
    : "";
  const nameTokens = splitSearchTokens(nameNormalized);
  const brandTokens = config.hasBrand ? splitSearchTokens(brandNormalized) : [];
  const allTokens = brandTokens.length ? [...nameTokens, ...brandTokens] : nameTokens;

  const nameExactHits = tokens.filter((token) => nameTokens.includes(token)).length;
  const allExactHits = tokens.filter((token) => allTokens.includes(token)).length;
  const namePrefixHits = tokens.filter((token) => startsWithToken(nameTokens, token)).length;
  const allPrefixHits = tokens.filter((token) => startsWithToken(allTokens, token)).length;
  const total = tokens.length || 1;

  let tier;
  if (nameNormalized === normalized) tier = MATCH_TIER.EXACT_FULL;
  // El prefijo de frase cuenta solo si acaba en final de palabra: buscando
  // "pollo", "Pollo adobado" sí es un nombre que empieza por lo buscado,
  // "Pollock fillets" no — ahí "pollo" cae en mitad de otra palabra y baja al
  // nivel de prefijo de palabra, por debajo de quien tiene "pollo" entero.
  else if (normalized && nameNormalized.startsWith(`${normalized} `)) {
    tier = MATCH_TIER.NAME_PHRASE_PREFIX;
  }
  else if (nameExactHits === total) tier = MATCH_TIER.NAME_ALL_WORDS;
  else if (allExactHits === total) tier = MATCH_TIER.ALL_WORDS;
  else if (namePrefixHits === total) tier = MATCH_TIER.NAME_ALL_PREFIX;
  else if (allPrefixHits === total) tier = MATCH_TIER.ALL_PREFIX;
  else if (normalized && nameNormalized.includes(normalized)) tier = MATCH_TIER.NAME_CONTAINS;
  else if (allPrefixHits > 0) tier = MATCH_TIER.PARTIAL;
  else if (source === "typo") tier = MATCH_TIER.TYPO;
  else tier = MATCH_TIER.TEXT;

  let score = allPrefixHits * 120 + allExactHits * 200;

  // Brevedad: a igual nivel, el nombre con menos palabras sobrantes primero.
  // Es lo que hace que "Pollo" gane a "Pollo asado con especias XL".
  const extraWords = Math.max(0, nameTokens.length - total);
  score -= Math.min(extraWords, 20) * 25;
  score -= Math.min(nameNormalized.length, 160) * 0.2;

  // La primera palabra de la query, cuanto antes aparezca en el nombre, mejor.
  if (tokens.length) {
    const position = nameTokens.findIndex((token) => token.startsWith(tokens[0]));
    if (position >= 0) score += Math.max(0, 6 - position) * 15;
  }

  if (config.hasBrand && tokens.some((token) => startsWithToken(brandTokens, token))) {
    score += 60;
  }

  const id = toComparableId(doc._id);
  const isOwn =
    !!context.ownerId && toComparableId(doc.userId) === toComparableId(context.ownerId);
  const isFavorite = context.favoriteIds?.has(id) || false;
  const isRecent = context.recentIds?.has(id) || false;

  if (isRecent) score += 900;
  if (isOwn) score += 320;
  if (isFavorite) score += 180;
  if (doc.verified) score += 70;
  if (typeof doc.code === "string" && doc.code.startsWith("84")) score += 45;

  return {
    doc,
    tier,
    score,
    sortName: nameNormalized,
    id,
  };
}

function compareScored(left, right) {
  if (left.tier !== right.tier) return right.tier - left.tier;
  if (left.score !== right.score) return right.score - left.score;
  const nameOrder = left.sortName.localeCompare(right.sortName);
  if (nameOrder !== 0) return nameOrder;
  return left.id.localeCompare(right.id);
}

/**
 * Búsqueda con texto. `scope` es el filtro de visibilidad ya resuelto por el
 * llamador (propios, globales, verificados, favoritos...).
 */
async function searchByRelevance({
  model,
  scope = {},
  search,
  page = 0,
  limit = 10,
  context = {},
  config,
}) {
  const query = parseSearchQuery(search);
  if (!query.hasSearch) return [];

  const pageValue = Math.max(0, parseInt((page || 0).toString(), 10) || 0);
  const limitValue = Math.max(1, parseInt((limit || 10).toString(), 10) || 10);
  const skipValue = pageValue * limitValue;
  const needed = skipValue + limitValue;
  const poolSize = Math.min(1200, Math.max(300, needed * 10));

  const candidates = await collectCandidates({
    model,
    scope,
    query,
    poolSize,
    config,
  });

  if (candidates.size < needed) {
    await collectRescueCandidates({ model, scope, query, candidates, config });
  }

  const scored = Array.from(candidates.values()).map((candidate) =>
    scoreCandidate(candidate, query, context, config),
  );
  scored.sort(compareScored);

  const pageIds = scored.slice(skipValue, skipValue + limitValue).map((item) => item.doc._id);
  if (!pageIds.length) return [];

  return hydrateInOrder({ model, ids: pageIds, config });
}

/**
 * Listado sin texto de búsqueda (filtros puros: propios, favoritos,
 * verificados). Va por índice con skip/limit: nada de traer el catálogo a
 * memoria para ordenarlo aquí.
 */
async function listByScope({ model, scope = {}, page = 0, limit = 10, config }) {
  const pageValue = Math.max(0, parseInt((page || 0).toString(), 10) || 0);
  const limitValue = Math.max(1, parseInt((limit || 10).toString(), 10) || 10);

  const docs = await model
    .find(scope, { _id: 1 })
    .sort({ nameNormalized: 1, _id: 1 })
    .skip(pageValue * limitValue)
    .limit(limitValue)
    .lean()
    .exec();

  const ids = docs.map((doc) => doc._id);
  if (!ids.length) return [];

  return hydrateInOrder({ model, ids, config });
}

// Los candidatos se traen proyectados (solo lo que puntúa), así que la página
// final hay que leerla completa — y respetando el orden del ranking, que
// `$in` no garantiza.
async function hydrateInOrder({ model, ids, config }) {
  const query = model.find({ _id: { $in: ids } });
  const docs = await (config.hydrate ? config.hydrate(query) : query.exec());
  const byId = new Map(docs.map((doc) => [toComparableId(doc._id), doc]));

  return ids.map((id) => byId.get(toComparableId(id))).filter(Boolean);
}

const PRODUCT_SEARCH_CONFIG = {
  hasBrand: true,
  hasTextIndex: true,
  candidateProjection: {
    name: 1,
    brand: 1,
    nameNormalized: 1,
    brandNormalized: 1,
    verified: 1,
    code: 1,
    userId: 1,
  },
};

const RECIPE_SEARCH_CONFIG = {
  hasBrand: false,
  hasTextIndex: true,
  candidateProjection: {
    name: 1,
    nameNormalized: 1,
    verified: 1,
    userId: 1,
  },
  // Las recetas sí necesitan sus ingredientes poblados (el .lean() de las
  // etapas se salta el autopopulate).
  hydrate: (query) => query.populate("customProducts").exec(),
};

module.exports = {
  MATCH_TIER,
  PRODUCT_SEARCH_CONFIG,
  RECIPE_SEARCH_CONFIG,
  parseSearchQuery,
  searchByRelevance,
  listByScope,
};
