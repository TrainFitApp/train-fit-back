const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveSuitability,
  effectiveSuitability,
  missingDietaryFlags,
} = require("./diet-suitability");

function tmpl(customProducts) {
  return {
    menus: [{ name: "Menú 1", meals: [{ slot: "Comida", alternatives: [{ customProducts }] }] }],
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

  await t.test("recorre los menús y las recetas", () => {
    const doc = {
      menus: [
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

test("effectiveSuitability = derivado ∪ override (con lo que se deduce de vegano)", () => {
  assert.deepEqual(effectiveSuitability(["glutenFree"], ["vegetarian"]).sort(), ["glutenFree", "vegetarian"]);
  assert.deepEqual(effectiveSuitability(["vegan"], ["vegan"]).sort(), ["lactoseFree", "vegan", "vegetarian"]);
  assert.deepEqual(effectiveSuitability(["glutenFree"], ["vegan"]).sort(), ["glutenFree", "lactoseFree", "vegan", "vegetarian"]);
});

// QA 2026-10-09 (M7): para una clienta «Sin lactosa» todas las dietas de
// fábrica salían «No cumple», incluida «Vegana · 2.200 kcal»: casi ningún
// producto declara lactoseFree, y vegano no se traducía en sin lactosa.
test("deducciones: vegano ⇒ vegetariano y sin lactosa; un false declarado manda", async (t) => {
  await t.test("productos solo marcados como veganos certifican sin lactosa y vegetariano", () => {
    const r = deriveSuitability(tmpl([{ vegan: true }, { product: { vegan: true } }]));
    assert.deepEqual(r.suitableFor.sort(), ["lactoseFree", "vegan", "vegetarian"]);
    assert.equal(r.missingFlagCounts.lactoseFree, 0);
  });
  await t.test("una dieta vegana cumple la restricción sin lactosa de la clienta", () => {
    const r = deriveSuitability(tmpl([{ vegan: true, glutenFree: true }]));
    assert.deepEqual(missingDietaryFlags({ suitableFor: r.suitableFor }, ["lactoseFree"]), []);
  });
  await t.test("vegano declarado y lactoseFree:false (dato contradictorio) → manda el false", () => {
    const r = deriveSuitability(tmpl([{ vegan: true, lactoseFree: false }]));
    assert.ok(!r.suitableFor.includes("lactoseFree"));
  });
  await t.test("vegetariano NO implica vegano ni sin lactosa", () => {
    const r = deriveSuitability(tmpl([{ vegetarian: true }]));
    assert.deepEqual(r.suitableFor, ["vegetarian"]);
  });
});

test("missingDietaryFlags", async (t) => {
  await t.test("sin restricciones del cliente → no falta nada", () => {
    assert.deepEqual(missingDietaryFlags({ suitableFor: [] }, []), []);
  });
  await t.test("cliente vegano, plantilla no marcada → falta vegan", () => {
    assert.deepEqual(missingDietaryFlags({ suitableFor: ["glutenFree"] }, ["vegan"]), ["vegan"]);
  });
  await t.test("cliente vegano, plantilla apta por override → no falta nada", () => {
    assert.deepEqual(
      missingDietaryFlags({ suitableFor: [], suitableForOverride: ["vegan"] }, ["vegan"]),
      []
    );
  });
  await t.test("devuelve TODAS las que faltan, no solo la primera", () => {
    assert.deepEqual(
      missingDietaryFlags({ suitableFor: ["vegetarian"] }, ["vegan", "glutenFree", "lactoseFree"]),
      ["vegan", "glutenFree", "lactoseFree"]
    );
  });
});
