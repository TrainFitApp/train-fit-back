const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the real legacy modules with every dependency replaced. In particular,
// no Mongoose connection, SMTP module, dotenv, SDK, or application server loads.
function loadLegacy(relativePath, dependencies = {}, append = "") {
  const filename = path.resolve(__dirname, relativePath);
  const module = { exports: {} };
  const context = {
    module, exports: module.exports,
    require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : {},
    process: { env: {} },
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Set, Map, Buffer,
  };
  vm.runInNewContext(`${fs.readFileSync(filename, "utf8")}\n${append}`, context, { filename });
  return module.exports;
}

// Normalize objects created in a separate VM realm for strict assertions.
const plain = (value) => JSON.parse(JSON.stringify(value));
const USER_ID = "trainer-one";
function response() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
    set() { return this; },
  };
}

test("all profile update paths strip whole, operator and dotted professional billing payloads", async (t) => {
  const attacks = [
    ["whole object", { professionalPremium: { entitled: true, source: "stripe", stripeRevision: 999 } }],
    ["Mongo operator", { $set: { "professionalPremium.entitled": true }, $unset: { professionalPremium: 1 } }],
    ["dotted field", { "professionalPremium.entitled": true, "professionalPremium.source": "manual" }],
  ];
  for (const method of ["updateUser", "updateGoogleUser", "updateAppleUser"]) {
    for (const [label, attack] of attacks) await t.test(`${method}: ${label}`, async () => {
      const calls = [];
      const schema = {
        async findOne() { return { _id: USER_ID }; },
        async findByIdAndUpdate(id, update, options) {
          calls.push({ id, update: plain(update), options: plain(options) });
          return { _id: id, name: (update.$set || update).name };
        },
      };
      const dao = loadLegacy("../users/dao.js", { "./schema": schema });
      const input = { _id: USER_ID, email: "trainer@example.test", name: "Updated name", ...attack };
      const before = plain(input);
      const result = await dao[method](input);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].id, USER_ID);
      assert.equal(result.name, "Updated name");
      const fields = method === "updateUser" ? calls[0].update.$set : calls[0].update;
      assert.equal(fields.name, "Updated name");
      assert.ok(Object.keys(fields).every((key) => key !== "professionalPremium" && !key.startsWith("$") && !key.includes(".")));
      assert.ok(!JSON.stringify(calls[0].update).includes("professionalPremium"));
      assert.deepEqual(plain(input), before, "sanitization must not mutate caller input");
    });
  }
});

test("RevenueCat professional writes enforce Stripe ownership atomically in the database query", async () => {
  const stored = { _id: USER_ID, professionalPremium: { source: "stripe", entitled: true, tier: "trainer_growth", stripeRevision: 4 } };
  const before = plain(stored);
  const calls = [];
  const schema = {
    async findOneAndUpdate(query, update, options) {
      calls.push({ query: plain(query), update: plain(update), options: plain(options) });
      const excludedSource = query["professionalPremium.source"]?.$ne;
      if (excludedSource === stored.professionalPremium.source) return null;
      Object.assign(stored, plain(update.$set));
      return stored;
    },
    findById() { throw new Error("Ownership must not rely on an earlier read"); },
    findByIdAndUpdate() { throw new Error("Professional writes require a conditional query"); },
  };
  const service = loadLegacy("../billing/billing-service.js", { "../users/schema": schema },
    "module.exports.__updateUserPremium = updateUserPremium;");
  const result = await service.__updateUserPremium(USER_ID, {
    entitled: false, plan: "monthly", source: "revenuecat", activeEntitlement: "trainer_pro",
  }, "professionalPremium");
  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].query, { _id: USER_ID, "professionalPremium.source": { $ne: "stripe" } });
  assert.deepEqual(Object.keys(calls[0].update.$set), ["professionalPremium"]);
  assert.deepEqual(stored, before, "late RC expiration must not revoke Stripe access");
});

