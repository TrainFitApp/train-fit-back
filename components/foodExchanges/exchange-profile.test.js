const test = require("node:test");
const assert = require("node:assert/strict");
const {
  itemMacros,
  computeServing,
  itemDeviation,
  sumReparto,
  isCompleteServing,
} = require("./exchange-profile");

// Los números de aquí salen del grupo "Proteína magra" de
// scripts/seed-demo-coach-pro.js: 1 ración = 20 g de proteína, y seis
// alimentos que el entrenador igualó a mano. Sirven para comprobar lo que
// esto tiene que enseñar — que tres de esos seis NO cuadran con los 20 g que
// él declaró, algo que hoy no es visible en ninguna pantalla.

const pollo = {
  name: "Pechuga de pollo",
  quantity: 100,
  unit: "g",
  product: { protein100g: 23, carbohydrates100g: 0, fat100g: 1.5, energyKcal100g: 110 },
};
const merluza = {
  name: "Merluza",
  quantity: 115,
  unit: "g",
  product: { protein100g: 17.5, carbohydrates100g: 0, fat100g: 0.7, energyKcal100g: 85 },
};
const tofu = {
  name: "Tofu firme",
  quantity: 160,
  unit: "g",
  product: { protein100g: 12, carbohydrates100g: 1.2, fat100g: 8, energyKcal100g: 129 },
};

test("itemMacros", async (t) => {
  await t.test("escala las macros del producto por la cantidad pautada", () => {
    assert.deepEqual(itemMacros(pollo), { kcal: 110, protein: 23, carbs: 0, fat: 1.5 });
  });

  await t.test("null sin producto vinculado: no se puede saber, y no es 0", () => {
    assert.equal(itemMacros({ name: "Pan integral", quantity: 32, unit: "g" }), null);
  });

  await t.test("null en unidad que no escala por 100 g", () => {
    // El producto da sus macros por 100 g; "2 cucharadas" no se puede
    // contrastar contra eso sin inventarse una densidad.
    assert.equal(itemMacros({ ...pollo, unit: "cda", quantity: 2 }), null);
  });

  await t.test("un macro que el producto no declara queda null, no 0", () => {
    const sinGrasa = { ...pollo, product: { protein100g: 23, energyKcal100g: 110 } };
    assert.equal(itemMacros(sinGrasa).fat, null);
    assert.equal(itemMacros(sinGrasa).protein, 23);
  });

  await t.test("lee el producto dentro de productId (populate sin aplanar)", () => {
    const crudo = { quantity: 100, unit: "g", productId: pollo.product };
    assert.deepEqual(itemMacros(crudo), itemMacros(pollo));
  });
});

test("computeServing", async (t) => {
  await t.test("mediana y no media: un alimento raro no desplaza el perfil", () => {
    // Grasa: 1,5 / 0,8 / 12,8. Media = 5,0 (que no es ninguno de los tres).
    // Mediana = 1,5, que es lo que come el cliente casi siempre.
    const { serving } = computeServing([pollo, merluza, tofu]);
    assert.equal(serving.fat, 1.5);
  });

  await t.test("dice de cuántos alimentos sale el perfil", () => {
    const sinVincular = { name: "Claras de huevo", quantity: 180, unit: "g" };
    const result = computeServing([pollo, merluza, tofu, sinVincular]);
    assert.equal(result.computedFrom, 3);
    assert.equal(result.total, 4);
  });

  await t.test("grupo sin ningún alimento vinculado: perfil vacío, no ceros", () => {
    const { serving, computedFrom } = computeServing([
      { name: "Brócoli", quantity: 200, unit: "g" },
      { name: "Calabacín", quantity: 200, unit: "g" },
    ]);
    assert.equal(computedFrom, 0);
    assert.deepEqual(serving, { kcal: null, protein: null, carbs: null, fat: null });
  });
});

test("itemDeviation", async (t) => {
  const serving = { kcal: 110, protein: 20, carbs: 0, fat: 1.5 };

  await t.test("marca el alimento que se sale del anchor declarado", () => {
    // 100 g de pollo son 23 g de proteína contra los 20 que declaró: +15 %.
    assert.deepEqual(itemDeviation(pollo, serving, "protein"), {
      macro: "protein",
      actual: 23,
      expected: 20,
      pct: 15,
    });
  });

  await t.test("desviación negativa cuando el alimento se queda corto", () => {
    // 115 g de merluza son 20,1 g. Cuadra.
    assert.equal(itemDeviation(merluza, serving, "protein").pct, 0.5);
  });

  await t.test("null sin anchor: sin criterio declarado no hay nada que exigir", () => {
    assert.equal(itemDeviation(pollo, serving, null), null);
  });

  await t.test("null cuando el alimento no es comprobable", () => {
    assert.equal(itemDeviation({ name: "Pan", quantity: 32, unit: "g" }, serving, "protein"), null);
  });
});

test("sumReparto", async (t) => {
  const proteina = { kcal: 110, protein: 20, carbs: 0, fat: 1.5 };
  const hidratos = { kcal: 80, protein: 3, carbs: 15, fat: 0.5 };

  await t.test("suma count x perfil congelado sobre todas las comidas", () => {
    const { totals, counted, incomplete } = sumReparto([
      {
        name: "Comida",
        exchanges: [
          { groupName: "Proteína magra", count: 2, serving: proteina },
          { groupName: "Hidratos", count: 3, serving: hidratos },
        ],
      },
      { name: "Cena", exchanges: [{ groupName: "Proteína magra", count: 1.5, serving: proteina }] },
    ]);
    assert.equal(counted, 3);
    assert.deepEqual(incomplete, []);
    assert.deepEqual(totals, { kcal: 625, protein: 79, carbs: 45, fat: 6.8 });
  });

  await t.test("un grupo sin perfil no suma y se devuelve por su nombre", () => {
    // Lo importante del cuadre: un total sacado de la mitad de los grupos
    // parece correcto y no lo es. Quien lo pinte tiene que poder negarse a
    // darlo por bueno.
    const { totals, counted, incomplete } = sumReparto([
      {
        name: "Comida",
        exchanges: [
          { groupName: "Proteína magra", count: 2, serving: proteina },
          { groupName: "Verduras libres", count: 2, serving: null },
        ],
      },
    ]);
    assert.equal(counted, 1);
    assert.deepEqual(incomplete, [{ groupName: "Verduras libres", count: 2 }]);
    assert.equal(totals.kcal, 220);
  });

  await t.test("un grupo libre no suma y NO cuenta como agujero", () => {
    // "Verduras libres": el entrenador decidió que no se pesa. Marcarlo como
    // no cuadrable enseñaría a ignorar el aviso.
    const { counted, free, incomplete } = sumReparto([
      {
        name: "Comida",
        exchanges: [
          { groupName: "Proteína magra", count: 2, serving: proteina },
          { groupName: "Verduras libres", count: 1, freeQuantity: true, serving: null },
        ],
      },
    ]);
    assert.equal(counted, 1);
    assert.deepEqual(free, [{ groupName: "Verduras libres", count: 1 }]);
    assert.deepEqual(incomplete, []);
  });

  await t.test("un perfil a medias tampoco suma: cuadraría por lo bajo", () => {
    assert.equal(isCompleteServing({ kcal: 110, protein: 20, carbs: null, fat: 1.5 }), false);
    const { counted, incomplete } = sumReparto([
      { name: "Comida", exchanges: [{ groupName: "X", count: 1, serving: { protein: 20 } }] },
    ]);
    assert.equal(counted, 0);
    assert.equal(incomplete.length, 1);
  });
});
