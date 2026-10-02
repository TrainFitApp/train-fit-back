const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mergeRecipeIngredients,
  ingredientMacros,
  macrosForCustomRecipe,
  sumMacroList,
  kcalForCustomRecipe,
  kcalForMeal,
  macrosForMeal,
  countMealItems,
  computeDayCompletion,
  computeDayTracking,
  computeRangeAdherence,
  isItemPlanned,
  isItemConsumed,
} = require("./diet-days-nutrition-util");

// Núcleo nutricional del backend: de aquí salen las kcal y macros de cada
// comida, el cumplimiento del plan y la adherencia de un rango. Es aritmética
// pura, así que se prueba entera.
//
// Espejo del front: packages/shared-core (CustomProductService#getMacros y
// RecipeService#buildNutritionCalculation) tiene que dar lo mismo con los
// mismos datos — ver el test gemelo
// packages/shared-core/src/app/core/services/nutrition-math.test.js.

const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** CustomProduct con su propio snapshot de macros (el caso normal). */
const snapshot = (quantity, macros = {}) => ({
  quantity,
  energyKcal100g: macros.kcal,
  protein100g: macros.protein,
  carbohydrates100g: macros.carbs,
  fat100g: macros.fat,
});

/** CustomProduct sin snapshot: solo el Product poblado detrás. */
const fromProduct = (quantity, macros = {}) => ({
  quantity,
  product: {
    _id: "product-1",
    energyKcal100g: macros.kcal,
    protein100g: macros.protein,
    carbohydrates100g: macros.carbs,
    fat100g: macros.fat,
  },
});

// --- ingredientMacros -------------------------------------------------------

test("ingredientMacros escala por cantidad: los campos son por 100 g", () => {
  const macros = ingredientMacros(snapshot(250, { kcal: 100, protein: 20, carbs: 5, fat: 2 }));
  assert.deepEqual(macros, { kcal: 250, protein: 50, carbs: 12.5, fat: 5 });
});

test("ingredientMacros con 100 g devuelve los valores tal cual", () => {
  // Es el caso de la adición rápida (CustomProduct.quickAdd): se guarda con
  // cantidad 100 y los macros escritos a mano en los campos "por 100 g", justo
  // para que esta cuenta devuelva lo que escribió el cliente.
  const macros = ingredientMacros(snapshot(100, { kcal: 420, protein: 31, carbs: 12.5, fat: 9 }));
  assert.deepEqual(macros, { kcal: 420, protein: 31, carbs: 12.5, fat: 9 });
});

test("ingredientMacros sin cantidad no suma nada", () => {
  for (const ingredient of [
    snapshot(0, { kcal: 500 }),
    snapshot(undefined, { kcal: 500 }),
    snapshot(null, { kcal: 500 }),
  ]) {
    assert.deepEqual(ingredientMacros(ingredient), ZERO);
  }
});

test("ingredientMacros tolera el ingrediente ausente", () => {
  assert.deepEqual(ingredientMacros(undefined), ZERO);
  assert.deepEqual(ingredientMacros(null), ZERO);
  assert.deepEqual(ingredientMacros({}), ZERO);
});

test("ingredientMacros cae al Product cuando el CustomProduct no trae snapshot", () => {
  // F20-septendecies: muchos CustomProduct antiguos solo tienen el Product
  // poblado. Sin este fallback computaban 0 kcal en adherencia y cumplimiento
  // sin ningún error visible.
  const macros = ingredientMacros(fromProduct(200, { kcal: 150, protein: 10, carbs: 30, fat: 1 }));
  assert.deepEqual(macros, { kcal: 300, protein: 20, carbs: 60, fat: 2 });
});

test("ingredientMacros: el snapshot del CustomProduct gana al del Product", () => {
  // Es lo que hace que editar los macros de una línea no se pise con el
  // producto del catálogo.
  const ingredient = {
    ...fromProduct(100, { kcal: 150, protein: 10, carbs: 30, fat: 1 }),
    energyKcal100g: 999,
  };
  assert.equal(ingredientMacros(ingredient).kcal, 999);
  // Los campos que el CustomProduct NO pisa siguen saliendo del Product.
  assert.equal(ingredientMacros(ingredient).protein, 10);
});

