const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoRepository } = require("../../.build/trainer-billing/mongo-repository");

test("Mongoose insertion defaults cannot contaminate the account lease filter", async (t) => {
  const repository = new MongoRepository({});
  t.mock.method(repository, "init", async () => {});
  const model = mongoose.model("TrainerStripeAccount");
  const row = { userId: "native-fixture", mode: "test", status: "none", revision: 0, cancelAtPeriodEnd: false };
  const filters = [];
  t.mock.method(model, "updateOne", async (query, update) => {
    filters.push(structuredClone(query));
    // Reproduces Mongoose 6's in-place version-key default. Native/imported
    // billing accounts legitimately do not contain __v.
    if (update.$setOnInsert) update.$setOnInsert.__v = 0;
    return { matchedCount: 1 };
  });
  t.mock.method(model, "findOneAndUpdate", (query) => {
    filters.push(structuredClone(query));
    assert.deepEqual(Object.keys(query).sort(), ["leaseUntil", "mode", "userId"]);
    return { lean: () => ({ exec: async () => ({ ...row }) }) };
  });
  await repository.withLock(row.userId, async (account, save) => {
    await save();
    assert.equal(account.revision, 1);
  });
  assert.equal(filters.length, 4);
  for (const filter of filters) assert.equal(Object.hasOwn(filter, "__v"), false);
});

test("retrying a persisted lean event inserts only event fields and never Mongo timestamps", async (t) => {
  const repository = new MongoRepository({});
  t.mock.method(repository, "init", async () => {});
  const model = mongoose.model("TrainerStripeEvent");
  const persisted = { eventId: "evt_retry", mode: "test", type: "invoice.paid", customerId: "cus_owned",
    status: "failed", attempts: 1, _id: "database-only-id", __v: 0,
    createdAt: new Date(), updatedAt: new Date(), lastAttemptAt: new Date() };
  t.mock.method(model, "updateOne", async (query, update) => {
    assert.deepEqual(query, { eventId: "evt_retry", mode: "test" });
    assert.deepEqual(update.$setOnInsert, { eventId: "evt_retry", mode: "test", type: "invoice.paid",
      customerId: "cus_owned", status: "pending", attempts: 0, detail: null });
    // Mongoose timestamps add $set.updatedAt; including it on insertion too
    // would produce Mongo code 40 before the retry can increment its attempt.
    assert.equal(Object.hasOwn(update.$setOnInsert, "updatedAt"), false);
    return { matchedCount: 1 };
  });
  t.mock.method(model, "findOneAndUpdate", (_query, update) => {
    assert.equal(update.$inc.attempts, 1);
    return { lean: () => ({ exec: async () => ({ ...persisted, attempts: 2 }) }) };
  });
  const result = await repository.saveEvent(persisted);
  assert.equal(result.attempts, 2);
  assert.equal(result.status, "failed");
  assert.equal(persisted.attempts, 1);
});
