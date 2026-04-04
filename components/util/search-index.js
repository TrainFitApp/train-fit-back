function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Treat punctuation/symbols as separators so "+Proteinas" => "proteinas"
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitSearchTokens(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildPrefixesFromTokens(tokens, minLength = 2, maxLength = 20) {
  const prefixSet = new Set();

  for (const token of tokens) {
    if (!token) continue;
    const tokenLength = token.length;
    if (tokenLength < minLength) continue;

    const upperBound = Math.min(tokenLength, maxLength);
    for (let size = minLength; size <= upperBound; size += 1) {
      prefixSet.add(token.slice(0, size));
    }
  }

  return Array.from(prefixSet);
}

function buildSearchFields({ name, brand }) {
  const nameNormalized = normalizeSearchText(name);
  const brandNormalized = normalizeSearchText(brand);
  const nameTokens = splitSearchTokens(name);
  const brandTokens = splitSearchTokens(brand);

  return {
    nameNormalized,
    brandNormalized,
    namePrefixes: buildPrefixesFromTokens(nameTokens),
    brandPrefixes: buildPrefixesFromTokens(brandTokens),
  };
}

function hasEditDistanceOneOrLess(a, b) {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);

  if (!left || !right) return false;
  if (left === right) return true;

  const leftLen = left.length;
  const rightLen = right.length;
  const delta = Math.abs(leftLen - rightLen);
  if (delta > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < leftLen && j < rightLen) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (leftLen > rightLen) {
      i += 1;
    } else if (rightLen > leftLen) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }

  if (i < leftLen || j < rightLen) {
    edits += 1;
  }

  return edits <= 1;
}

module.exports = {
  normalizeSearchText,
  splitSearchTokens,
  buildPrefixesFromTokens,
  buildSearchFields,
  hasEditDistanceOneOrLess,
};
