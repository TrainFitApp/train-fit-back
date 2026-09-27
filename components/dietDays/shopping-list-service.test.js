const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildShoppingList,
  buildShoppingSegments,
  aggregateShopping,
  defaultMenuDays,
  itemsOfAlternative,
  groupKey,
  shoppingRange,
} = require("./shopping-list-service");

// La lista de la compra es lo que alguien se lleva al supermercado. Sumar
// mal, duplicar un producto o multiplicar por los días que no son hace que
// compre de más o de menos, y eso se nota el jueves.

function product(name, quantity, productId = null) {
  return {
    quantity,
    product: productId ? { _id: productId, name } : null,
    name: productId ? undefined : name,
  };
}

function alt(customProducts, { label = "", customRecipes = [] } = {}) {
  return { label, customProducts, customRecipes };
}

function menu(name, meals) {
  return { name, meals };
}

function plan(_id, startDate, endDate, menus) {
  return { _id, name: `Plan ${_id}`, startDate, endDate, menus };
}

const POLLO = product("Pollo", 150, "p1");
const ARROZ = product("Arroz", 80, "p2");
const PAVO = product("Pavo", 120, "p3");

function oneMenuPlan() {
  return plan("A", "2026-09-01", null, [
    menu("Menú 1", [{ slot: "Comida", alternatives: [alt([POLLO, ARROZ])] }]),
  ]);
}

test("buildShoppingList", async (t) => {
  await t.test("1 semana = cantidad por día × 7, y 2 semanas el doble", () => {
    const week = buildShoppingList({ from: "2026-09-28", to: "2026-10-04", plans: [oneMenuPlan()], marks: [] });
    const twoWeeks = buildShoppingList({ from: "2026-09-28", to: "2026-10-11", plans: [oneMenuPlan()], marks: [] });

    assert.deepEqual(week.items, [
      { name: "Pollo", quantity: 1050, dayCount: 7 },
      { name: "Arroz", quantity: 560, dayCount: 7 },
    ]);
    assert.equal(twoWeeks.items[0].quantity, 2100);
    assert.equal(twoWeeks.daysWithPlan, 14);
  });

  await t.test("no hace falta que el cliente haya elegido menú: sale del plan", () => {
    // Con los DietDay materializados, los días sin menú elegido salían vacíos.
    const { daysWithPlan } = buildShoppingList({ from: "2026-09-28", to: "2026-09-30", plans: [oneMenuPlan()], marks: [] });
    assert.equal(daysWithPlan, 3);
  });

  await t.test("los días saltados y los que no cubre ningún plan no se compran", () => {
    const late = plan("A", "2026-09-30", null, oneMenuPlan().menus);
    const { daysWithPlan, items } = buildShoppingList({
      from: "2026-09-28",
      to: "2026-10-04",
      plans: [late],
      marks: [{ date: "2026-10-01", skipped: true }],
    });
    // 30/09..04/10 = 5 días, menos el saltado.
    assert.equal(daysWithPlan, 4);
    assert.equal(items[0].quantity, 600);
  });

  await t.test("sin plan devuelve una lista vacía, no revienta", () => {
    assert.deepEqual(buildShoppingList({ from: "2026-09-28", to: "2026-09-28", plans: [], marks: [] }), {
      items: [],
      daysWithPlan: 0,
      segments: [],
    });
  });
});

test("buildShoppingSegments", async (t) => {
  await t.test("una semana preparada tapa al contenido abierto desde su lunes", () => {
    const open = oneMenuPlan();
    const nextWeek = plan("B", "2026-10-05", null, [
      menu("Menú 1", [{ slot: "Comida", alternatives: [alt([PAVO])] }]),
    ]);
    const segments = buildShoppingSegments({ from: "2026-09-28", to: "2026-10-11", plans: [open, nextWeek], marks: [] });

    assert.deepEqual(
      segments.map((s) => [s.planId, s.from, s.to, s.days]),
      [
        ["A", "2026-09-28", "2026-10-04", 7],
        ["B", "2026-10-05", "2026-10-11", 7],
      ]
    );
  });

  await t.test("reparto por defecto: lo elegido cuenta, el resto a partes iguales", () => {
    const twoMenus = plan("A", "2026-09-01", null, [
      menu("M1", [{ slot: "Comida", alternatives: [alt([POLLO])] }]),
      menu("M2", [{ slot: "Comida", alternatives: [alt([PAVO])] }]),
    ]);
    const [segment] = buildShoppingSegments({
      from: "2026-09-28",
      to: "2026-10-04",
      plans: [twoMenus],
      marks: [
        { date: "2026-09-28", menuName: "M2" },
        { date: "2026-09-29", menuName: "M2" },
      ],
    });
    // 2 elegidos de M2 + 5 libres → 3 y 2 (el sobrante al primero).
    assert.deepEqual(
      segment.menus.map((m) => [m.name, m.chosenDays, m.defaultDays]),
      [
        ["M1", 0, 3],
        ["M2", 2, 4],
      ]
    );
  });

  await t.test("las alternativas vacías y las comidas sin nada no salen", () => {
    const withEmpty = plan("A", "2026-09-01", null, [
      menu("M1", [
        { slot: "Desayuno", alternatives: [alt([])] },
        { slot: "Comida", alternatives: [alt([POLLO], { label: "Pollo" }), alt([]), alt([PAVO], { label: "Pavo" })] },
      ]),
    ]);
    const [segment] = buildShoppingSegments({ from: "2026-09-28", to: "2026-09-28", plans: [withEmpty], marks: [] });
    assert.deepEqual(segment.menus[0].meals.map((m) => m.slot), ["Comida"]);
    assert.deepEqual(segment.menus[0].meals[0].alternatives.map((a) => a.label), ["Pollo", "Pavo"]);
  });
});

