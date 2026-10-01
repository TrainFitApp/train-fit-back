const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService, projection } = require("../../.build/trainer-billing/service");
const { loadConfig, publicPlans, requireReady } = require("../../.build/trainer-billing/config");
const { BillingError } = require("../../.build/trainer-billing/types");

// No database, network, credentials, or dotenv. These fakes implement the
// persistence/lease contract; Mongo lease behavior itself needs adapter coverage.
const copy = (value) => structuredClone(value);
const USER_ID = "trainer-one";
const CUSTOMER_ID = "cus_trainerone";
const futureSeconds = () => Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
const errorCode = (code) => (error) => error instanceof BillingError && error.code === code;

function sandboxEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    TRAINER_BILLING_ENABLED: "1",
    TRAINER_BILLING_MODE: "test",
    STRIPE_KEY: "rk_test_unit_test_placeholder",
    STRIPE_WEBHOOK_SECRET: "whsec_unit_test_placeholder",
    TRAINER_BILLING_FRONTEND_URL: "http://localhost:8101",
    TRAINER_BILLING_TAX_POLICY: "test_no_tax",
    STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_promonthly",
    STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_proannual",
    STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growthmonthly",
    STRIPE_TRAINER_GROWTH_ANNUAL_PRICE_ID: "price_growthannual",
    STRIPE_TRAINER_SCALE_MONTHLY_PRICE_ID: "price_scalemonthly",
    STRIPE_TRAINER_SCALE_ANNUAL_PRICE_ID: "price_scaleannual",
    STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit_test",
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    userId: USER_ID, mode: "test", customerId: CUSTOMER_ID,
    status: "none", cancelAtPeriodEnd: false, revision: 0,
    ...overrides,
  };
}

