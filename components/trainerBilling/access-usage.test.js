const test = require("node:test");
const assert = require("node:assert/strict");
const { isPremiumUser, trainerPlan } = require("../billing/feature-access");
const { fake } = require("./test-support");

const ACTIVE = { entitled: true, tier: "starter", interval: "monthly", seats: 25, stripeMode: "test" };
const future = () => new Date(Date.now() + 60000);
// El modo del servidor sale de su STRIPE_KEY; cada test fija la suya y la restaura.
function withKey(t, key) {
  const previous = process.env.STRIPE_KEY;
  process.env.STRIPE_KEY = key;
  t.after(() => { if (previous === undefined) delete process.env.STRIPE_KEY; else process.env.STRIPE_KEY = previous; });
}

test("el cupo sale de la proyección de Stripe: plan, periodicidad y plazas contratadas", (t) => {
  withKey(t, fake("rk", "test", "unit"));
  const expiresAt = future();
  assert.deepEqual(trainerPlan({ professionalPremium: { ...ACTIVE, expiresAt } }),
    { paid: true, tier: "starter", interval: "monthly", seats: 25, expiresAt });
  const free = { paid: false, tier: "free", interval: null, seats: 3, expiresAt: null };
  assert.deepEqual(trainerPlan(null), free);
  assert.deepEqual(trainerPlan({}), free);
  assert.deepEqual(trainerPlan({ professionalPremium: { entitled: false } }), free);
});

test("sin webhook el acceso caduca solo; sin fecha o sin plazas no hay acceso de pago", (t) => {
  withKey(t, fake("rk", "test", "unit"));
  assert.equal(trainerPlan({ professionalPremium: { ...ACTIVE, expiresAt: new Date(Date.now() - 1000) } }).seats, 3);
  assert.equal(trainerPlan({ professionalPremium: { ...ACTIVE } }).paid, false, "Stripe nunca da acceso indefinido");
  assert.equal(trainerPlan({ professionalPremium: { ...ACTIVE, seats: undefined, expiresAt: future() } }).paid, false);
  assert.equal(trainerPlan({ professionalPremium: { ...ACTIVE, seats: 0, expiresAt: future() } }).paid, false);
  // El plan de entrenador nunca toca el premium de cliente (RevenueCat).
  const user = { premium: { entitled: true, expiresAt: future() }, professionalPremium: { ...ACTIVE, expiresAt: new Date(Date.now() - 1) } };
  assert.equal(isPremiumUser(user), true);
  assert.equal(trainerPlan(user).paid, false);
});

test("una compra del sandbox nunca da plazas en un servidor con clave real", (t) => {
  const premium = { professionalPremium: { ...ACTIVE, expiresAt: future() } };
  withKey(t, fake("rk", "live", "unit"));
  assert.equal(trainerPlan(premium).paid, false);
  assert.equal(trainerPlan({ professionalPremium: { ...ACTIVE, stripeMode: "live", expiresAt: future() } }).seats, 25);
  // Con la facturación apagada se respeta lo ya proyectado hasta su fecha.
  process.env.STRIPE_KEY = "";
  assert.equal(trainerPlan(premium).paid, true);
});
