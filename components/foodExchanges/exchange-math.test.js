const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXCHANGE_BASES,
  EXCHANGE_STEP,
  exchangesFor,
  basisForExchanges,
  amountForExchanges,
  mealBasisTotals,
} = require("./exchange-math");

// Estos números acaban en la pauta que sigue una persona todos los días. Un
// redondeo mal hecho no falla: simplemente hace que alguien coma un 30% más
// de lo que su entrenador quería.

const CARBS = { basis: "carbs", basisAmount: 15 };
const KCAL = { basis: "kcal", basisAmount: 90 };
const SIN_BASE = { basis: null, basisAmount: null };

test("exchangesFor", async (t) => {
  await t.test("divide la cantidad de la etiqueta entre la ración del grupo", () => {
    const result = exchangesFor(CARBS, 30);
    assert.equal(result.exact, 2);
    assert.equal(result.rounded, 2);
  });

  await t.test("redondea a media ración, que es lo que un coach pauta", () => {
    // 20/15 = 1,333 -> 1,5. "1,33 raciones de pan" no es una instrucción
    // que nadie pueda seguir.
    const result = exchangesFor(CARBS, 20);
    assert.equal(result.exact, 1.33);
    assert.equal(result.rounded, 1.5);
  });

  await t.test("redondea hacia abajo cuando toca", () => {
    // 17/15 = 1,133 -> 1
    assert.equal(exchangesFor(CARBS, 17).rounded, 1);
  });

  await t.test("un grupo SIN base numérica devuelve null, no 0", () => {
    // No es que salgan cero raciones: es que ese grupo se definió como lista
    // escrita a mano y no hay nada que dividir.
    assert.equal(exchangesFor(SIN_BASE, 30), null);
    assert.equal(exchangesFor({ basis: "carbs", basisAmount: 0 }, 30), null);
    assert.equal(exchangesFor(null, 30), null);
  });

  await t.test("sin cantidad no hay cuenta que hacer", () => {
    assert.equal(exchangesFor(CARBS, 0), null);
    assert.equal(exchangesFor(CARBS, null), null);
    assert.equal(exchangesFor(CARBS, "mucho"), null);
  });

  await t.test("nunca devuelve NaN ni Infinity", () => {
    const result = exchangesFor(KCAL, 225);
    assert.ok(Number.isFinite(result.exact));
    assert.ok(Number.isFinite(result.rounded));
  });
});

test("basisForExchanges", async (t) => {
  await t.test("multiplica la ración por el número de raciones", () => {
    assert.equal(basisForExchanges(CARBS, 2), 30);
    assert.equal(basisForExchanges(CARBS, 1.5), 22.5);
  });

  await t.test("cero raciones es un dato válido: cero de esa base", () => {
    // Distinto de "no se puede calcular": el coach pautó explícitamente 0.
    assert.equal(basisForExchanges(CARBS, 0), 0);
  });

  await t.test("sin base numérica no se puede", () => {
    assert.equal(basisForExchanges(SIN_BASE, 2), null);
  });

  await t.test("un número de raciones no válido devuelve null", () => {
    assert.equal(basisForExchanges(CARBS, -1), null);
    assert.equal(basisForExchanges(CARBS, null), null);
    assert.equal(basisForExchanges(CARBS, "dos"), null);
  });
});

test("amountForExchanges", async (t) => {
  const pollo = { name: "Pollo", quantity: 100, unit: "g" };

  await t.test("multiplica la cantidad que escribió el coach", () => {
    assert.deepEqual(amountForExchanges(pollo, 2), {
      quantity: 200,
      unit: "g",
      name: "Pollo",
    });
  });

  await t.test("media ración es media cantidad", () => {
    assert.equal(amountForExchanges(pollo, 0.5).quantity, 50);
  });

  await t.test("respeta la unidad del alimento, no asume gramos", () => {
    const leche = { name: "Leche", quantity: 200, unit: "ml" };
    assert.equal(amountForExchanges(leche, 1.5).unit, "ml");
  });

  await t.test("sin cantidad no hay nada que multiplicar", () => {
    assert.equal(amountForExchanges({ name: "X", quantity: 0 }, 2), null);
    assert.equal(amountForExchanges(null, 2), null);
  });
});

test("mealBasisTotals", async (t) => {
  const groupsById = new Map([
    ["1", { ...CARBS, _id: "1" }],
    ["2", { basis: "protein", basisAmount: 7, _id: "2" }],
    ["3", { ...SIN_BASE, _id: "3" }],
  ]);

  await t.test("suma por base, no todo junto", () => {
    const { totals } = mealBasisTotals(
      { exchanges: [{ groupId: "1", count: 2 }, { groupId: "2", count: 3 }] },
      groupsById
    );
    const byBasis = Object.fromEntries(totals.map((total) => [total.basis, total.amount]));
    assert.equal(byBasis.carbs, 30);
    assert.equal(byBasis.protein, 21);
  });

  await t.test("acumula dos grupos de la misma base", () => {
    const { totals } = mealBasisTotals(
      { exchanges: [{ groupId: "1", count: 1 }, { groupId: "1", count: 2 }] },
      groupsById
    );
    assert.equal(totals.length, 1);
    assert.equal(totals[0].amount, 45);
  });

  await t.test("cuenta aparte los grupos que no se pueden sumar", () => {
    // Un total que parece completo y no lo es sería peor que no darlo: la
    // interfaz avisa gracias a este contador.
    const result = mealBasisTotals(
      { exchanges: [{ groupId: "1", count: 2 }, { groupId: "3", count: 1 }] },
      groupsById
    );
    assert.equal(result.groupsWithoutBasis, 1);
    assert.equal(result.totals.length, 1);
  });

  await t.test("una comida vacía no revienta", () => {
    assert.deepEqual(mealBasisTotals({ exchanges: [] }, groupsById), {
      totals: [],
      groupsWithoutBasis: 0,
    });
    assert.deepEqual(mealBasisTotals(null, groupsById).totals, []);
  });

  await t.test("un grupo que ya no existe cuenta como no sumable, no rompe", () => {
    // El grupo pudo borrarse después de pautar. La pauta del cliente sigue
    // siendo legible (guarda groupName), pero su base ya no se conoce.
    const result = mealBasisTotals({ exchanges: [{ groupId: "999", count: 2 }] }, groupsById);
    assert.equal(result.groupsWithoutBasis, 1);
  });
});

test("catálogo de bases", async (t) => {
  await t.test("las cuatro bases tienen clave, etiqueta y unidad", () => {
    assert.equal(EXCHANGE_BASES.length, 4);
    for (const base of EXCHANGE_BASES) {
      assert.ok(base.key && base.label && base.unit);
    }
  });

  await t.test("las calorías se miden en kcal, no en gramos", () => {
    const kcal = EXCHANGE_BASES.find((base) => base.key === "kcal");
    assert.equal(kcal.unit, "kcal");
  });

  await t.test("el paso de redondeo es media ración", () => {
    assert.equal(EXCHANGE_STEP, 0.5);
  });
});