function subscription(overrides = {}) {
  const periodEnd = futureSeconds();
  return {
    id: "sub_trainers", customerId: CUSTOMER_ID, status: "active",
    priceId: "price_promonthly", quantity: 1, currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false, paid: true, paidPriceId: "price_promonthly",
    paidPeriodEnd: periodEnd, livemode: false, userId: USER_ID, scope: "trainers",
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: "cs_test_owned", customerId: CUSTOMER_ID, subscriptionId: null,
    status: "open", url: "https://checkout.stripe.test/owned", userId: USER_ID,
    attempt: "attempt-original", priceId: "price_promonthly", scope: "trainers", livemode: false,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    eventId: "evt_one", type: "invoice.paid", customerId: CUSTOMER_ID,
    mode: "test", status: "pending", attempts: 0,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class MemoryRepository {
  constructor(initialAccount) {
    this.accounts = new Map(initialAccount ? [[initialAccount.userId, copy(initialAccount)]] : []);
    this.users = new Map([[USER_ID, {
      id: USER_ID, email: "trainer@example.test",
      premium: { entitled: true, source: "revenuecat", plan: "annual", marker: "consumer-unchanged" },
    }]]);
    this.events = new Map();
    this.leases = new Set();
    this.projections = [];
    this.projectFailures = 0;
    this.completedEvents = [];
  }
  async get(userId) { return copy(this.accounts.get(userId) || null); }
  async findCustomer(customerId) {
    return copy([...this.accounts.values()].find((row) => row.customerId === customerId) || null);
  }
  async getUser(userId) { return copy(this.users.get(userId) || null); }
  async withLock(userId, action) {
    if (this.leases.has(userId)) throw new BillingError("BILLING_BUSY", "Fake lease is held");
    this.leases.add(userId);
    const row = copy(this.accounts.get(userId) || account({ userId, customerId: undefined }));
    this.accounts.set(userId, copy(row));
    const save = async () => {
      assert.ok(this.leases.has(userId), "writes require the lease");
      row.revision += 1;
      this.accounts.set(userId, copy(row));
    };
    try { return await action(row, save); }
    finally { this.leases.delete(userId); }
  }
  async project(row, value) {
    if (this.projectFailures > 0) {
      this.projectFailures -= 1;
      throw new Error("Simulated projection storage failure");
    }
    this.projections.push({ userId: row.userId, value: copy(value) });
    const user = this.users.get(row.userId);
    if (user) user.professionalPremium = copy(value);
  }
  async saveEvent(record) {
    const stored = this.events.get(record.eventId) || copy(record);
    stored.attempts += 1;
    this.events.set(stored.eventId, stored);
    return copy(stored);
  }
  async completeEvent(id) {
    this.events.get(id).status = "processed";
    this.completedEvents.push(id);
  }
  async failEvent(id) {
    const stored = this.events.get(id);
    if (stored.status !== "processed") stored.status = "failed";
  }
  async pendingEvents(limit) {
    return copy([...this.events.values()].filter((row) => row.status !== "processed").slice(0, limit));
  }
  async accountsForReconciliation(limit) {
    return copy([...this.accounts.values()].filter((row) => row.customerId).slice(0, limit));
  }
}

class FakeGateway {
  constructor() {
    this.subscriptions = [];
    this.sessions = [];
    this.calls = [];
    this.customerGate = null;
    this.customerEntered = null;
    this.cancelFailures = 0;
  }
  called(name) { return this.calls.filter((call) => call.name === name); }
  async createCustomer(user, key) {
    this.calls.push({ name: "createCustomer", userId: user.id, key });
    this.customerEntered?.resolve();
    if (this.customerGate) await this.customerGate.promise;
    return CUSTOMER_ID;
  }
  async validatePrice(price) { this.calls.push({ name: "validatePrice", price: copy(price) }); }
  async listSubscriptions(customerId) {
    this.calls.push({ name: "listSubscriptions", customerId });
    return copy(this.subscriptions);
  }
  async listSessions(customerId) {
    this.calls.push({ name: "listSessions", customerId });
    return copy(this.sessions);
  }
  async getSession(id) {
    this.calls.push({ name: "getSession", id });
    const found = this.sessions.find((entry) => entry.id === id);
    assert.ok(found, "the test must register the provider session");
    return copy(found);
  }
  async createCheckout(user, row, price, key) {
    this.calls.push({ name: "createCheckout", userId: user.id, customerId: row.customerId, priceId: price.id, key });
    const created = session({ id: `cs_test_created${this.called("createCheckout").length}`,
      userId: user.id, customerId: row.customerId, priceId: price.id, attempt: key });
    this.sessions.unshift(created);
    return copy(created);
  }
  async createPortal(customerId) {
    this.calls.push({ name: "createPortal", customerId });
    return "https://billing.stripe.test/portal";
  }
  async expireSession(id) {
    this.calls.push({ name: "expireSession", id });
    this.sessions.find((entry) => entry.id === id).status = "expired";
  }
  async cancelSubscription(id) {
    this.calls.push({ name: "cancelSubscription", id });
    if (this.cancelFailures > 0) {
      this.cancelFailures -= 1;
      throw new Error("Simulated provider cancellation failure");
    }
    this.subscriptions.find((entry) => entry.id === id).status = "canceled";
  }
}

function setup(initialAccount, envOverrides = {}) {
  const config = loadConfig(sandboxEnv(envOverrides));
  const repository = new MemoryRepository(initialAccount);
  const gateway = new FakeGateway();
  return { config, repository, gateway, service: new TrainerBillingService(config, repository, gateway) };
}

test("configuration defaults to disabled and exposes only public catalog data", () => {
  const config = loadConfig({});
  assert.equal(config.enabled, false);
  assert.throws(() => requireReady(config), errorCode("BILLING_DISABLED"));
  const result = publicPlans(config);
  assert.equal(result.enabled, false);
  assert.equal(result.capabilities.planChanges, false);
  assert.deepEqual(result.plans.map((plan) => [plan.tier, plan.clientLimit, plan.prices.monthly.amount, plan.prices.annual.amount]), [
    ["trainer_pro", 20, 2900, 29700], ["trainer_growth", 50, 4900, 50900], ["trainer_scale", 150, 11900, 120900],
  ]);
  const publicJson = JSON.stringify(publicPlans(loadConfig(sandboxEnv())));
  assert.ok(!publicJson.includes("unit_test_placeholder"));
  assert.ok(!publicJson.includes("price_promonthly"));
});

test("configuration fails closed for unsafe live, sandbox in production, unknown tax and wrong frontend", async (t) => {
  const live = { TRAINER_BILLING_MODE: "live", STRIPE_KEY: "rk_live_unit_test_placeholder",
    TRAINER_BILLING_TAX_POLICY: "stripe_tax", TRAINER_BILLING_FRONTEND_URL: "https://trainers.example.test",
    STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_unittest", TRAINER_BILLING_TERMS_URL: "https://trainfit.example.test/condiciones",
    TRAINER_BILLING_SUPPORT_EMAIL: "facturacion@example.test" };
  const cases = [
    // Decisiones 2026-09-28: live exige métodos de pago explícitos, condiciones y buzón de facturación.
    [{ ...live, STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: "" }, "PAYMENT_METHOD_CONFIGURATION_REQUIRED"],
    [{ ...live, TRAINER_BILLING_TERMS_URL: "" }, "TERMS_URL_REQUIRED"],
    [{ ...live, TRAINER_BILLING_SUPPORT_EMAIL: "" }, "SUPPORT_EMAIL_REQUIRED"],
    [{ ...live, TRAINER_BILLING_TERMS_URL: "http://trainfit.example.test/condiciones" }, "INVALID_TERMS_URL"],
    [{ STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: "card" }, "INVALID_PAYMENT_METHOD_CONFIGURATION"],
    [{ TRAINER_BILLING_SUPPORT_EMAIL: "facturacion" }, "INVALID_SUPPORT_EMAIL"],
    [{ TRAINER_BILLING_MODE: "staging" }, "INVALID_MODE"],
    [{ ...live, STRIPE_KEY: "rk_test_unit_test_placeholder" }, "LIVE_RESTRICTED_KEY_REQUIRED"],
    [{ ...live, STRIPE_KEY: "sk_live_unit_test_placeholder" }, "LIVE_RESTRICTED_KEY_REQUIRED"],
    [{ ...live, TRAINER_BILLING_TAX_POLICY: "test_no_tax" }, "LIVE_TAX_POLICY_REQUIRED"],
    [{ ...live, TRAINER_BILLING_FRONTEND_URL: "http://trainers.example.test" }, "HTTPS_FRONTEND_ORIGIN_REQUIRED"],
    [{ ...live, TRAINER_BILLING_FRONTEND_URL: "https://localhost:8100" }, "HTTPS_FRONTEND_ORIGIN_REQUIRED"],
    [{ STRIPE_KEY: "rk_live_unit_test_placeholder" }, "TEST_KEY_REQUIRED"],
    [{ NODE_ENV: "production" }, "TEST_MODE_IN_PRODUCTION"],
    [{ TRAINER_BILLING_TAX_POLICY: "pending" }, "TAX_POLICY_REQUIRED"],
    [{ TRAINER_BILLING_TAX_POLICY: "vat_guess" }, "TAX_POLICY_REQUIRED"],
    [{ TRAINER_BILLING_FRONTEND_URL: "https://trainers.example.test" }, "LOCAL_FRONTEND_ORIGIN_REQUIRED"],
    [{ STRIPE_WEBHOOK_SECRET: "" }, "WEBHOOK_SECRET_REQUIRED"],
    [{ STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_growthmonthly" }, "DUPLICATE_PRICES"],
  ];
  for (const [overrides, expected] of cases) await t.test(expected, async () => {
    const { config, service, gateway, repository } = setup(undefined, overrides);
    assert.ok(config.errors.includes(expected));
    await assert.rejects(service.checkout(USER_ID, "trainer_pro", "monthly"), errorCode("BILLING_NOT_READY"));
    assert.equal(gateway.calls.length, 0);
    assert.equal(repository.accounts.size, 0);
  });
});

test("a complete live configuration is accepted only with a restricted key, Stripe Tax and an HTTPS frontend", () => {
  const config = loadConfig(sandboxEnv({ TRAINER_BILLING_MODE: "live", STRIPE_KEY: "rk_live_unit_test_placeholder",
    TRAINER_BILLING_TAX_POLICY: "stripe_tax", TRAINER_BILLING_FRONTEND_URL: "https://trainers.example.test/", NODE_ENV: "production",
    STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_unittest", TRAINER_BILLING_TERMS_URL: "https://trainfit.example.test/condiciones",
    TRAINER_BILLING_SUPPORT_EMAIL: "Facturacion@Example.test" }));
  assert.deepEqual(config.errors, []);
  assert.equal(config.mode, "live");
  assert.equal(config.taxPolicy, "stripe_tax");
  assert.equal(config.frontendUrl, "https://trainers.example.test");
  assert.equal(config.paymentMethodConfiguration, "pmc_unittest");
  assert.deepEqual(publicPlans(config).support, { email: "facturacion@example.test", termsUrl: "https://trainfit.example.test/condiciones" });
  assert.equal(loadConfig(sandboxEnv({ TRAINER_BILLING_TAX_POLICY: "stripe_tax" })).errors.length, 0, "the sandbox may also test Stripe Tax");
  assert.deepEqual(publicPlans(loadConfig(sandboxEnv())).support, { email: null, termsUrl: null }, "optional in the sandbox");
});

test("with Managed Payments live needs no payment method configuration: Stripe sells and picks the methods", () => {
  const managed = loadConfig(sandboxEnv({ TRAINER_BILLING_MODE: "live", STRIPE_KEY: "rk_live_unit_test_placeholder",
    TRAINER_BILLING_TAX_POLICY: "managed_payments", TRAINER_BILLING_FRONTEND_URL: "https://trainers.example.test", NODE_ENV: "production",
    TRAINER_BILLING_TERMS_URL: "https://trainfit.example.test/condiciones", TRAINER_BILLING_SUPPORT_EMAIL: "facturacion@example.test" }));
  assert.deepEqual(managed.errors, []);
  assert.equal(managed.taxPolicy, "managed_payments");
  assert.equal(publicPlans(managed).taxPolicy, "managed_payments", "the app tells trainers who sells");
  assert.equal(loadConfig(sandboxEnv({ TRAINER_BILLING_TAX_POLICY: "managed_payments" })).errors.length, 0, "the sandbox may test it too");
});

test("checkout only accepts a catalog plan and interval", async () => {
  const { service, gateway, repository } = setup();
  await assert.rejects(service.checkout(USER_ID, "price_arbitrary", "monthly"), errorCode("INVALID_PLAN"));
  await assert.rejects(service.checkout(USER_ID, "trainer_pro", "week"), errorCode("INVALID_PLAN"));
  await assert.rejects(service.checkout(USER_ID, "pro", "monthly"), errorCode("INVALID_PLAN"));
  assert.equal(gateway.calls.length, 0);
  assert.equal(repository.accounts.size, 0);
});

test("checkout uses server customer/price and grants no access before payment; consumer premium is untouched", async () => {
  const { service, repository, gateway } = setup();
  const consumerBefore = copy(repository.users.get(USER_ID).premium);
  const result = await service.checkout(USER_ID, "trainer_growth", "annual");
  assert.equal(result.reused, false);
  assert.deepEqual(gateway.called("createCheckout").map(({ userId, customerId, priceId }) => ({ userId, customerId, priceId })), [
    { userId: USER_ID, customerId: CUSTOMER_ID, priceId: "price_growthannual" },
  ]);
  assert.ok(repository.projections.length > 0);
  assert.ok(repository.projections.every((entry) => entry.userId === USER_ID && entry.value.source === "stripe" && !entry.value.entitled));
  assert.deepEqual(repository.users.get(USER_ID).premium, consumerBefore);
  assert.equal((await repository.get(USER_ID)).status, "checkout_pending");
});

test("the account lease prevents concurrent duplicate customer/checkout creation and retry reuses the session", async () => {
  const { service, gateway } = setup();
  gateway.customerGate = deferred();
  gateway.customerEntered = deferred();
  const first = service.checkout(USER_ID, "trainer_pro", "monthly");
  await gateway.customerEntered.promise;
  await assert.rejects(service.checkout(USER_ID, "trainer_pro", "monthly"), errorCode("BILLING_BUSY"));
  gateway.customerGate.resolve();
  const created = await first;
  const retry = await service.checkout(USER_ID, "trainer_pro", "monthly");
  assert.equal(retry.reused, true);
  assert.equal(retry.sessionId, created.sessionId);
  assert.equal(gateway.called("createCustomer").length, 1);
  assert.equal(gateway.called("createCheckout").length, 1);
  assert.equal(gateway.called("createCustomer")[0].key, `trainers-test-${USER_ID}`);
});

test("canonical active subscription prevents another checkout even if the local account was stale", async () => {
  const { service, gateway, repository } = setup(account());
  gateway.subscriptions = [subscription()];
  await assert.rejects(service.checkout(USER_ID, "trainer_growth", "annual"), errorCode("ACTIVE_SUBSCRIPTION"));
  assert.equal(gateway.called("createCheckout").length, 0);
  assert.equal(gateway.called("createCustomer").length, 0);
  assert.equal((await repository.get(USER_ID)).subscriptionId, "sub_trainers");
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, true);
});

test("existing RevenueCat entitlement is not overwritten to create a second paid subscription", async () => {
  const { service, repository, gateway } = setup();
  const legacy = { entitled: true, source: "revenuecat", tier: "trainer_pro", expiresAt: new Date(futureSeconds() * 1000) };
  repository.users.get(USER_ID).professionalPremium = copy(legacy);
  await assert.rejects(service.checkout(USER_ID, "trainer_pro", "monthly"), errorCode("LEGACY_SUBSCRIPTION"));
  assert.deepEqual(repository.users.get(USER_ID).professionalPremium, legacy);
  assert.equal(repository.accounts.size, 0);
  assert.equal(gateway.calls.length, 0);
});

test("sync rejects a foreign/live/wrong-scope return session before reading or projecting subscriptions", async (t) => {
  const cases = [
    ["customer", { customerId: "cus_other" }], ["user", { userId: "someone-else" }],
    ["scope", { scope: "consumer" }], ["mode", { livemode: true }],
  ];
  for (const [label, overrides] of cases) await t.test(label, async () => {
    const { service, gateway, repository } = setup(account());
    gateway.sessions = [session(overrides)];
    gateway.subscriptions = [subscription()];
    await assert.rejects(service.sync(USER_ID, "cs_test_owned"), errorCode("SESSION_NOT_OWNED"));
    assert.equal(gateway.called("listSubscriptions").length, 0);
    assert.equal(repository.projections.length, 0);
  });
});

test("sync rejects invalid sessions and cannot adopt a checkout when the caller has no customer", async () => {
  const { service, gateway } = setup();
  await assert.rejects(service.sync(USER_ID, "cs_live_invalid"), errorCode("INVALID_SESSION"));
  await assert.rejects(service.sync(USER_ID, { id: "cs_test_owned" }), errorCode("INVALID_SESSION"));
  await assert.rejects(service.sync(USER_ID, "cs_test_owned"), errorCode("SESSION_NOT_OWNED"));
  assert.equal(gateway.calls.length, 0);
});

test("return URL and complete Checkout never grant access to an unpaid initial subscription", async () => {
  const { service, repository, gateway } = setup(account());
  gateway.sessions = [session({ status: "complete", subscriptionId: "sub_trainers" })];
  gateway.subscriptions = [subscription({ status: "incomplete", paid: false, paidPriceId: null, paidPeriodEnd: 0 })];
  await service.sync(USER_ID, "cs_test_owned");
  const current = repository.users.get(USER_ID).professionalPremium;
  assert.equal(current.entitled, false);
  assert.equal(current.expiresAt, null);
  assert.equal(current.tier, null);
});

test("a paid renewal projects the server catalog tier while preserving consumer billing", async () => {
  const { service, repository, gateway, config } = setup(account());
  const consumerBefore = copy(repository.users.get(USER_ID).premium);
  gateway.subscriptions = [subscription({ priceId: "price_growthannual", paidPriceId: "price_growthannual" })];
  await service.sync(USER_ID);
  const current = repository.users.get(USER_ID).professionalPremium;
  assert.equal(current.entitled, true);
  assert.equal(current.tier, "trainer_growth");
  assert.equal(current.plan, "annual");
  assert.equal(config.plans.find((plan) => plan.tier === current.tier).clientLimit, 50);
  assert.deepEqual(repository.users.get(USER_ID).premium, consumerBefore);
});

test("unpaid plan change cannot raise the paid tier or extend its previously paid access", async (t) => {
  for (const status of ["active", "past_due"]) await t.test(status, async () => {
    const paidUntil = new Date((futureSeconds() - 20 * 24 * 3600) * 1000);
    const { service, repository, gateway } = setup(account({ subscriptionId: "sub_trainers", status: "active",
      tier: "trainer_pro", interval: "monthly", paidUntil }));
    gateway.subscriptions = [subscription({ status, priceId: "price_scaleannual", paid: false,
      paidPriceId: null, paidPeriodEnd: 0 })];
    await service.sync(USER_ID);
    const current = repository.users.get(USER_ID).professionalPremium;
    assert.equal(current.entitled, true);
    assert.equal(current.tier, "trainer_pro");
    assert.equal(current.plan, "monthly");
    // past_due: 7 días de margen sobre lo ya pagado (decisión 2026-09-18), nunca el periodo nuevo sin pagar.
    const grace = status === "past_due" ? 7 * 86400000 : 0;
    assert.equal(current.expiresAt.getTime(), paidUntil.getTime() + grace);
  });
});

test("active status with a paid invoice for another price cannot grant an initial tier", async () => {
  const { service, repository, gateway } = setup(account());
  gateway.subscriptions = [subscription({ priceId: "price_scaleannual", paid: true, paidPriceId: "price_promonthly" })];
  await service.sync(USER_ID);
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, false);
  assert.equal((await repository.get(USER_ID)).paidUntil, undefined);
});

test("paid access is capped by the paid invoice period, and cancel-at-period-end retains only that access", async () => {
  const paidPeriodEnd = futureSeconds() - 10 * 24 * 3600;
  const { service, repository, gateway } = setup(account());
  gateway.subscriptions = [subscription({ cancelAtPeriodEnd: true, paidPeriodEnd })];
  await service.sync(USER_ID);
  const row = await repository.get(USER_ID);
  assert.equal(row.cancelAtPeriodEnd, true);
  assert.equal(row.paidUntil.getTime(), paidPeriodEnd * 1000);
  assert.equal(projection(row, new Date(paidPeriodEnd * 1000 - 1)).entitled, true);
  const expired = projection(row, new Date(paidPeriodEnd * 1000));
  assert.equal(expired.entitled, false);
  assert.equal(expired.source, "stripe", "expired accounts retain their provider authority");
  assert.equal(projection(row, new Date(paidPeriodEnd * 1000 + 1)).entitled, false);
});

test("immediate terminal cancellation removes access even if the old paid period has not ended", async () => {
  const { service, repository, gateway } = setup(account({ subscriptionId: "sub_trainers", status: "active",
    tier: "trainer_pro", interval: "monthly", paidUntil: new Date(futureSeconds() * 1000) }));
  gateway.subscriptions = [subscription({ status: "canceled" })];
  await service.sync(USER_ID);
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, false);
  assert.equal(repository.users.get(USER_ID).professionalPremium.source, "stripe");
  assert.equal((await repository.get(USER_ID)).paidUntil, null);
});

test("terminal canceled subscription with an old completed Checkout permits a new checkout attempt", async () => {
  const oldKey = "attempt-original";
  const { service, repository, gateway } = setup(account({ subscriptionId: "sub_trainers", status: "canceled",
    checkout: { key: oldKey, priceId: "price_promonthly", startedAt: new Date(Date.now() - 3 * 24 * 3600000) } }));
  gateway.subscriptions = [subscription({ status: "canceled" })];
  gateway.sessions = [session({ status: "complete", subscriptionId: "sub_trainers", attempt: oldKey })];
  const result = await service.checkout(USER_ID, "trainer_scale", "annual");
  assert.equal(result.reused, false);
  assert.equal(gateway.called("createCheckout").length, 1);
  assert.notEqual(gateway.called("createCheckout")[0].key, oldKey);
  assert.equal(gateway.called("createCheckout")[0].priceId, "price_scaleannual");
  assert.equal(gateway.called("createCustomer").length, 0);
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, false);
});

