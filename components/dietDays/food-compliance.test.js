const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeFoodCompliance } = require("./food-compliance");

// Cumplimiento alimento a alimento (food-compliance.js). Es lo que el
// entrenador lee para decidir si el problema es el plan o la adherencia, así
// que cada caso lleva la cuenta hecha a mano al lado.

const TRAINER = "6a86feb4a4a80dd5286b0595";

// Producto pautado por el profesional. `consumed` lo marca el cliente.
function pautado({ name, quantity = 100, consumed = false, productId = null }) {
  return {
    name,
    ...(productId ? { product: { _id: productId, name } } : {}),
    assignedByTrainerId: TRAINER,
    assignedQuantity: quantity,
    quantity,
    consumed,
  };
}

function dia(date, meals) {
  return { date, meals };
}

test("summarizeFoodCompliance", async (t) => {
  await t.test("cuenta los días en que se pautó y en los que se marcó hecho", () => {
    const days = [
      dia("2026-09-01", [{ customProducts: [pautado({ name: "Pollo", consumed: true })] }]),
      dia("2026-09-02", [{ customProducts: [pautado({ name: "Pollo", consumed: false })] }]),
      dia("2026-09-03", [{ customProducts: [pautado({ name: "Pollo", consumed: true })] }]),
    ];

    const [pollo] = summarizeFoodCompliance(days);
    assert.equal(pollo.name, "Pollo");
    assert.equal(pollo.plannedDays, 3);
    assert.equal(pollo.consumedDays, 2);
  });

  await t.test("lo que el cliente añadió por su cuenta no entra", () => {
    // Sin assignedByTrainerId no hay nada que cumplir: isItemConsumed lo daría
    // por consumido siempre y solo ensuciaría la lista con filas al 100%.
    const days = [
      dia("2026-09-01", [
        {
          customProducts: [
            pautado({ name: "Pollo", consumed: false }),
            { name: "Cerveza", quantity: 330, consumed: true },
          ],
        },
      ]),
    ];

    const filas = summarizeFoodCompliance(days);
    assert.deepEqual(filas.map((f) => f.name), ["Pollo"]);
  });

  await t.test("lo peor cumplido va primero", () => {
    const days = [
      dia("2026-09-01", [
        {
          customProducts: [
            pautado({ name: "Bien", consumed: true }),
            pautado({ name: "Mal", consumed: false }),
            pautado({ name: "Regular", consumed: true }),
          ],
        },
      ]),
      dia("2026-09-02", [
        {
          customProducts: [
            pautado({ name: "Bien", consumed: true }),
            pautado({ name: "Mal", consumed: false }),
            pautado({ name: "Regular", consumed: false }),
          ],
        },
      ]),
    ];

    // Mal 0/2, Regular 1/2, Bien 2/2.
    assert.deepEqual(summarizeFoodCompliance(days).map((f) => f.name), ["Mal", "Regular", "Bien"]);
  });

  await t.test("el mismo producto de catálogo se agrupa aunque cambie de comida", () => {
    const days = [
      dia("2026-09-01", [
        { customProducts: [pautado({ name: "Avena", productId: "6928f4becdbf40e64b9dff2a" })] },
        { customProducts: [pautado({ name: "Avena", productId: "6928f4becdbf40e64b9dff2a" })] },
      ]),
    ];

    const filas = summarizeFoodCompliance(days);
    assert.equal(filas.length, 1);
    // Dos raciones el mismo día siguen siendo UN día pautado.
    assert.equal(filas[0].plannedDays, 1);
    assert.equal(filas[0].plannedQuantity, 200);
  });

  await t.test("una receta cuenta como un solo alimento, no como sus ingredientes", () => {
    const days = [
      dia("2026-09-01", [
        {
          customRecipes: [
            {
              recipe: { _id: "6aa31be39276c429772c37d7", name: "Lentejas de la abuela" },
              assignedByTrainerId: TRAINER,
              assignedQuantity: 1,
              quantity: 1,
              consumed: true,
            },
          ],
        },
      ]),
    ];

    const filas = summarizeFoodCompliance(days);
    assert.deepEqual(filas.map((f) => f.name), ["Lentejas de la abuela"]);
    assert.equal(filas[0].consumedDays, 1);
  });

  await t.test("sin días, lista vacía", () => {
    assert.deepEqual(summarizeFoodCompliance([]), []);
    assert.deepEqual(summarizeFoodCompliance(null), []);
  });
});