test("ingredientMacros: un 0 en el snapshot gana al valor del Product", () => {
  // Usa ?? y no ||, así que "este alimento tiene 0 g de grasa" se respeta en
  // vez de caer al valor del catálogo. Con || esto daría 20.
  const ingredient = { ...fromProduct(100, { kcal: 150, fat: 20 }), fat100g: 0 };
  assert.equal(ingredientMacros(ingredient).fat, 0);
});

test("ingredientMacros trata la cantidad negativa como una resta real", () => {
  // No se sanea: documenta el comportamiento de hoy. Ninguna vía de entrada
  // deja escribir una cantidad negativa (el schema la acota con min: 0), así
  // que solo llegaría con un dato corrupto en BD. Para un producto SUELTO el
  // front hace lo mismo (CustomProductService#getMacros).
  assert.equal(ingredientMacros(snapshot(-100, { kcal: 100 })).kcal, -100);
});

test("DIFERENCIA CONOCIDA: un INGREDIENTE de receta negativo resta aquí y el front lo ignora", () => {
  // RecipeService#calculateRecipeMacros del front pasa cada cantidad por
  // toPositiveNumber, así que una negativa cuenta como 0 y no entra en el peso
  // crudo; aquí resta en las dos cosas. Para la misma receta:
  //   backend: 100 kcal sobre 100 g de peso crudo
  //   front:   200 kcal sobre 200 g de peso crudo
  // Ver el gemelo en
  // packages/shared-core/src/app/core/services/nutrition-math.test.cjs.
  const ingredients = [
    { _id: "a", quantity: 200, energyKcal100g: 100 },
    { _id: "b", quantity: -100, energyKcal100g: 100 },
  ];
  assert.equal(sumMacroList(ingredients.map(ingredientMacros)).kcal, 100);
});

// --- sumMacroList -----------------------------------------------------------

test("sumMacroList suma los cuatro macros y aguanta huecos", () => {
  assert.deepEqual(
    sumMacroList([
      { kcal: 100, protein: 10, carbs: 5, fat: 1 },
      { kcal: 50, protein: 5, carbs: 2, fat: 0.5 },
      null,
      undefined,
      {},
    ]),
    { kcal: 150, protein: 15, carbs: 7, fat: 1.5 },
  );
});

test("sumMacroList de una lista vacía es cero, no undefined", () => {
  assert.deepEqual(sumMacroList([]), ZERO);
});

// --- mergeRecipeIngredients -------------------------------------------------

const base = (id, quantity) => ({ _id: id, quantity, energyKcal100g: 100 });

test("mergeRecipeIngredients sin CustomRecipe devuelve los ingredientes de la receta", () => {
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  assert.deepEqual(mergeRecipeIngredients(recipe, null), recipe.customProducts);
  assert.deepEqual(mergeRecipeIngredients(recipe, undefined), recipe.customProducts);
});

test("mergeRecipeIngredients sin receta devuelve lista vacía, no revienta", () => {
  assert.deepEqual(mergeRecipeIngredients(null, null), []);
  assert.deepEqual(mergeRecipeIngredients(undefined, { addedCustomProducts: [] }), []);
});

test("mergeRecipeIngredients quita los ingredientes eliminados", () => {
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  const merged = mergeRecipeIngredients(recipe, { removedBaseCustomProductIds: ["a"] });
  assert.deepEqual(merged.map((i) => i._id), ["b"]);
});

test("mergeRecipeIngredients pisa campo a campo, no sustituye el ingrediente entero", () => {
  // modifiedBaseCustomProducts ES un diff parcial: el front solo manda los
  // campos que cambian (recipe.service.ts#buildModifiedBaseCustomProduct).
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  const merged = mergeRecipeIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 999 }],
  });
  assert.deepEqual(merged.map((i) => i._id), ["a", "b"], "conserva el _id del base");
  assert.equal(merged[0].quantity, 999, "la cantidad la pisa el modificado");
  assert.equal(merged[0].energyKcal100g, 100, "los macros que no cambian siguen ahí");
});