test("failed event remains durable and retryable after account save but before access projection", async () => {
  const { service, repository, gateway } = setup(account());
  gateway.subscriptions = [subscription()];
  repository.projectFailures = 1;
  await assert.rejects(service.event(event()), /projection storage failure/);
  assert.equal(repository.events.get("evt_one").status, "failed");
  assert.equal(repository.completedEvents.length, 0);
  assert.equal((await repository.get(USER_ID)).subscriptionId, "sub_trainers", "failure occurs after persisted billing state");
  assert.equal(repository.users.get(USER_ID).professionalPremium, undefined);
  await service.event(event());
  assert.equal(repository.events.get("evt_one").status, "processed");
  assert.equal(repository.events.get("evt_one").attempts, 2);
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, true);
  const reads = gateway.called("listSubscriptions").length;
  const projections = repository.projections.length;
  await service.event(event());
  assert.equal(gateway.called("listSubscriptions").length, reads, "processed duplicate does no provider work");
  assert.equal(repository.projections.length, projections);
});

test("out-of-order events re-read current provider state instead of reverting to the older event type", async () => {
  const { service, repository, gateway } = setup(account());
  gateway.subscriptions = [subscription({ priceId: "price_growthannual", paidPriceId: "price_growthannual" })];
  await service.event(event({ eventId: "evt_new_paid", type: "invoice.paid" }));
  await service.event(event({ eventId: "evt_old_failed", type: "invoice.payment_failed" }));
  await service.event(event({ eventId: "evt_old_deleted", type: "customer.subscription.deleted" }));
  assert.equal(gateway.called("listSubscriptions").length, 3);
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, true);
  assert.equal(repository.users.get(USER_ID).professionalPremium.tier, "trainer_growth");
  assert.ok([...repository.events.values()].every((record) => record.status === "processed"));
});