test("aggregateShopping", async (t) => {
  const twoMenus = plan("A", "2026-09-01", null, [
    menu("M1", [
      { slot: "Comida", alternatives: [alt([POLLO], { label: "Pollo" }), alt([PAVO], { label: "Pavo" })] },
      { slot: "Cena", alternatives: [alt([product("Pollo", 100, "p1")])] },
    ]),
    menu("M2", [{ slot: "Comida", alternatives: [alt([ARROZ])] }]),
  ]);
  const segments = () => buildShoppingSegments({ from: "2026-09-28", to: "2026-10-04", plans: [twoMenus], marks: [] });

  await t.test("aplica los días elegidos por menú y la alternativa de cada comida", () => {
    const items = aggregateShopping(segments(), {
      A: { menuDays: { M1: 5, M2: 2 }, alternatives: { "M1|Comida": 1 } },
    });
    assert.deepEqual(items, [
      { name: "Pavo", quantity: 600, dayCount: 5 },
      { name: "Pollo", quantity: 500, dayCount: 5 },
      { name: "Arroz", quantity: 160, dayCount: 2 },
    ]);
  });

  await t.test("un producto en dos comidas del mismo menú cuenta sus días una vez", () => {
    const items = aggregateShopping(segments(), { A: { menuDays: { M1: 4, M2: 3 } } });
    const pollo = items.find((item) => item.name === "Pollo");
    assert.equal(pollo.quantity, 1000);
    assert.equal(pollo.dayCount, 4);
  });

  await t.test("un menú con 0 días no suma nada", () => {
    const items = aggregateShopping(segments(), { A: { menuDays: { M1: 0, M2: 7 } } });
    assert.deepEqual(items.map((item) => item.name), ["Arroz"]);
  });
});

test("itemsOfAlternative", async (t) => {
  await t.test("suma el mismo producto dentro de la alternativa", () => {
    assert.deepEqual(itemsOfAlternative(alt([POLLO, product("Pollo", 50, "p1")])), [
      { key: "id:p1", name: "Pollo", quantity: 200 },
    ]);
  });

  await t.test("dos productos distintos con el mismo nombre no se juntan", () => {
    const items = itemsOfAlternative(alt([product("Pan", 100, "x1"), product("Pan", 100, "x2")]));
    assert.equal(items.length, 2);
  });

  await t.test("los ingredientes de una receta, escalados a la ración pautada", () => {
    // Receta de 400 g crudos; se pautan 200 g → la mitad de cada ingrediente.
    const recipe = { customProducts: [product("Arroz", 100, "p2"), product("Pollo", 300, "p1")] };
    const items = itemsOfAlternative(alt([], { customRecipes: [{ recipe, quantity: 200 }] }));
    assert.deepEqual(
      items.map((item) => [item.name, item.quantity]),
      [
        ["Arroz", 50],
        ["Pollo", 150],
      ]
    );
  });

  await t.test("receta sin cantidad pautada: se compra entera", () => {
    const recipe = { customProducts: [product("Arroz", 100, "p2")] };
    const items = itemsOfAlternative(alt([], { customRecipes: [{ recipe, quantity: null }] }));
    assert.equal(items[0].quantity, 100);
  });

  await t.test("descarta cantidades cero, negativas y items sin nombre", () => {
    assert.deepEqual(itemsOfAlternative(alt([product("Pollo", 0), product("Arroz", -5), { quantity: 100 }])), []);
  });
});

test("defaultMenuDays", async (t) => {
  await t.test("sin menús no reparte", () => {
    assert.deepEqual(defaultMenuDays([], 7), {});
  });

  await t.test("más días elegidos que el rango: no resta", () => {
    assert.deepEqual(defaultMenuDays([{ name: "A", chosenDays: 3 }, { name: "B", chosenDays: 0 }], 3), { A: 3, B: 0 });
  });
});

test("shoppingRange", async (t) => {
  await t.test("acepta un rango válido de hasta 62 días", () => {
    assert.deepEqual(shoppingRange({ from: "2026-09-01", to: "2026-11-01" }), { from: "2026-09-01", to: "2026-11-01" });
  });

  await t.test("rechaza fechas mal formadas, invertidas o rangos enormes", () => {
    assert.equal(shoppingRange({ from: "hoy", to: "2026-09-01" }), null);
    assert.equal(shoppingRange({ from: "2026-09-10", to: "2026-09-01" }), null);
    assert.equal(shoppingRange({ from: "2026-09-01", to: "2026-11-02" }), null);
  });

  await t.test("sin to: una semana", () => {
    assert.deepEqual(shoppingRange({ from: "2026-09-28" }), { from: "2026-09-28", to: "2026-10-04" });
  });
});

test("groupKey", async (t) => {
  await t.test("prefiere el id del catálogo al nombre", () => {
    assert.equal(groupKey({ product: { _id: "abc", name: "Pollo" } }), "id:abc");
  });

  await t.test("cae al nombre normalizado cuando no hay producto", () => {
    assert.equal(groupKey({ name: "  Pollo  " }), "name:pollo");
  });

  await t.test("sin nada devuelve null", () => {
    assert.equal(groupKey({}), null);
    assert.equal(groupKey({ name: "   " }), null);
  });
});