test("mergeRecipeIngredients: ajustar SOLO la cantidad conserva los macros del ingrediente", () => {
  // Regresión 2026-10. Es la edición más corriente de todas y la que peor
  // salía: con el reemplazo entero, el ingrediente se quedaba con `quantity` y
  // sin un solo macro, así que la receta computaba 0 kcal en adherencia,
  // cumplimiento, perfil de plantillas y alertas. El cliente veía 195 kcal
  // (las calcula el front) y su profesional veía 0.
  const arroz = {
    _id: "arroz",
    quantity: 100,
    energyKcal100g: 130,
    protein100g: 2.7,
    carbohydrates100g: 28,
    fat100g: 0.3,
  };
  const customRecipe = {
    recipe: { customProducts: [arroz] },
    quantity: 150,
    modifiedBaseCustomProducts: [{ baseCustomProductId: "arroz", quantity: 150 }],
  };
  const macros = macrosForCustomRecipe(customRecipe);
  assert.equal(Math.round(macros.kcal), 195);
  assert.equal(Math.round(macros.carbs), 42);
  // El mismo caso en el front (RecipeService#calculateCustomRecipeTotals) da
  // estos mismos números — ver nutrition-math.test.cjs en shared-core.
});

test("mergeRecipeIngredients no escribe sobre el ingrediente base de la receta", () => {
  // La receta es un documento compartido por todos los clientes que la usan:
  // pisar su ingrediente al calcular le cambiaría la receta a todo el mundo.
  const original = base("a", 100);
  const recipe = { customProducts: [original] };
  mergeRecipeIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 999 }],
  });
  assert.equal(original.quantity, 100);
});

test("mergeRecipeIngredients admite un modificado completo (el formato viejo)", () => {
  // Un diff que trae todos los campos pisa todos los campos: el cambio a
  // overlay no rompe lo que ya hubiera guardado como documento completo.
  const recipe = { customProducts: [base("a", 100)] };
  const merged = mergeRecipeIngredients(recipe, {
    modifiedBaseCustomProducts: [
      { baseCustomProductId: "a", quantity: 50, energyKcal100g: 7 },
    ],
  });
  assert.equal(merged[0].quantity, 50);
  assert.equal(merged[0].energyKcal100g, 7);
});

test("mergeRecipeIngredients llama a toObject cuando el ingrediente es un documento de mongoose", () => {
  const recipe = {
    customProducts: [
      { _id: "a", toObject: () => ({ _id: "a", quantity: 100, energyKcal100g: 100 }) },
    ],
  };
  const merged = mergeRecipeIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 200 }],
  });
  assert.deepEqual(merged[0], { _id: "a", quantity: 200, energyKcal100g: 100 });
});

test("la lista de campos pisables no se separa de la de recipe-merge.service", () => {
  // Está duplicada a propósito (este módulo es aritmética pura, sin mongoose),
  // así que hace falta algo que avise si una de las dos crece y la otra no.
  const { CUSTOM_PRODUCT_OVERRIDE_FIELDS } = require("./diet-days-nutrition-util");
  const recipeMerge = require("../recipes/recipe-merge.service");
  assert.deepEqual(
    [...CUSTOM_PRODUCT_OVERRIDE_FIELDS].sort(),
    [...recipeMerge.CUSTOM_PRODUCT_OVERRIDE_FIELDS].sort(),
  );
});

test("mergeRecipeIngredients añade los ingredientes nuevos al final", () => {
  const recipe = { customProducts: [base("a", 100)] };
  const merged = mergeRecipeIngredients(recipe, { addedCustomProducts: [base("extra", 20)] });
  assert.deepEqual(merged.map((i) => i._id), ["a", "extra"]);
});

test("mergeRecipeIngredients: eliminar gana a modificar sobre el mismo ingrediente", () => {
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  const merged = mergeRecipeIngredients(recipe, {
    removedBaseCustomProductIds: ["a"],
    modifiedBaseCustomProducts: [{ _id: "mod", baseCustomProductId: "a", quantity: 999 }],
  });
  assert.deepEqual(merged.map((i) => i._id), ["b"]);
});