test("RevenueCat consumer writes remain allowed for a user whose professional subscription uses Stripe", async () => {
  const professional = { source: "stripe", entitled: true, tier: "trainer_growth", stripeRevision: 4 };
  const stored = { _id: USER_ID, premium: { entitled: false }, professionalPremium: plain(professional), isPremium: true };
  const calls = [];
  const schema = {
    async findOneAndUpdate(query, update) {
      calls.push({ query: plain(query), update: plain(update) });
      Object.assign(stored, plain(update.$set));
      for (const key of Object.keys(update.$unset || {})) delete stored[key];
      return stored;
    },
  };
  const service = loadLegacy("../billing/billing-service.js", { "../users/schema": schema },
    "module.exports.__updateUserPremium = updateUserPremium;");
  await service.__updateUserPremium(USER_ID, { entitled: true, plan: "annual", source: "revenuecat" });
  assert.deepEqual(calls[0].query, { _id: USER_ID });
  assert.deepEqual(Object.keys(calls[0].update.$set), ["premium"]);
  assert.deepEqual(calls[0].update.$unset, { isPremium: 1 });
  assert.equal(stored.premium.entitled, true);
  assert.equal(stored.premium.source, "revenuecat");
  assert.deepEqual(stored.professionalPremium, professional);
});

test("professional restore uses only authenticated identity and provider state", async () => {
  const calls = [];
  const user = { _id: USER_ID, professionalPremium: { source: "revenuecat" } };
  const billing = {
    async restoreTrainerFromRevenueCat(actualUser, appUserId) { calls.push({ actualUser, appUserId }); },
    syncTrainerFromCustomerInfo() { throw new Error("Client-provided entitlement state must never be applied"); },
  };
  const controller = loadLegacy("../billing/billing-controller.js", {
    "./billing-service": billing,
    "../trainerBilling/adapter": { async getEntitlements(id) { assert.equal(id, USER_ID); return { isPremium: false }; } },
  });
  const res = response();
  await controller.restoreTrainer({ user, body: { appUserId: "another-customer", customerInfo: { entitled: true }, plan: "annual" } }, res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actualUser, user);
  assert.equal(calls[0].appUserId, USER_ID);
  assert.deepEqual(res.body, { isPremium: false });
});

