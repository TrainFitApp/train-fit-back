const test = require("node:test");
const assert = require("node:assert/strict");
const { billableClientKeys } = require("../../.build/trainer-billing/usage");
const { getTrainerLimits, isPremiumTrainer, isPremiumUser } = require("../billing/feature-access-service");

test("client usage merges both scopes and pending invitations with known client ids", () => {
  const keys = billableClientKeys([
    { clientId: "a", clientEmail: "first@example.test" },
    { clientEmail: " FIRST@example.test " },
    { clientId: "a", clientEmail: "changed@example.test" },
    { clientId: "b", clientEmail: "second@example.test" },
    { clientEmail: "pending@example.test" },
    { clientEmail: "PENDING@example.test" },
  ]);
  assert.deepEqual([...keys].sort(), ["email:pending@example.test", "id:a", "id:b"]);
});

test("Stripe trainer tiers have their own limits and preserve RC Pro and Unlimited", () => {
  const premium = { entitled: true, expiresAt: new Date(Date.now() + 60000) };
  for (const [tier, clients] of [["trainer_pro", 20], ["trainer_growth", 50], ["trainer_scale", 150]]) {
    assert.deepEqual(getTrainerLimits({ professionalPremium: { ...premium, source: "stripe", tier } }), { tier, clients });
  }
  assert.equal(getTrainerLimits({ professionalPremium: { ...premium, source: "revenuecat", tier: "trainer_pro" } }).clients, 15);
  assert.equal(getTrainerLimits({ professionalPremium: { ...premium, source: "revenuecat", tier: "trainer_unlimited" } }).clients, Number.MAX_SAFE_INTEGER);
  assert.equal(getTrainerLimits({}).clients, 3);
});

test("Stripe access expires without a webhook, requires a date and never changes consumer premium", () => {
  const user = { premium: { entitled: true, expiresAt: new Date(Date.now() + 60000) },
    professionalPremium: { entitled: true, source: "stripe", tier: "trainer_growth", expiresAt: new Date(Date.now() - 1000) } };
  assert.equal(isPremiumTrainer(user), false);
  assert.equal(getTrainerLimits(user).clients, 3);
  assert.equal(isPremiumUser(user), true);
  delete user.professionalPremium.expiresAt;
  assert.equal(isPremiumTrainer(user), false);
});