test("mergeRecipeIngredients compara ids como texto, no por referencia", () => {
  // En producción llegan como ObjectId de Mongoose, no como string: toId()
  // normaliza con toString(). Un ObjectId de prueba con el mismo contrato.
  const objectId = (value) => ({ _id: value, toString: () => value });
  const recipe = { customProducts: [{ _id: objectId("a"), quantity: 100 }, base("b", 50)] };
  const merged = mergeRecipeIngredients(recipe, {
    removedBaseCustomProductIds: [objectId("a")],
  });
  assert.deepEqual(merged.map((i) => (i._id.toString ? i._id.toString() : i._id)), ["b"]);
});

test("mergeRecipeIngredients ignora modificados sin baseCustomProductId", () => {
  const recipe = { customProducts: [base("a", 100)] };
  const merged = mergeRecipeIngredients(recipe, {
    modifiedBaseCustomProducts: [{ _id: "huerfano", quantity: 1 }],
  });
  assert.deepEqual(merged.map((i) => i._id), ["a"]);
});

// --- macrosForCustomRecipe --------------------------------------------------

const recipeOf = (...ingredients) => ({ customProducts: ingredients });

test("macrosForCustomRecipe escala por la porción consumida sobre el peso crudo", () => {
  // 200 g de ingredientes a 100 kcal/100 g = 200 kcal la receta entera.
  // Se come la mitad (100 g) -> 100 kcal.
  const customRecipe = {
    recipe: recipeOf(base("a", 100), base("b", 100)),
    quantity: 100,
  };
  assert.equal(macrosForCustomRecipe(customRecipe).kcal, 100);
  assert.equal(kcalForCustomRecipe(customRecipe), 100);
});

test("macrosForCustomRecipe usa quantityCooked como base cuando existe", () => {
  // La receta pierde agua al cocinarse: 200 g crudos quedan en 150 g cocinados.
  // Comerse 75 g cocinados es la mitad de la receta -> 100 kcal.
  const customRecipe = {
    recipe: recipeOf(base("a", 100), base("b", 100)),
    quantityCooked: 150,
    quantity: 75,
  };
  assert.equal(macrosForCustomRecipe(customRecipe).kcal, 100);
});

test("macrosForCustomRecipe sin cantidad consumida no suma nada", () => {
  const recipe = recipeOf(base("a", 100));
  for (const quantity of [0, undefined, null, -5]) {
    assert.deepEqual(macrosForCustomRecipe({ recipe, quantity }), ZERO, `cantidad ${quantity}`);
  }
});

test("macrosForCustomRecipe con receta de peso 0 no divide por cero", () => {
  const customRecipe = { recipe: recipeOf(base("a", 0)), quantity: 50 };
  assert.deepEqual(macrosForCustomRecipe(customRecipe), ZERO);
});

test("macrosForCustomRecipe cuenta los ingredientes añadidos en el peso crudo", () => {
  // 100 g base + 100 g añadidos = 200 g; comerse 200 g es la receta entera.
  const customRecipe = {
    recipe: recipeOf(base("a", 100)),
    addedCustomProducts: [base("extra", 100)],
    quantity: 200,
  };
  assert.equal(macrosForCustomRecipe(customRecipe).kcal, 200);
});

test("macrosForCustomRecipe escala los cuatro macros, no solo las kcal", () => {
  const customRecipe = {
    recipe: recipeOf(snapshot(200, { kcal: 100, protein: 20, carbs: 10, fat: 5 })),
    quantity: 100,
  };
  assert.deepEqual(macrosForCustomRecipe(customRecipe), {
    kcal: 100,
    protein: 20,
    carbs: 10,
    fat: 5,
  });
});

// --- kcalForMeal / macrosForMeal --------------------------------------------

test("kcalForMeal suma productos sueltos y recetas", () => {
  const meal = {
    customProducts: [snapshot(100, { kcal: 300 })],
    customRecipes: [{ recipe: recipeOf(base("a", 100)), quantity: 100 }],
  };
  assert.equal(kcalForMeal(meal), 400);
});

