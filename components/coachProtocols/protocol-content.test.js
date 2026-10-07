const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCheckins,
  validateCheckins,
  normalizeNutritionTarget,
  validateNutritionTarget,
} = require("./protocol-content");

const A = "507f1f77bcf86cd799439011";
const B = "507f1f77bcf86cd799439012";

test("normalizeCheckins rellena la cadencia por defecto", () => {
  assert.deepEqual(normalizeCheckins([{ templateId: A }]), [
    { templateId: A, frequency: "weekly", interval: 1, time: "09:00" },
  ]);
  assert.deepEqual(normalizeCheckins(null), []);
});

test("validateCheckins acepta varios check-ins con cadencias distintas", () => {
  const list = normalizeCheckins([
    { templateId: A, frequency: "daily", interval: 1, time: "08:00" },
    { templateId: B, frequency: "weekly", interval: 2, time: "20:30" },
  ]);
  assert.equal(validateCheckins(list), null);
});

test("validateCheckins rechaza plantilla repetida, sin plantilla o cadencia inválida", () => {
  assert.match(validateCheckins(normalizeCheckins([{ templateId: A }, { templateId: A }])), /repitas/);
  assert.match(validateCheckins(normalizeCheckins([{}])), /plantilla/);
  assert.match(validateCheckins(normalizeCheckins([{ templateId: A, frequency: "yearly" }])), /Frecuencia/);
  assert.match(validateCheckins(normalizeCheckins([{ templateId: A, interval: 0 }])), /intervalo/);
  assert.match(validateCheckins(normalizeCheckins([{ templateId: A, interval: 1.5 }])), /intervalo/);
  assert.match(validateCheckins(normalizeCheckins([{ templateId: A, time: "25:00" }])), /Hora/);
});

test("validateNutritionTarget exige que los macros cuadren con las kcal (±25)", () => {
  // 150*4 + 200*4 + 60*9 = 1940
  assert.equal(validateNutritionTarget(normalizeNutritionTarget({ kcal: 1950, protein: 150, carbs: 200, fat: 60 })), null);
  assert.match(
    validateNutritionTarget(normalizeNutritionTarget({ kcal: 2100, protein: 150, carbs: 200, fat: 60 })),
    /cuadrar/
  );
  assert.match(validateNutritionTarget(normalizeNutritionTarget({ kcal: 0, protein: 0, carbs: 0, fat: 0 })), /kcal/);
  assert.match(validateNutritionTarget(normalizeNutritionTarget({ kcal: 100, protein: -5, carbs: 20, fat: 3 })), /negativos/);
  assert.equal(validateNutritionTarget(null), null);
});

test("normalizeNutritionTarget redondea y null deja el objetivo sin tocar", () => {
  assert.deepEqual(normalizeNutritionTarget({ kcal: "2000.4", protein: 150.26, carbs: "200", fat: 66.66 }), {
    kcal: 2000,
    protein: 150.3,
    carbs: 200,
    fat: 66.7,
  });
  assert.equal(normalizeNutritionTarget(null), null);
});
