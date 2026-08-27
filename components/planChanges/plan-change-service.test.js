const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NUTRITIONAL_GOAL_FIELDS,
  diffFields,
  PLAN_ASSIGNMENT_FIELDS,
} = require("./plan-change-service");

// El historial existe para responder "¿por qué está hoy en 2100 kcal?".
// Registrar un cambio que no ocurrió lo llena de ruido; perderse uno que sí
// lo deja mintiendo por omisión. Las dos direcciones se prueban.

test("diffFields", async (t) => {
  await t.test("detecta el cambio del ejemplo: 2200 -> 2100 kcal", () => {
    const changes = diffFields(
      { kcalTotal: 2200, proteinsGTotal: 150 },
      { kcalTotal: 2100, proteinsGTotal: 150 },
      NUTRITIONAL_GOAL_FIELDS
    );
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field, "kcalTotal");
    assert.equal(changes[0].label, "Calorías");
    assert.equal(changes[0].previousValue, 2200);
    assert.equal(changes[0].newValue, 2100);
  });

  await t.test("sin cambios reales no registra nada", () => {
    const goal = { kcalTotal: 2100, proteinsGTotal: 150, carbohydratesGTotal: 200, fatGTotal: 70 };
    assert.deepEqual(diffFields(goal, { ...goal }, NUTRITIONAL_GOAL_FIELDS), []);
  });

  await t.test("2100 y '2100' NO son un cambio", () => {
    // Los números llegan como string desde los formularios: sin normalizar,
    // cada guardado registraría un cambio inexistente en los cuatro macros.
    const changes = diffFields(
      { kcalTotal: 2100 },
      { kcalTotal: "2100" },
      NUTRITIONAL_GOAL_FIELDS
    );
    assert.deepEqual(changes, []);
  });

  await t.test("registra varios campos a la vez", () => {
    const changes = diffFields(
      { kcalTotal: 2200, proteinsGTotal: 150, fatGTotal: 70 },
      { kcalTotal: 2100, proteinsGTotal: 170, fatGTotal: 70 },
      NUTRITIONAL_GOAL_FIELDS
    );
    assert.equal(changes.length, 2);
    assert.deepEqual(
      changes.map((c) => c.field).sort(),
      ["kcalTotal", "proteinsGTotal"]
    );
  });

  await t.test("sin objetivo previo, todo lo relleno cuenta como cambio", () => {
    const changes = diffFields(null, { kcalTotal: 2100, name: "Definición" }, NUTRITIONAL_GOAL_FIELDS);
    const fields = changes.map((c) => c.field);
    assert.ok(fields.includes("kcalTotal"));
    assert.ok(fields.includes("name"));
    assert.equal(changes.find((c) => c.field === "kcalTotal").previousValue, null);
  });

  await t.test("null y undefined se tratan igual: ninguno de los dos es un cambio", () => {
    assert.deepEqual(
      diffFields({ kcalTotal: null }, { kcalTotal: undefined }, NUTRITIONAL_GOAL_FIELDS),
      []
    );
  });

  await t.test("pasar de un valor a vacío SÍ es un cambio", () => {
    const changes = diffFields({ kcalTotal: 2100 }, { kcalTotal: null }, NUTRITIONAL_GOAL_FIELDS);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].newValue, null);
  });

  await t.test("solo mira los campos declarados, no el documento entero", () => {
    // updatedAt cambia en cada guardado; "updatedAt ha cambiado" no es
    // información para nadie.
    const changes = diffFields(
      { kcalTotal: 2100, updatedAt: "2026-01-01", _id: "a" },
      { kcalTotal: 2100, updatedAt: "2026-08-23", _id: "b" },
      NUTRITIONAL_GOAL_FIELDS
    );
    assert.deepEqual(changes, []);
  });

  await t.test("el cambio de vigencia de un plan usa sus propios campos", () => {
    const changes = diffFields(
      { startDate: "2026-07-01", endDate: null },
      { startDate: "2026-08-01", endDate: "2026-09-30" },
      PLAN_ASSIGNMENT_FIELDS
    );
    assert.equal(changes.length, 2);
    assert.equal(changes.find((c) => c.field === "endDate").previousValue, null);
  });
});

test("catálogos de campos", async (t) => {
  await t.test("cada campo del objetivo tiene etiqueta legible", () => {
    for (const field of NUTRITIONAL_GOAL_FIELDS) {
      assert.ok(field.field && field.label);
      assert.notEqual(field.label, field.field, "la etiqueta no puede ser el nombre técnico");
    }
  });

  await t.test("las calorías están cubiertas (es el cambio del ejemplo)", () => {
    assert.ok(NUTRITIONAL_GOAL_FIELDS.some((f) => f.field === "kcalTotal"));
  });
});
