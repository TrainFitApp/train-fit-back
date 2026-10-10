const test = require("node:test");
const assert = require("node:assert/strict");
const { assertMealEditable, MealProtectedError } = require("./meal-service");

// TAREA 1 (coach-tab) — assertMealEditable es la única comprobación de "¿puede
// el cliente editar libremente esta comida?" en todo el módulo de meals.
// Cualquier regresión aquí reabriría la posibilidad de que un cliente
// sobrescriba una comida pautada por su profesional sin pasar por la vía
// controlada (prescribeMeal/MealProposal).
// QA 2026-10-09 (A3): el candado dura lo que la relación de nutrición con el
// profesional que pautó; antes quedaba bloqueado para siempre.
test("assertMealEditable", async (t) => {
  const trainerClientDao = require("../trainerClients/trainer-client-dao");
  const OWNER = "6a6f0000000000000000c1c1";
  const TRAINER = "6a6f000000000000000000aa";
  let active = true;
  const asked = [];
  t.mock.method(trainerClientDao, "isActivePair", async (trainerId, clientId, scope) => {
    asked.push([String(trainerId), String(clientId), scope]);
    return active;
  });

  await t.test("comida sin pautar (o sin comida) es editable y no consulta la relación", async () => {
    for (const meal of [{ assignedByTrainerId: null }, {}, null, undefined]) {
      await assert.doesNotReject(assertMealEditable(OWNER, meal));
    }
    assert.equal(asked.length, 0);
  });

  await t.test("comida pautada con la relación de nutrición activa: MealProtectedError con code MEAL_PROTECTED", async () => {
    await assert.rejects(assertMealEditable(OWNER, { assignedByTrainerId: TRAINER }), (error) => {
      assert.ok(error instanceof MealProtectedError);
      assert.equal(error.code, "MEAL_PROTECTED");
      return true;
    });
    assert.deepEqual(asked.at(-1), [TRAINER, OWNER, "nutrition"], "la relación del dueño con quien pautó, en nutrición");
  });

  await t.test("terminada la relación, la comida vuelve a ser del cliente", async () => {
    active = false;
    await assert.doesNotReject(assertMealEditable(OWNER, { assignedByTrainerId: TRAINER }));
  });
});
