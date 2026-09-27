const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMenuPreviews } = require("./menu-preview");

// Preview del menú para el cliente (menu-preview.js). Cada caso lleva al lado
// lo que tiene que ver el cliente.

const avena = { product: { name: "Avena", unit: "g" }, quantity: 60 };
const huevo = { product: { name: "Huevo", unit: "ud" }, quantity: 2 };
const tortita = { recipe: { name: "Tortitas" }, quantity: 1.25 };

function menu(meals) {
  return [{ name: "Entreno", meals }];
}

test("buildMenuPreviews", async (t) => {
  await t.test("una sola alternativa: items de esa y sin selector", () => {
    const [preview] = buildMenuPreviews(
      menu([{ slot: "Desayuno", alternatives: [{ label: "", customProducts: [avena], customRecipes: [tortita] }] }])
    );
    assert.equal(preview.name, "Entreno");
    assert.deepEqual(preview.meals[0].items, [
      { name: "Avena", quantity: 60, unit: "g" },
      { name: "Tortitas", quantity: 1.3, unit: "ración" },
    ]);
    assert.deepEqual(preview.meals[0].alternatives, []);
  });

  await t.test("2+ alternativas: todas, con su etiqueta; items sigue siendo la 1ª", () => {
    const [preview] = buildMenuPreviews(
      menu([
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Dulce", customProducts: [avena], customRecipes: [] },
            { label: "", customProducts: [huevo], customRecipes: [] },
          ],
        },
      ])
    );
    const meal = preview.meals[0];
    assert.deepEqual(meal.items, [{ name: "Avena", quantity: 60, unit: "g" }]);
    assert.deepEqual(meal.alternatives, [
      { label: "Dulce", items: [{ name: "Avena", quantity: 60, unit: "g" }] },
      { label: "", items: [{ name: "Huevo", quantity: 2, unit: "ud" }] },
    ]);
  });

  await t.test("una alternativa vacía no cuenta: con otra sola no hay selector", () => {
    const [preview] = buildMenuPreviews(
      menu([
        {
          slot: "Cena",
          alternatives: [
            { label: "", customProducts: [], customRecipes: [] },
            { label: "", customProducts: [huevo], customRecipes: [] },
          ],
        },
      ])
    );
    assert.deepEqual(preview.meals[0].items, [{ name: "Huevo", quantity: 2, unit: "ud" }]);
    assert.deepEqual(preview.meals[0].alternatives, []);
  });

  await t.test("comida sin alternativas o sin alimentos: items vacío", () => {
    const [preview] = buildMenuPreviews(
      menu([
        { slot: "Comida", alternatives: [] },
        { slot: "Cena" },
      ])
    );
    assert.deepEqual(preview.meals, [
      { name: "Comida", items: [], alternatives: [] },
      { name: "Cena", items: [], alternatives: [] },
    ]);
  });

  await t.test("cantidad no numérica -> null", () => {
    const [preview] = buildMenuPreviews(
      menu([{ slot: "Desayuno", alternatives: [{ customProducts: [], customRecipes: [{ recipe: { name: "Tortitas" }, quantity: "abc" }] }] }])
    );
    assert.equal(preview.meals[0].items[0].quantity, null);
  });

  await t.test("sin menús -> lista vacía", () => {
    assert.deepEqual(buildMenuPreviews(undefined), []);
  });
});
