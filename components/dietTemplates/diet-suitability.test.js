const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveSuitability,
  effectiveSuitability,
  passesDietaryFilter,
} = require("./diet-suitability");

function tmpl(customProducts) {
  return {
    days: [{ dayLabel: "Día 1", meals: [{ slot: "Comida", alternatives: [{ customProducts }] }] }],
  };
}

const VEGAN = { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true };
const MEAT = { vegan: false, vegetarian: false, lactoseFree: true, glutenFree: true };
const UNKNOWN = {};

test("deriveSuitability", async (t) => {
  await t.test("todos los productos veganos → apta para todo", () => {
    const r = deriveSuitability(tmpl([VEGAN, VEGAN]));
    assert.deepEqual(r.suitableFor.sort(), ["glutenFree", "lactoseFree", "vegan", "vegetarian"]);
  });

  await t.test("un producto con carne → no vegana ni vegetariana", () => {
    const r = deriveSuitability(tmpl([VEGAN, MEAT]));
    assert.deepEqual(r.suitableFor.sort(), ["glutenFree", "lactoseFree"]);
  });

  await t.test("producto sin flag → no certifica, lo cuenta como missing", () => {
    const r = deriveSuitability(tmpl([VEGAN, UNKNOWN]));
    assert.deepEqual(r.suitableFor, []);
    assert.equal(r.missingFlagCounts.vegan, 1);
    assert.equal(r.missingFlagCounts.glutenFree, 1);
  });

  await t.test("lee el flag del Product poblado si no está en el CustomProduct", () => {
    const r = deriveSuitability(
      tmpl([
        { product: { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true }, quantity: 100 },
      ])
    );
    assert.ok(r.suitableFor.includes("vegan"));
  });

  await t.test("plantilla sin productos → no certifica nada", () => {
    const r = deriveSuitability(tmpl([]));
    assert.deepEqual(r.suitableFor, []);
    assert.equal(r.productCount, 0);
  });

  await t.test("recorre dayPatterns y recetas", () => {
    const doc = {
      dayPatterns: [
        {
          name: "Entreno",
          meals: [
            {
              slot: "Comida",
              alternatives: [
                {
                  customProducts: [VEGAN],
                  customRecipes: [{ addedCustomProducts: [VEGAN], recipe: { customProducts: [VEGAN] } }],
                },
              ],
            },
          ],
        },
      ],
    };
    assert.ok(deriveSuitability(doc).suitableFor.includes("vegan"));
  });
});

test("effectiveSuitability = derivado ∪ override", () => {
  assert.deepEqual(effectiveSuitability(["glutenFree"], ["vegan"]).sort(), ["glutenFree", "vegan"]);
  assert.deepEqual(effectiveSuitability(["vegan"], ["vegan"]), ["vegan"]);
});

test("passesDietaryFilter", async (t) => {
  await t.test("sin restricciones del cliente → pasa todo", () => {
    assert.equal(passesDietaryFilter({ suitableFor: [] }, []), true);
  });
  await t.test("cliente vegano, plantilla no marcada → no pasa", () => {
    assert.equal(passesDietaryFilter({ suitableFor: ["glutenFree"] }, ["vegan"]), false);
  });
  await t.test("cliente vegano, plantilla apta por override → pasa", () => {
    assert.equal(
      passesDietaryFilter({ suitableFor: [], suitableForOverride: ["vegan"] }, ["vegan"]),
      true
    );
  });
});
