const test = require("node:test");
const assert = require("node:assert/strict");
const { buildShoppingList, groupKey, productsOfMeal } = require("./shopping-list-service");

// La lista de la compra es lo que alguien se lleva al supermercado. Sumar
// mal, duplicar un producto o colar lo que el cliente comió por su cuenta
// hace que compre de más o de menos, y eso se nota el jueves.

const TRAINER = "trainer-1";

function product(name, quantity, { productId = null, planned = true } = {}) {
  return {
    quantity,
    product: productId ? { _id: productId, name } : null,
    name: productId ? undefined : name,
    assignedByTrainerId: planned ? TRAINER : null,
  };
}

function day(date, products) {
  return { date, meals: [{ customProducts: products }] };
}

test("buildShoppingList", async (t) => {
  await t.test("suma el mismo producto a lo largo de los días", () => {
    const { items } = buildShoppingList([
      day("2026-08-01", [product("Pollo", 150, { productId: "p1" })]),
      day("2026-08-02", [product("Pollo", 200, { productId: "p1" })]),
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Pollo");
    assert.equal(items[0].quantity, 350);
    assert.equal(items[0].dayCount, 2);
  });

  await t.test("dos productos distintos con el mismo nombre no se juntan", () => {
    // Agrupar solo por nombre sumaría dos productos de catálogo distintos
    // que se llaman igual (dos marcas de "Pan integral").
    const { items } = buildShoppingList([
      day("2026-08-01", [
        product("Pan integral", 100, { productId: "p1" }),
        product("Pan integral", 100, { productId: "p2" }),
      ]),
    ]);
    assert.equal(items.length, 2);
  });

  await t.test("productos escritos a mano se agrupan por nombre, sin distinguir mayúsculas", () => {
    const { items } = buildShoppingList([
      day("2026-08-01", [product("Aguacate", 100)]),
      day("2026-08-02", [product("AGUACATE", 50)]),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 150);
  });

  await t.test("solo cuenta lo PAUTADO, no lo que el cliente añadió por su cuenta", () => {
    // La lista sirve para cumplir el plan; con lo que se comió por su cuenta
    // dentro, sería un histórico de consumo.
    const { items } = buildShoppingList([
      day("2026-08-01", [
        product("Pollo", 150),
        product("Chocolate", 50, { planned: false }),
      ]),
    ]);
    assert.deepEqual(
      items.map((item) => item.name),
      ["Pollo"]
    );
  });

  await t.test("con onlyPlanned false entra todo", () => {
    const { items } = buildShoppingList(
      [day("2026-08-01", [product("Chocolate", 50, { planned: false })])],
      { onlyPlanned: false }
    );
    assert.equal(items.length, 1);
  });

  await t.test("ordena por cantidad, y por nombre cuando empatan", () => {
    const { items } = buildShoppingList([
      day("2026-08-01", [
        product("Arroz", 100),
        product("Ternera", 300),
        product("Brócoli", 100),
      ]),
    ]);
    assert.deepEqual(
      items.map((item) => item.name),
      ["Ternera", "Arroz", "Brócoli"]
    );
  });

  await t.test("los ingredientes de una receta cuentan como productos sueltos", () => {
    // Quien va al supermercado compra pollo y arroz, no "arroz con pollo".
    const days = [
      {
        date: "2026-08-01",
        meals: [
          {
            customProducts: [],
            customRecipes: [
              {
                recipe: {
                  customProducts: [
                    product("Arroz", 80, { productId: "p1" }),
                    product("Pollo", 120, { productId: "p2" }),
                  ],
                },
              },
            ],
          },
        ],
      },
    ];
    const { items } = buildShoppingList(days);
    assert.deepEqual(
      items.map((item) => item.name).sort(),
      ["Arroz", "Pollo"]
    );
  });

  await t.test("cuenta los días que REALMENTE tenían plan", () => {
    // Sin esto, una lista corta parecería un plan flojo cuando lo que pasa
    // es que solo hay dos días pautados de los treinta pedidos.
    const { daysWithPlan } = buildShoppingList([
      day("2026-08-01", [product("Pollo", 150)]),
      day("2026-08-02", []),
      day("2026-08-03", [product("Pollo", 150)]),
    ]);
    assert.equal(daysWithPlan, 2);
  });

  await t.test("descarta cantidades cero o negativas en vez de sumarlas", () => {
    const { items } = buildShoppingList([
      day("2026-08-01", [product("Pollo", 0), product("Arroz", -50)]),
    ]);
    assert.deepEqual(items, []);
  });

  await t.test("un item sin nombre ni producto no genera una fila en blanco", () => {
    const { items } = buildShoppingList([
      day("2026-08-01", [{ quantity: 100, assignedByTrainerId: TRAINER }]),
    ]);
    assert.deepEqual(items, []);
  });

  await t.test("sin días devuelve una lista vacía, no revienta", () => {
    assert.deepEqual(buildShoppingList([]), { items: [], daysWithPlan: 0 });
    assert.deepEqual(buildShoppingList(null), { items: [], daysWithPlan: 0 });
  });

  await t.test("redondea a un decimal, sin acumular error a lo largo del mes", () => {
    const days = Array.from({ length: 30 }, (_unused, index) =>
      day(`2026-08-${String(index + 1).padStart(2, "0")}`, [product("Arroz", 33.33)])
    );
    const { items } = buildShoppingList(days);
    assert.equal(items[0].quantity, 999.9);
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

test("productsOfMeal", async (t) => {
  await t.test("junta los sueltos y los de recetas", () => {
    const meal = {
      customProducts: [{ name: "Aceite" }],
      customRecipes: [{ recipe: { customProducts: [{ name: "Arroz" }] } }],
    };
    assert.equal(productsOfMeal(meal).length, 2);
  });

  await t.test("una comida vacía no revienta", () => {
    assert.deepEqual(productsOfMeal({}), []);
    assert.deepEqual(productsOfMeal(null), []);
  });
});