test("kcalForMeal de una comida vacía o ausente es 0", () => {
  assert.equal(kcalForMeal({}), 0);
  assert.equal(kcalForMeal(null), 0);
  assert.equal(kcalForMeal({ customProducts: [], customRecipes: [] }), 0);
});

test("macrosForMeal devuelve los cuatro macros de productos y recetas", () => {
  const meal = {
    customProducts: [snapshot(100, { kcal: 300, protein: 30, carbs: 10, fat: 5 })],
    customRecipes: [
      { recipe: recipeOf(snapshot(100, { kcal: 100, protein: 1, carbs: 2, fat: 3 })), quantity: 100 },
    ],
  };
  assert.deepEqual(macrosForMeal(meal), { kcal: 400, protein: 31, carbs: 12, fat: 8 });
});

// --- isItemPlanned / isItemConsumed -----------------------------------------

test("isItemPlanned distingue lo que pautó el profesional", () => {
  assert.equal(isItemPlanned({ assignedByTrainerId: "trainer-1" }), true);
  assert.equal(isItemPlanned({ assignedByTrainerId: null }), false);
  assert.equal(isItemPlanned({}), false);
  assert.equal(isItemPlanned(null), false);
});

test("isItemConsumed: lo que añade el cliente cuenta siempre como consumido", () => {
  // No existe "lo añadí pero aún no me lo he comido" para algo que registró
  // el propio cliente.
  assert.equal(isItemConsumed({}, {}), true);
  assert.equal(isItemConsumed({ consumed: false }, { completed: false }), true);
});

test("isItemConsumed: lo pautado necesita marca propia o la comida entera hecha", () => {
  const planned = { assignedByTrainerId: "trainer-1" };
  assert.equal(isItemConsumed(planned, {}), false);
  assert.equal(isItemConsumed({ ...planned, consumed: true }, {}), true);
  assert.equal(isItemConsumed(planned, { completed: true }), true);
});

// --- countMealItems / computeDayCompletion ----------------------------------

const plannedItem = (consumed = false) => ({ assignedByTrainerId: "trainer-1", consumed });
const ownItem = () => ({ assignedByTrainerId: null });

test("countMealItems solo cuenta lo pautado", () => {
  // Lo que añade el cliente por su cuenta no es cumplimiento de nada: si
  // entrara en el denominador, un día con extras parecería peor cumplido.
  const meal = {
    customProducts: [plannedItem(true), ownItem(), ownItem()],
    customRecipes: [plannedItem(false)],
  };
  assert.deepEqual(countMealItems(meal), { total: 2, completed: 1 });
});

test("countMealItems: la comida marcada entera da todo por hecho", () => {
  const meal = { completed: true, customProducts: [plannedItem(false), plannedItem(false)] };
  assert.deepEqual(countMealItems(meal), { total: 2, completed: 2 });
});

test("countMealItems de una comida sin nada pautado es 0/0", () => {
  assert.deepEqual(countMealItems({ customProducts: [ownItem()] }), { total: 0, completed: 0 });
  assert.deepEqual(countMealItems({}), { total: 0, completed: 0 });
  assert.deepEqual(countMealItems(null), { total: 0, completed: 0 });
});

test("computeDayCompletion redondea el porcentaje del día", () => {
  const meals = [
    { customProducts: [plannedItem(true), plannedItem(false), plannedItem(false)] },
  ];
  // 1 de 3 = 33,33 -> 33
  assert.deepEqual(computeDayCompletion(meals), { hasPlan: true, completionPercentage: 33 });
});

test("computeDayCompletion de un día sin plan no inventa un 0%", () => {
  // null y no 0: "no tenía nada que hacer" no es "no hizo nada".
  assert.deepEqual(computeDayCompletion([{ customProducts: [ownItem()] }]), {
    hasPlan: false,
    completionPercentage: null,
  });
  assert.deepEqual(computeDayCompletion([]), { hasPlan: false, completionPercentage: null });
  assert.deepEqual(computeDayCompletion(null), { hasPlan: false, completionPercentage: null });
});