test("professional restore refuses a Stripe-managed user before invoking RevenueCat", async () => {
  let calls = 0;
  const controller = loadLegacy("../billing/billing-controller.js", {
    "./billing-service": { async restoreTrainerFromRevenueCat() { calls += 1; } },
  });
  const res = response();
  await controller.restoreTrainer({ user: { _id: USER_ID, professionalPremium: { source: "stripe", entitled: false } }, body: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "STRIPE_MANAGED");
  assert.equal(calls, 0);
});

test("delete account refuses another user's ID before any delete or billing side effect", async (t) => {
  for (const roles of [["user"], ["trainer"], ["trainer", "user"]]) await t.test(roles.join("+"), async () => {
    let deletes = 0;
    const controller = loadLegacy("../users/controller.js", { "./model": { async deleteUser() { deletes += 1; } } });
    const res = response();
    await controller.deleteUser({ user: { _id: USER_ID, roles }, params: { id: "victim" } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "FORBIDDEN");
    assert.equal(deletes, 0);
  });
});

test("delete account retains self-service and admin behavior, and propagates cancellation failure", async () => {
  const deleted = [];
  const controller = loadLegacy("../users/controller.js", {
    "./model": { async deleteUser(id) { deleted.push(id); } },
  });
  const self = response();
  await controller.deleteUser({ user: { _id: USER_ID, roles: ["trainer"] }, params: { id: USER_ID } }, self);
  assert.equal(self.statusCode, 204);
  const admin = response();
  await controller.deleteUser({ user: { _id: "admin", roles: ["admin"] }, params: { id: "victim" } }, admin);
  assert.equal(admin.statusCode, 204);
  assert.deepEqual(deleted, [USER_ID, "victim"]);
  const failing = loadLegacy("../users/controller.js", {
    "./model": { async deleteUser() { throw new Error("Billing cancellation failed"); } },
  });
  const failedResponse = response();
  await assert.rejects(failing.deleteUser({ user: { _id: USER_ID, roles: ["trainer"] }, params: { id: USER_ID } }, failedResponse), /Billing cancellation failed/);
  assert.notEqual(failedResponse.statusCode, 204);
});

test("DAO prepares billing before deleting recipes/user, and cancels deletion on billing failure", async () => {
  const order = [];
  let failure = true;
  const dao = loadLegacy("../users/dao.js", {
    "../trainerBilling/adapter": { async prepareDeletion(id) {
      order.push(["billing", id]);
      if (failure) throw new Error("Provider unavailable");
    } },
    "../recipes/recipe-schema": { find() {
      order.push(["read-recipes"]);
      return { select() { return { async lean() { return [{ _id: "recipe-one" }]; } }; } };
    } },
    "../recipes/recipe-model": { async deleteRecipe(id) { order.push(["recipe", id]); } },
    "./schema": { async deleteOne(query) { order.push(["user", query._id]); return { deletedCount: 1 }; } },
  });
  await assert.rejects(dao.deleteUser(USER_ID), /Provider unavailable/);
  assert.deepEqual(order, [["billing", USER_ID]]);
  failure = false;
  order.length = 0;
  await dao.deleteUser(USER_ID);
  assert.deepEqual(order, [["billing", USER_ID], ["read-recipes"], ["recipe", "recipe-one"], ["user", USER_ID]]);
});

test("Stripe adapter projection fences an older revision and never updates consumer premium", async () => {
  let legacyUsers;
  const calls = [];
  const consumer = { entitled: true, source: "revenuecat" };
  const stored = { premium: plain(consumer), professionalPremium: { source: "stripe", stripeRevision: 9, tier: "trainer_growth" } };
  const adapter = loadLegacy("./adapter.js", {
    "../../.build/trainer-billing/runtime": { createRuntime(users) { legacyUsers = users; return {}; } },
    "../users/schema": { async updateOne(query, update) {
      calls.push({ query: plain(query), update: plain(update) });
      const maxRevision = query.$or.find((branch) => branch["professionalPremium.stripeRevision"]?.$lte !== undefined)["professionalPremium.stripeRevision"].$lte;
      if (stored.professionalPremium.stripeRevision > maxRevision) return { matchedCount: 0 };
      Object.assign(stored, plain(update.$set));
      return { matchedCount: 1 };
    } },
  });
  adapter.getRuntime();
  await legacyUsers.project({ userId: USER_ID }, { source: "stripe", stripeRevision: 8, entitled: false });
  assert.equal(stored.professionalPremium.stripeRevision, 9);
  assert.equal(stored.professionalPremium.tier, "trainer_growth");
  await legacyUsers.project({ userId: USER_ID }, { source: "stripe", stripeRevision: 10, entitled: true, tier: "trainer_scale" });
  assert.equal(stored.professionalPremium.stripeRevision, 10);
  assert.equal(stored.professionalPremium.tier, "trainer_scale");
  assert.ok(calls.every((call) => call.query._id === USER_ID));
  assert.ok(calls.every((call) => Object.keys(call.update.$set).join() === "professionalPremium"));
  assert.deepEqual(stored.premium, consumer);
});

test("all Trainer billing routes require trainer authorization", () => {
  const registrations = [];
  const router = {};
  for (const method of ["getAsync", "postAsync"]) router[method] = (route, ...handlers) => registrations.push({ method, route, handlers });
  loadLegacy("../billing/billing-routes.js", {
    "@awaitjs/express": { Router: () => router },
    "../../middleware/validateAuth": { auth: (roles) => ({ roles: plain(roles) }) },
    "../trainerBilling/adapter": { controller: { entitlements() {}, plans() {}, checkout() {}, portal() {}, sync() {},
      changePreview() {}, changePlan() {}, cancel() {}, resume() {}, discardChange() {}, billingDetails() {} } },
  });
  const trainerRoutes = registrations.filter((registration) => registration.route.startsWith("/trainer/"));
  assert.equal(trainerRoutes.length, 12);
  assert.deepEqual(trainerRoutes.map((route) => route.route).sort(), [
    "/trainer/billing-details", "/trainer/cancel", "/trainer/change-plan", "/trainer/change-preview", "/trainer/checkout", "/trainer/discard-change",
    "/trainer/entitlements/me", "/trainer/plans", "/trainer/portal", "/trainer/restore", "/trainer/resume", "/trainer/sync",
  ]);
  for (const route of trainerRoutes) assert.deepEqual(route.handlers[0].roles, ["trainer"]);
});
