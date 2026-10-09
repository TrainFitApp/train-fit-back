const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MAX_LIMIT, parseSearchPaging, toSearchPage } = require("./exercise-search-paging");

test("parseSearchPaging: sin query, primera página de 10 y respuesta de array", () => {
  assert.deepEqual(parseSearchPaging(), { page: 0, limit: 10, withTotal: false });
  assert.deepEqual(parseSearchPaging({}), { page: 0, limit: 10, withTotal: false });
});

test("parseSearchPaging: lee page, limit y withTotal de la query (strings)", () => {
  assert.deepEqual(parseSearchPaging({ page: "3", limit: "24", withTotal: "1" }), { page: 3, limit: 24, withTotal: true });
  assert.equal(parseSearchPaging({ withTotal: "true" }).withTotal, true);
  assert.equal(parseSearchPaging({ withTotal: "0" }).withTotal, false);
});

test("parseSearchPaging: página negativa o basura es la primera", () => {
  assert.equal(parseSearchPaging({ page: "-2" }).page, 0);
  assert.equal(parseSearchPaging({ page: "abc" }).page, 0);
  assert.equal(parseSearchPaging({ page: "undefined" }).page, 0);
});

test("parseSearchPaging: el límite va de 1 al máximo", () => {
  assert.equal(parseSearchPaging({ limit: "0" }).limit, 1);
  assert.equal(parseSearchPaging({ limit: "-5" }).limit, 1);
  assert.equal(parseSearchPaging({ limit: "5000" }).limit, MAX_LIMIT);
  assert.equal(parseSearchPaging({ limit: "nope" }).limit, 10);
});

test("toSearchPage: hasMore mientras queden ejercicios detrás de esta página", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ _id: String(i) }));
  assert.deepEqual(toSearchPage(items, 25, 0, 10), { items, total: 25, page: 0, limit: 10, hasMore: true });
  assert.equal(toSearchPage(items, 25, 1, 10).hasMore, true);
  assert.equal(toSearchPage(items.slice(0, 5), 25, 2, 10).hasMore, false, "última página, incompleta");
  assert.equal(toSearchPage(items, 20, 1, 10).hasMore, false, "última página, justa");
});

test("toSearchPage: sin resultados o con datos raros no rompe", () => {
  assert.deepEqual(toSearchPage([], 0, 0, 10), { items: [], total: 0, page: 0, limit: 10, hasMore: false });
  assert.deepEqual(toSearchPage(null, undefined, 0, 10), { items: [], total: 0, page: 0, limit: 10, hasMore: false });
});