test("foreign subscriptions fail closed and unrelated customer events do not alter access", async () => {
  const { service, repository, gateway } = setup(account());
  gateway.subscriptions = [subscription({ userId: "other-user" })];
  await assert.rejects(service.sync(USER_ID), errorCode("SUBSCRIPTION_NOT_OWNED"));
  assert.equal(repository.projections.length, 0);
  gateway.calls.length = 0;
  await service.event(event({ eventId: "evt_unrelated", customerId: "cus_otherproduct" }));
  assert.equal(repository.events.get("evt_unrelated").status, "processed");
  assert.equal(repository.projections.length, 0);
  assert.equal(gateway.calls.length, 0);
});

test("reconciliation recovers a failed event and missing webhook without granting unpaid upgrades", async () => {
  const paidUntil = new Date(futureSeconds() * 1000);
  const { service, repository, gateway } = setup(account({ status: "active", subscriptionId: "sub_trainers",
    tier: "trainer_pro", interval: "monthly", paidUntil }));
  gateway.subscriptions = [subscription({ priceId: "price_growthmonthly", paid: false, paidPriceId: null, paidPeriodEnd: 0 })];
  repository.events.set("evt_retry", event({ eventId: "evt_retry", status: "failed", attempts: 1 }));
  await service.reconcile();
  assert.equal(repository.events.get("evt_retry").status, "processed");
  assert.equal(repository.users.get(USER_ID).professionalPremium.tier, "trainer_pro");
  assert.equal(repository.users.get(USER_ID).professionalPremium.expiresAt.getTime(), paidUntil.getTime());
});