test("computeDayCompletion suma las comidas del día entero", () => {
  const meals = [
    { customProducts: [plannedItem(true), plannedItem(true)] },
    { customProducts: [plannedItem(false), plannedItem(false)] },
  ];
  assert.equal(computeDayCompletion(meals).completionPercentage, 50);
});

// --- computeDayTracking -----------------------------------------------------

test("computeDayTracking separa lo pautado de lo realmente consumido", () => {
  const planned = { assignedByTrainerId: "trainer-1", ...snapshot(100, { kcal: 300 }) };
  const plannedEaten = {
    assignedByTrainerId: "trainer-1",
    consumed: true,
    ...snapshot(100, { kcal: 200 }),
  };
  const own = snapshot(100, { kcal: 50 });
  const tracking = computeDayTracking([
    { customProducts: [planned, plannedEaten, own] },
  ]);
  assert.equal(tracking.hasPlan, true);
  assert.equal(tracking.planned.kcal, 500, "pautado = los dos del profesional");
  assert.equal(tracking.consumed.kcal, 250, "consumido = el marcado + lo que añadió el cliente");
});

test("computeDayTracking marca hasPlan aunque el plan sume 0 kcal", () => {
  // Distingue "ese día no había plan" de "había plan y suma 0".
  const tracking = computeDayTracking([
    { customProducts: [{ assignedByTrainerId: "trainer-1", quantity: 0 }] },
  ]);
  assert.equal(tracking.hasPlan, true);
  assert.deepEqual(tracking.planned, ZERO);
});

test("computeDayTracking de un día sin comidas devuelve ceros, no undefined", () => {
  const tracking = computeDayTracking([]);
  assert.equal(tracking.hasPlan, false);
  assert.deepEqual(tracking.planned, ZERO);
  assert.deepEqual(tracking.consumed, ZERO);
  assert.deepEqual(computeDayTracking(null).consumed, ZERO);
});

// --- computeRangeAdherence --------------------------------------------------

const dayWith = (total, completed) => ({
  meals: [
    {
      customProducts: Array.from({ length: total }, (_, i) => plannedItem(i < completed)),
    },
  ],
});

test("computeRangeAdherence promedia solo los días que tenían plan", () => {
  const result = computeRangeAdherence(
    [dayWith(2, 2), dayWith(2, 1), { meals: [{ customProducts: [ownItem()] }] }],
    7,
  );
  // (100 + 50) / 2 días con plan = 75. El tercero no entra en el promedio.
  assert.equal(result.percentage, 75);
  assert.equal(result.daysWithData, 2);
});

test("computeRangeAdherence separa cumplimiento de cobertura", () => {
  // Un cliente perfecto con plan de 10 días dentro de un rango de 30 no es un
  // cliente al 33%: son dos números distintos a propósito.
  const days = Array.from({ length: 10 }, () => dayWith(1, 1));
  const result = computeRangeAdherence(days, 30);
  assert.equal(result.percentage, 100);
  assert.equal(result.coveragePercentage, 33);
  assert.equal(result.periodDays, 30);
});

test("computeRangeAdherence sin ningún día con plan no inventa un 0%", () => {
  const result = computeRangeAdherence([{ meals: [{ customProducts: [ownItem()] }] }], 7);
  assert.equal(result.percentage, null);
  assert.equal(result.daysWithData, 0);
  assert.equal(result.coveragePercentage, 0);
});

test("computeRangeAdherence sin periodDays usa los días con datos", () => {
  const result = computeRangeAdherence([dayWith(1, 1), dayWith(1, 0)]);
  assert.equal(result.periodDays, 2);
  assert.equal(result.coveragePercentage, 100);
});

test("computeRangeAdherence con la lista vacía devuelve cobertura 0 sin dividir por cero", () => {
  assert.deepEqual(computeRangeAdherence([], 0), {
    percentage: null,
    daysWithData: 0,
    periodDays: 0,
    coveragePercentage: 0,
  });
  assert.equal(computeRangeAdherence(null, 7).coveragePercentage, 0);
});
