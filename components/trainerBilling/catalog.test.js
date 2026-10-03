const test = require("node:test");
const assert = require("node:assert/strict");
const { CATALOG, FREE_SEATS, billingModeFromKey, catalogPrices, libraryBytes, lookupKey, maxExtraSeats, purchasable,
  recurringAmount, sameState, seatsOf, tierRank } = require("../../.build/trainer-billing/catalog");
const { fake, state } = require("./test-support");

// Importe mensual para N clientes en un plan (plazas incluidas + adicionales), en céntimos.
const monthlyFor = (tier, clients) => recurringAmount(state(tier, "monthly", Math.max(0, clients - CATALOG[tier].includedSeats)));

test("Free cobra solo las plazas adicionales: 3 € cada una y hasta 12 plazas", () => {
  for (const [clients, cents] of [[3, 0], [4, 300], [5, 600], [8, 1500], [10, 2100], [12, 2700]]) {
    assert.equal(monthlyFor("free", clients), cents, `${clients} clientes`);
  }
  assert.equal(FREE_SEATS, 3);
  assert.equal(maxExtraSeats("free"), 9);
  assert.equal(purchasable(state("free", "monthly", 9)), true);
  assert.equal(purchasable(state("free", "monthly", 10)), false, "13 clientes ya no caben en Free");
  // Free sin plazas adicionales no es una suscripción, y sus plazas solo se venden mensuales.
  assert.equal(purchasable(state("free", "monthly", 0)), false);
  assert.equal(purchasable(state("free", "annual", 1)), false);
});

test("Inicio: 29 € con 20 plazas, 1 € por plaza adicional y hasta 40", () => {
  for (const [clients, cents] of [[20, 2900], [21, 3000], [22, 3100], [30, 3900], [39, 4800], [40, 4900]]) {
    assert.equal(monthlyFor("starter", clients), cents, `${clients} clientes`);
  }
  assert.equal(purchasable(state("starter", "monthly", 20)), true);
  assert.equal(purchasable(state("starter", "monthly", 21)), false);
  // Con 40 plazas Inicio cuesta lo mismo que Profesional, que trae 50.
  assert.equal(monthlyFor("starter", 40), recurringAmount(state("professional")));
});

test("Profesional: 49 € con 50 plazas, 0,80 € por plaza adicional y hasta 125", () => {
  for (const [clients, cents] of [[50, 4900], [51, 4980], [75, 6900], [100, 8900], [124, 10820], [125, 10900]]) {
    assert.equal(monthlyFor("professional", clients), cents, `${clients} clientes`);
  }
  assert.equal(maxExtraSeats("professional"), 75);
  assert.equal(purchasable(state("professional", "monthly", 76)), false, "126 clientes: Escala sale más barato");
  assert.equal(monthlyFor("professional", 125), recurringAmount(state("scale")));
});

test("Escala: 109 € con 150 plazas y sin plazas adicionales", () => {
  assert.equal(recurringAmount(state("scale")), 10900);
  assert.equal(seatsOf(state("scale")), 150);
  assert.equal(purchasable(state("scale", "monthly", 1)), false, "más de 150: oferta a medida");
});

test("el anual equivale a diez mensualidades, también en las plazas adicionales", () => {
  for (const tier of ["starter", "professional", "scale"]) {
    assert.equal(CATALOG[tier].base.annual, CATALOG[tier].base.monthly * 10);
    if (CATALOG[tier].seat.monthly) assert.equal(CATALOG[tier].seat.annual, CATALOG[tier].seat.monthly * 10);
  }
  assert.equal(recurringAmount(state("starter", "annual", 10)), 29000 + 10 * 1000);
  assert.equal(recurringAmount(state("professional", "annual", 0)), 49000);
});

test("estados no válidos no se pueden contratar", () => {
  for (const bad of [state("starter", "monthly", -1), state("starter", "monthly", 1.5), state("starter", "weekly", 0),
    state("gold", "monthly", 0), { tier: "starter", interval: "monthly", extraSeats: Number.NaN }]) {
    assert.equal(purchasable(bad), false, JSON.stringify(bad));
  }
  assert.equal(sameState(state("starter", "monthly", 2), state("starter", "monthly", 2)), true);
  assert.equal(sameState(state("starter", "monthly", 2), state("starter", "annual", 2)), false);
  assert.equal(sameState(null, state("starter")), false);
  assert.deepEqual(["free", "starter", "professional", "scale"].map(tierRank), [0, 1, 2, 3]);
});

test("cada pieza a la venta tiene una lookup key única e igual en sandbox y en real", () => {
  const prices = catalogPrices();
  assert.equal(prices.length, 11, "6 cuotas y 5 precios de plaza adicional");
  const keys = prices.map((entry) => lookupKey(entry.kind, entry.tier, entry.interval));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("trainfit_trainers_free_seat_monthly"));
  assert.ok(!keys.some((key) => key.startsWith("trainfit_trainers_free_base")), "Free no tiene cuota");
  assert.ok(!keys.some((key) => key.startsWith("trainfit_trainers_scale_seat")), "Escala no vende plazas");
});

test("el prefijo de la clave decide el entorno; en real solo valen claves restringidas", () => {
  assert.equal(billingModeFromKey(fake("rk", "live", "x")), "live");
  assert.equal(billingModeFromKey(fake("rk", "test", "x")), "test");
  assert.equal(billingModeFromKey(fake("sk", "test", "x")), "test");
  assert.equal(billingModeFromKey(fake("sk", "live", "x")), null);
  assert.equal(billingModeFromKey(""), null);
  assert.equal(billingModeFromKey(undefined), null);
});

test("la biblioteca del entrenador sube con el plan, no con las plazas adicionales", () => {
  const GB = 1024 ** 3;
  assert.deepEqual(["free", "starter", "professional", "scale"].map((tier) => libraryBytes(tier) / GB), [2, 10, 25, 75]);
  assert.equal(libraryBytes(null), 2 * GB);
  assert.equal(libraryBytes("unknown"), 2 * GB);
});