test("deletion persists its guard before provider work, expires Checkout and retries cancellation safely", async () => {
  const { service, repository, gateway } = setup(account({ status: "active", subscriptionId: "sub_trainers",
    tier: "trainer_pro", interval: "monthly", paidUntil: new Date(futureSeconds() * 1000) }));
  gateway.sessions = [session()];
  gateway.subscriptions = [subscription()];
  gateway.cancelFailures = 1;
  await assert.rejects(service.prepareDeletion(USER_ID), /provider cancellation failure/);
  assert.ok((await repository.get(USER_ID)).deletedAt);
  assert.equal(gateway.sessions[0].status, "expired");
  await assert.rejects(service.checkout(USER_ID, "trainer_pro", "monthly"), errorCode("ACCOUNT_DELETION_PENDING"));
  await assert.rejects(service.portal(USER_ID), errorCode("ACCOUNT_DELETION_PENDING"));
  await service.prepareDeletion(USER_ID);
  assert.equal(gateway.subscriptions[0].status, "canceled");
  assert.equal((await repository.get(USER_ID)).status, "canceled");
  assert.equal(repository.users.get(USER_ID).professionalPremium.entitled, false);
  assert.equal(gateway.called("expireSession").length, 1);
  await service.prepareDeletion(USER_ID);
  assert.equal(gateway.called("cancelSubscription").length, 2, "terminal subscription is not canceled again");
});

test("disabling billing never allows deletion to orphan an existing Stripe customer", async () => {
  const { service, repository, gateway } = setup(account(), { TRAINER_BILLING_ENABLED: "0" });
  await assert.rejects(service.prepareDeletion(USER_ID), errorCode("BILLING_DISABLED"));
  assert.equal((await repository.get(USER_ID)).deletedAt, undefined);
  assert.equal(gateway.calls.length, 0);
});

test("portal uses the authenticated user's stored customer and rejects users without billing accounts", async () => {
  const { service, gateway } = setup(account());
  await assert.rejects(service.portal("unknown-user"), errorCode("NO_BILLING_ACCOUNT"));
  const result = await service.portal(USER_ID);
  assert.match(result.url, /^https:\/\/billing\.stripe\.test\//);
  assert.deepEqual(gateway.called("createPortal"), [{ name: "createPortal", customerId: CUSTOMER_ID }]);
});
