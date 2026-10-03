const test = require("node:test");
const assert = require("node:assert/strict");
const { isEffectivelyEntitled, isPremiumUser } = require("./feature-access-service");

test("isEffectivelyEntitled", async (t) => {
  await t.test("entitled=false -> false regardless of expiresAt", () => {
    assert.equal(
      isEffectivelyEntitled({ entitled: false, expiresAt: new Date(Date.now() + 100000) }),
      false,
    );
  });

  await t.test("entitled=true, expiresAt in the future -> true", () => {
    assert.equal(
      isEffectivelyEntitled({ entitled: true, expiresAt: new Date(Date.now() + 100000) }),
      true,
    );
  });

  await t.test(
    "entitled=true, expiresAt in the past (missed EXPIRATION webhook) -> false",
    () => {
      assert.equal(
        isEffectivelyEntitled({ entitled: true, expiresAt: new Date(Date.now() - 1) }),
        false,
      );
    },
  );

  await t.test("entitled=true, no expiresAt (legacy/manual grant) -> true", () => {
    assert.equal(isEffectivelyEntitled({ entitled: true }), true);
  });

  await t.test("no premium object -> false", () => {
    assert.equal(isEffectivelyEntitled(null), false);
    assert.equal(isEffectivelyEntitled(undefined), false);
  });
});

test("isPremiumUser", async (t) => {
  await t.test("user with expired premium is not premium", () => {
    const user = { premium: { entitled: true, expiresAt: new Date(Date.now() - 1000) } };
    assert.equal(isPremiumUser(user), false);
  });

  await t.test("user with active premium is premium", () => {
    const user = { premium: { entitled: true, expiresAt: new Date(Date.now() + 1000) } };
    assert.equal(isPremiumUser(user), true);
  });

  await t.test("user without premium field is not premium", () => {
    assert.equal(isPremiumUser({}), false);
    assert.equal(isPremiumUser(null), false);
  });
});

test("activePremiumFilter: misma regla que isEffectivelyEntitled, como filtro de MongoDB", () => {
  const { activePremiumFilter } = require("./feature-access-service");
  const now = new Date();
  assert.deepEqual(activePremiumFilter(now), {
    "premium.entitled": true,
    $or: [{ "premium.expiresAt": null }, { "premium.expiresAt": { $gt: now } }],
  });
});
