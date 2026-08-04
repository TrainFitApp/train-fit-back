const test = require("node:test");
const assert = require("node:assert/strict");
const { assertMealEditable, MealProtectedError } = require("./meal-service");

// TAREA 1 (coach-tab) — assertMealEditable es la única comprobación de "¿puede
// el cliente editar libremente esta comida?" en todo el módulo de meals.
// Cualquier regresión aquí reabriría la posibilidad de que un cliente
// sobrescriba una comida pautada por su profesional sin pasar por la vía
// controlada (prescribeMeal/MealProposal).
test("assertMealEditable", async (t) => {
  await t.test("comida sin assignedByTrainerId es editable (no lanza)", () => {
    assert.doesNotThrow(() => assertMealEditable({ assignedByTrainerId: null }));
  });

  await t.test("comida sin el campo assignedByTrainerId en absoluto es editable", () => {
    assert.doesNotThrow(() => assertMealEditable({}));
  });

  await t.test("meal null/undefined no lanza (nada que proteger)", () => {
    assert.doesNotThrow(() => assertMealEditable(null));
    assert.doesNotThrow(() => assertMealEditable(undefined));
  });

  await t.test("comida CON assignedByTrainerId lanza MealProtectedError", () => {
    assert.throws(
      () => assertMealEditable({ assignedByTrainerId: "6a6f000000000000000000aa" }),
      MealProtectedError
    );
  });

  await t.test("el error lanzado tiene code MEAL_PROTECTED (usado por meal-controller.js para el 403)", () => {
    try {
      assertMealEditable({ assignedByTrainerId: "6a6f000000000000000000aa" });
      assert.fail("no debería llegar aquí");
    } catch (e) {
      assert.equal(e.code, "MEAL_PROTECTED");
    }
  });
});
