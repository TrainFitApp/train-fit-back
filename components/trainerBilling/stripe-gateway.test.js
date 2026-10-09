const test = require("node:test");
const assert = require("node:assert/strict");
const { StripeGateway, priceRef } = require("../../.build/trainer-billing/stripe-gateway");
const { stateView } = require("../../.build/trainer-billing/config");
const { catalogStripePrices, errorCode, itemsFor, priceId, sandboxConfig, state, stripePrice, subscription } = require("./test-support");

const START = 1800000000;
const END = START + 30 * 86400;

// Gateway con el catálogo publicado en Stripe (prices.list por lookup key).
function fixture(t, { prices = catalogStripePrices(), config = sandboxConfig() } = {}) {
  const gateway = new StripeGateway(config);
  const priceLists = [];
  t.mock.method(gateway.stripe.prices, "list", async (params) => {
    priceLists.push(params);
    // Como Stripe: como mucho 10 lookup keys por consulta.
    if (params.lookup_keys.length > 10) throw new Error("lookup_keys admite como mucho 10");
    return { data: structuredClone(prices.filter((price) => params.lookup_keys.includes(price.lookup_key))) };
  });
  t.mock.method(gateway.stripe.prices, "retrieve", async (id) => {
    const found = prices.find((price) => price.id === id);
    if (!found) throw new Error(`unexpected price ${id}`);
    return structuredClone(found);
  });
  return { gateway, config, priceLists };
}
// Suscripción de Stripe (objeto del SDK) con sus elementos y su última factura.
function stripeSub(value, { invoice = { status: "paid" }, items, extra = {} } = {}) {
  const data = (items || itemsFor(value)).map((item) => ({ id: item.id, quantity: item.quantity, current_period_start: START,
    current_period_end: END, price: stripePrice(item.price.kind, item.price.tier, item.price.interval), discounts: [], tax_rates: [] }));
  const latest = { id: "in_latest", livemode: false, status: invoice.status, amount_due: 0, hosted_invoice_url: null,
    lines: { has_more: false, data: (invoice.lines || data).map((item) => ({ amount: 100, period: { start: START, end: END },
      pricing: { price_details: { price: item.price?.id } },
      parent: { type: "subscription_item_details", subscription_item_details: { subscription_item: item.id, proration: false } } })) } };
  return { id: "sub_trainers", customer: "cus_trainerone", livemode: false, status: "active", cancel_at_period_end: false, cancel_at: null,
    metadata: { trainfitUserId: "trainer-one", scope: "trainers" }, items: { has_more: false, data }, latest_invoice: latest,
    schedule: null, pending_update: null, collection_method: "charge_automatically", discounts: [], default_tax_rates: [], ...extra };
}
async function view(t, gateway, sub) {
  t.mock.method(gateway.stripe.subscriptions, "list", async () => ({ has_more: false, data: [sub] }));
  return (await gateway.listSubscriptions("cus_trainerone"))[0];
}

test("gateway verifies signed raw bytes, rejects tampering and live events", (t) => {
  const { gateway, config } = fixture(t);
  const payload = JSON.stringify({ id: "evt_unit", type: "invoice.paid", livemode: false, data: { object: { customer: "cus_unit" } } });
  const signature = gateway.stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
  assert.equal(gateway.verifyEvent(Buffer.from(payload), signature).customerId, "cus_unit");
  assert.throws(() => gateway.verifyEvent(Buffer.from(payload + " "), signature), { code: "INVALID_SIGNATURE" });
  assert.throws(() => gateway.verifyEvent(Buffer.from(payload), "wrong"), { code: "INVALID_SIGNATURE" });
  const live = payload.replace('"livemode":false', '"livemode":true');
  const liveSignature = gateway.stripe.webhooks.generateTestHeaderString({ payload: live, secret: config.webhookSecret });
  assert.throws(() => gateway.verifyEvent(Buffer.from(live), liveSignature), { code: "MODE_MISMATCH" });
  const ignored = JSON.stringify({ id: "evt_other", type: "product.created", livemode: false, data: { object: {} } });
  assert.equal(gateway.verifyEvent(Buffer.from(ignored), gateway.stripe.webhooks.generateTestHeaderString({ payload: ignored,
    secret: config.webhookSecret })), null, "eventos que no se procesan");
});

test("un precio es del catálogo solo con sus metadatos y una recurrencia de un mes o un año", () => {
  assert.deepEqual(priceRef(stripePrice("seat", "starter", "annual")), { id: priceId("seat", "starter", "annual"), kind: "seat",
    tier: "starter", interval: "annual", amount: 1000 });
  for (const broken of [{ metadata: {} }, { metadata: { ...stripePrice("base", "starter", "monthly").metadata, trainfit_catalog: "other" } },
    { recurring: { interval: "week", interval_count: 1, usage_type: "licensed" } }, { currency: "usd" }, { type: "one_time" },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }, { billing_scheme: "tiered" },
    { metadata: { ...stripePrice("base", "starter", "monthly").metadata, trainfit_tier: "gold" } }]) {
    assert.equal(priceRef(stripePrice("base", "starter", "monthly", broken)), null, JSON.stringify(broken));
  }
});

test("los precios se buscan por lookup key, se comprueban contra el catálogo y se cachean", async (t) => {
  const { gateway, priceLists } = fixture(t);
  await gateway.validateState(state("starter", "annual", 5));
  await gateway.validateState(state("free", "monthly", 2));
  // 11 precios en tandas de 10 (límite de Stripe), una sola vez para varias propuestas.
  assert.deepEqual(priceLists.map((params) => params.lookup_keys.length), [10, 1]);
  assert.ok(priceLists.every((params) => params.active === true));

  const wrongAmount = catalogStripePrices().map((price) => price.id === priceId("base", "starter", "monthly") ? { ...price, unit_amount: 2500 } : price);
  await assert.rejects(fixture(t, { prices: wrongAmount }).gateway.validateState(state("starter")), errorCode("PRICE_MISMATCH"));
  const vatIncluded = catalogStripePrices().map((price) => ({ ...price, tax_behavior: "inclusive" }));
  await assert.rejects(fixture(t, { prices: vatIncluded }).gateway.validateState(state("starter")), errorCode("PRICE_MISMATCH"));
  const missingSeat = catalogStripePrices().filter((price) => price.id !== priceId("seat", "professional", "monthly"));
  const partial = fixture(t, { prices: missingSeat }).gateway;
  await partial.validateState(state("professional", "monthly", 0));
  await assert.rejects(partial.validateState(state("professional", "monthly", 3)), errorCode("PRICE_CATALOG_REQUIRED"));
  const live = catalogStripePrices().map((price) => ({ ...price, livemode: true }));
  await assert.rejects(fixture(t, { prices: live }).gateway.validateState(state("starter")), errorCode("MODE_MISMATCH"));
});

test("la suscripción se lee como cuota + plazas; la plaza con cantidad 0 no cuenta y un precio ajeno pide revisión", async (t) => {
  const { gateway } = fixture(t);
  const sub = await view(t, gateway, stripeSub(state("starter", "monthly", 5)));
  assert.deepEqual(sub.state, state("starter", "monthly", 5));
  assert.deepEqual(sub.items.map((item) => [item.id, item.price.kind, item.quantity]), [["si_base", "base", 1], ["si_seat", "seat", 5]]);
  assert.equal(sub.paid, true);
  assert.equal(sub.paidPeriodEnd, END);

  const free = await view(t, gateway, stripeSub(state("free", "monthly", 3)));
  assert.deepEqual(free.state, state("free", "monthly", 3));

  const zeroSeat = [...itemsFor(state("professional")), { id: "si_seat", price: priceRef(stripePrice("seat", "starter", "monthly")), quantity: 0 }];
  assert.deepEqual((await view(t, gateway, stripeSub(state("professional"), { items: zeroSeat }))).state, state("professional", "monthly", 0));

  const foreign = stripeSub(state("starter"));
  foreign.items.data.push({ id: "si_foreign", quantity: 1, current_period_start: START, current_period_end: END,
    price: { ...stripePrice("base", "starter", "monthly"), id: "price_other", metadata: {} } });
  assert.equal((await view(t, gateway, foreign)).state, null);
  const twoBases = stripeSub(state("starter"), { items: [...itemsFor(state("starter")),
    { id: "si_base2", price: priceRef(stripePrice("base", "professional", "monthly")), quantity: 1 }] });
  assert.equal((await view(t, gateway, twoBases)).state, null);
});

test("prueba de pago: última factura pagada, sin actualización pendiente y cubriendo los elementos vigentes", async (t) => {
  const { gateway } = fixture(t);
  assert.equal((await view(t, gateway, stripeSub(state("starter"), { invoice: { status: "open" } }))).paid, false);
  assert.equal((await view(t, gateway, stripeSub(state("starter"), { extra: { pending_update: { expires_at: END } } }))).paid, false);
  // Un elemento que no sale en la última factura sigue cubierto por el periodo de la cuota.
  const uncovered = stripeSub(state("starter", "monthly", 3), { invoice: { status: "paid", lines: [{ id: "si_base",
    price: stripePrice("base", "starter", "monthly") }] } });
  const sub = await view(t, gateway, uncovered);
  assert.equal(sub.paid, true);
  assert.equal(sub.paidPeriodEnd, END);
  const unrelated = stripeSub(state("starter"), { invoice: { status: "paid", lines: [{ id: "si_gone", price: stripePrice("base", "scale", "monthly") }] } });
  assert.equal((await view(t, gateway, unrelated)).paidPeriodEnd, 0);
});

test("los cambios reutilizan la plaza adicional y solo la borran si el destino no vende plazas", async (t) => {
  const { gateway } = fixture(t);
  const sub = (value, items) => subscription(value, { items: items || itemsFor(value) });
  const price = (kind, tier, interval = "monthly") => priceId(kind, tier, interval);

  // Más plazas en el mismo plan: solo cambia la cantidad.
  assert.deepEqual((await gateway.changeItems(sub(state("starter", "monthly", 5)), state("starter", "monthly", 8))).updates,
    [{ id: "si_seat", price: price("seat", "starter"), quantity: 8 }]);
  // Primera plaza adicional: elemento nuevo.
  assert.deepEqual((await gateway.changeItems(sub(state("starter")), state("starter", "monthly", 3))).updates,
    [{ price: price("seat", "starter"), quantity: 3 }]);
  // Free con plazas → Inicio: se añade la cuota y la plaza pasa al precio de Inicio con cantidad 0.
  const fromFree = await gateway.changeItems(sub(state("free", "monthly", 9)), state("starter"));
  assert.deepEqual(fromFree.updates, [{ price: price("base", "starter"), quantity: 1 }, { id: "si_seat", price: price("seat", "starter"), quantity: 0 }]);
  assert.deepEqual(fromFree.fromItems, [{ price: price("seat", "free"), quantity: 9 }]);
  assert.deepEqual(fromFree.targetItems, [{ price: price("base", "starter"), quantity: 1 }]);
  // Inicio con plazas → Profesional: cuota nueva y plazas a 0.
  assert.deepEqual((await gateway.changeItems(sub(state("starter", "monthly", 5)), state("professional"))).updates,
    [{ id: "si_base", price: price("base", "professional"), quantity: 1 }, { id: "si_seat", price: price("seat", "professional"), quantity: 0 }]);
  // Profesional con plazas → Escala anual: Escala no vende plazas, se borra el elemento.
  assert.deepEqual((await gateway.changeItems(sub(state("professional", "monthly", 10)), state("scale", "annual"))).updates,
    [{ id: "si_base", price: price("base", "scale", "annual"), quantity: 1 }, { id: "si_seat", deleted: true }]);
  // Mismo estado con una plaza a 0 en otra periodicidad: se alinea para que todos los elementos compartan intervalo.
  const zero = [...itemsFor(state("starter")), { id: "si_seat", price: priceRef(stripePrice("seat", "starter", "monthly")), quantity: 0 }];
  assert.deepEqual((await gateway.changeItems(sub(state("starter"), zero), state("starter", "annual"))).updates,
    [{ id: "si_base", price: price("base", "starter", "annual"), quantity: 1 }, { id: "si_seat", price: price("seat", "starter", "annual"), quantity: 0 }]);
});

test("Checkout vende con Managed Payments la cuota y las plazas pedidas, con parámetros estables para reintentar", async (t) => {
  const { gateway, config } = fixture(t, { config: sandboxConfig({ STRIPE_TERMS_URL: "https://trainfit.net/condiciones" }) });
  const calls = [];
  t.mock.method(gateway.stripe.checkout.sessions, "create", async (params, options) => {
    calls.push({ params, options });
    return { id: "cs_test_one", livemode: false, customer: "cus_trainerone", subscription: null, status: "open",
      url: "https://checkout.stripe.com/c/pay/one", metadata: params.metadata };
  });
  const row = { customerId: "cus_trainerone", checkout: { startedAt: new Date() } };
  const user = { id: "trainer-one", email: "trainer@example.test" };
  const created = await gateway.createCheckout(user, row, state("starter", "annual", 4), "trainers-checkout-key01234567");
  await gateway.createCheckout(user, row, state("starter", "annual", 4), "trainers-checkout-key01234567");
  assert.deepEqual(calls[0], calls[1]);
  const { params, options } = calls[0];
  assert.equal(options.idempotencyKey, "trainers-checkout-key01234567");
  assert.deepEqual(params.line_items, [{ price: priceId("base", "starter", "annual"), quantity: 1 },
    { price: priceId("seat", "starter", "annual"), quantity: 4 }]);
  assert.deepEqual(params.managed_payments, { enabled: true });
  assert.equal(params.billing_address_collection, "required");
  for (const forbidden of ["automatic_tax", "custom_text", "payment_method_configuration", "tax_id_collection", "customer_update"]) {
    assert.equal(params[forbidden], undefined, `${forbidden} no se admite con Managed Payments`);
  }
  assert.deepEqual(params.consent_collection, { terms_of_service: "required" });
  assert.deepEqual(params.metadata, { trainfitUserId: "trainer-one", scope: "trainers", attempt: "trainers-checkout-key01234567",
    target: "starter:annual:4" });
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  assert.equal(params.success_url, `${config.returnUrl}/tabs/subscription?session_id={CHECKOUT_SESSION_ID}`);
  assert.ok(params.expires_at - Math.floor(Date.now() / 1000) > 30 * 60);
  assert.equal(created.target, "starter:annual:4");

  calls.length = 0;
  await gateway.createCheckout(user, row, state("free", "monthly", 2), "trainers-checkout-free01234567");
  assert.deepEqual(calls[0].params.line_items, [{ price: priceId("seat", "free", "monthly"), quantity: 2 }], "Free solo paga sus plazas");
});

test("si Stripe rechaza abrir Checkout se dice en el log con código, parámetro y petición, nunca con el mensaje", async (t) => {
  const Stripe = require("stripe");
  const { gateway } = fixture(t, { config: sandboxConfig({ STRIPE_TERMS_URL: "https://trainfit.net/condiciones" }) });
  const secretish = "cus_trainerone trainer@example.test";
  t.mock.method(gateway.stripe.checkout.sessions, "create", async () => {
    throw new Stripe.errors.StripeInvalidRequestError({ message: `You cannot collect consent… ${secretish}`,
      type: "invalid_request_error", param: "consent_collection[terms_of_service]", requestId: "req_rejected" });
  });
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(line));
  const row = { customerId: "cus_trainerone", checkout: { startedAt: new Date() } };
  await assert.rejects(gateway.createCheckout({ id: "trainer-one", email: "trainer@example.test" }, row, state("professional"),
    "trainers-checkout-key01234567"), errorCode("CHECKOUT_REJECTED"));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /consent_collection\[terms_of_service\]/);
  assert.match(logged[0], /req_rejected/);
  assert.ok(!logged[0].includes(secretish), "el mensaje de Stripe no llega al log");
  // Un error que no es un rechazo (red, 5xx) se deja tal cual: el intento puede haberse creado.
  t.mock.method(gateway.stripe.checkout.sessions, "create", async () => { throw new Stripe.errors.StripeConnectionError({ message: "x" }); });
  await assert.rejects(gateway.createCheckout({ id: "trainer-one" }, row, state("professional"), "trainers-checkout-key01234567"),
    (error) => error instanceof Stripe.errors.StripeConnectionError);
});

test("si Stripe rechaza aplicar un cambio (sin permiso o inválido) se traduce a CHANGE_REJECTED; idempotencia no", async (t) => {
  const Stripe = require("stripe");
  const { gateway } = fixture(t);
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(line));
  const quote = { subscriptionId: "sub_trainers", updates: [], prorationDate: START };
  t.mock.method(gateway.stripe.subscriptions, "update", async () => {
    throw new Stripe.errors.StripePermissionError({ message: "key rk_test_x lacks access", requestId: "req_perm" });
  });
  await assert.rejects(gateway.applyUpgrade(quote, "trainers-change-key"), errorCode("CHANGE_REJECTED"));
  assert.match(logged[0], /aplicar el cambio: StripePermissionError, petición req_perm/);
  assert.ok(!logged[0].includes("rk_test_x"));
  // Clave reutilizada con otros parámetros: el original pudo aplicarse, así que no se descarta nada.
  t.mock.method(gateway.stripe.subscriptions, "update", async () => { throw new Stripe.errors.StripeIdempotencyError({ message: "x" }); });
  await assert.rejects(gateway.applyUpgrade(quote, "trainers-change-key"), (error) => error instanceof Stripe.errors.StripeIdempotencyError);
});

test("rechazos al crear el cliente, cancelar o programar una bajada se traducen; la bajada libera su calendario", async (t) => {
  const Stripe = require("stripe");
  const { gateway } = fixture(t);
  t.mock.method(console, "error", () => {});
  const invalid = () => new Stripe.errors.StripeInvalidRequestError({ message: "x", param: "items", requestId: "req_bad" });
  t.mock.method(gateway.stripe.customers, "create", async () => { throw new Stripe.errors.StripePermissionError({ message: "x" }); });
  await assert.rejects(gateway.createCustomer({ id: "trainer-one", email: "t@example.test" }, "key"), errorCode("CUSTOMER_REJECTED"));
  t.mock.method(gateway.stripe.subscriptions, "update", async () => { throw invalid(); });
  await assert.rejects(gateway.setCancellation("sub_trainers", true, "key"), errorCode("CONTROL_REJECTED"));

  const phase = { start_date: START, end_date: END, currency: "eur", collection_method: "charge_automatically", billing_cycle_anchor: null,
    default_payment_method: null, default_tax_rates: [], description: null, metadata: {}, add_invoice_items: [], discounts: [],
    items: [{ price: priceId("base", "starter", "monthly"), quantity: 1, discounts: [], tax_rates: [] }] };
  t.mock.method(gateway.stripe.subscriptionSchedules, "create", async () => ({ id: "sub_sched_x", livemode: false, phases: [structuredClone(phase)] }));
  t.mock.method(gateway.stripe.subscriptionSchedules, "update", async () => { throw invalid(); });
  t.mock.method(gateway.stripe.subscriptionSchedules, "retrieve", async (id) => ({ id, livemode: false, status: "active" }));
  const released = [];
  t.mock.method(gateway.stripe.subscriptionSchedules, "release", async (id, _params, options) => { released.push([id, options.idempotencyKey]); return {}; });
  const quote = { quoteId: "q-x", subscriptionId: "sub_trainers", prorationDate: START + 100, periodEnd: END,
    to: stateView(state("free", "monthly", 4)), fromItems: [{ price: priceId("base", "starter", "monthly"), quantity: 1 }],
    targetItems: [{ price: priceId("seat", "free", "monthly"), quantity: 4 }] };
  await assert.rejects(gateway.scheduleChange(quote, "down-x"), errorCode("CHANGE_REJECTED"));
  assert.deepEqual(released, [["sub_sched_x", "down-x-abort"]], "no queda un calendario de una sola fase bloqueando otros cambios");
});

test("el portal usa la configuración predeterminada solo si no permite cambios de plan ni cancelar al momento", async (t) => {
  const { gateway } = fixture(t);
  const portal = { id: "bpc_default", livemode: false, active: true, features: { subscription_update: { enabled: false },
    invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" } } };
  let listed;
  t.mock.method(gateway.stripe.billingPortal.configurations, "list", async (params) => { listed = params; return { data: [structuredClone(portal)] }; });
  let created;
  t.mock.method(gateway.stripe.billingPortal.sessions, "create", async (params) => { created = params; return { url: "https://billing.stripe.com/p/session/x" }; });
  assert.equal(await gateway.createPortal("cus_trainerone"), "https://billing.stripe.com/p/session/x");
  assert.deepEqual(listed, { is_default: true, active: true, limit: 1 });
  assert.equal(created.configuration, "bpc_default");
  assert.match(created.return_url, /\/tabs\/subscription\?from=portal$/);
  for (const unsafe of [{ subscription_update: { enabled: true } }, { subscription_cancel: { enabled: true, mode: "immediately" } },
    { invoice_history: { enabled: false } }]) {
    portal.features = { ...portal.features, ...unsafe };
    await assert.rejects(gateway.createPortal("cus_trainerone"), errorCode("PORTAL_NOT_READY"));
    portal.features = { subscription_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" } };
  }
  t.mock.method(gateway.stripe.billingPortal.configurations, "list", async () => ({ data: [] }));
  await assert.rejects(gateway.createPortal("cus_trainerone"), errorCode("PORTAL_NOT_READY"));
});

const previewLine = (kind, tier, interval, amount, { proration = true, quantity = 1, start = START + 15 * 86400, end = END } = {}) => ({
  amount, quantity, period: { start, end }, pricing: { price_details: { price: priceId(kind, tier, interval) } },
  parent: { type: "subscription_item_details", subscription_item_details: { proration, subscription_item: "si_x" } } });

test("una subida inmediata cobra la diferencia de Stripe, con IVA y saldo, y la renovación se previsualiza aparte", async (t) => {
  const { gateway } = fixture(t);
  const requests = [];
  t.mock.method(gateway.stripe.invoices, "createPreview", async (params) => {
    requests.push(params);
    if (params.subscription_details.proration_behavior === "none") {
      return { livemode: false, currency: "eur", amount_due: 5929, lines: { has_more: false, data: [] } };
    }
    return { livemode: false, currency: "eur", amount_due: 1210, ending_balance: -50, total_taxes: [{ amount: 210 }], lines: { has_more: false,
      data: [previewLine("base", "starter", "monthly", -1450), previewLine("base", "professional", "monthly", 2450)] } };
  });
  const sub = subscription(state("starter"), { currentPeriodEnd: END });
  const preview = await gateway.previewChange(sub, state("professional"), "immediate", START + 15 * 86400);
  assert.deepEqual(requests.map((entry) => entry.subscription_details.proration_behavior), ["always_invoice", "none"]);
  assert.equal(preview.amountDueNow, 1210);
  assert.equal(preview.taxAmount, 210);
  assert.equal(preview.creditBalance, 50);
  assert.equal(preview.renewalAmount, 5929);
  assert.equal(preview.renewalAt, END);
  assert.deepEqual(preview.lines.map((entry) => [entry.kind, entry.tier]), [["credit", "starter"], ["charge", "professional"]]);
});

test("una bajada a mensual desde anual no simula ningún cobro: la renovación es la tarifa sin IVA", async (t) => {
  const { gateway } = fixture(t);
  t.mock.method(gateway.stripe.invoices, "createPreview", async () => assert.fail("no se previsualiza un cobro de hoy"));
  const sub = subscription(state("starter", "annual", 5), { currentPeriodEnd: END });
  assert.deepEqual(await gateway.previewChange(sub, state("starter", "monthly", 2), "scheduled", START),
    { amountDueNow: 0, renewalAmount: 2900 + 200, renewalAt: END, creditBalance: 0, renewalExcludesTax: true });
});

test("aplicar: la subida queda pendiente del pago", async (t) => {
  const { gateway } = fixture(t);
  const calls = [];
  t.mock.method(gateway.stripe.subscriptions, "update", async (...args) => { calls.push(args); return { livemode: false, latest_invoice: "in_change" }; });
  const quote = { quoteId: "q1", subscriptionId: "sub_trainers", prorationDate: START + 100, to: stateView(state("professional")),
    updates: [{ id: "si_base", price: priceId("base", "professional", "monthly"), quantity: 1 }] };
  assert.deepEqual(await gateway.applyUpgrade(quote, "change-one"), { invoiceId: "in_change" });
  await gateway.applyUpgrade(quote, "change-one");
  assert.deepEqual(calls[0], calls[1], "mismos parámetros y clave al reintentar");
  assert.deepEqual(calls[0][1], { items: quote.updates, payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice",
    proration_date: START + 100 });
  assert.equal(calls[0][2].idempotencyKey, "change-one");
});

test("una bajada se programa con dos fases: los elementos actuales hasta el fin del periodo y los del destino después", async (t) => {
  const { gateway } = fixture(t);
  const phase = { start_date: START, end_date: END, currency: "eur", collection_method: "charge_automatically", billing_cycle_anchor: null,
    default_payment_method: "pm_saved", default_tax_rates: [{ id: "txr_existing" }], description: null, metadata: {}, add_invoice_items: [],
    discounts: [{ discount: "di_existing", coupon: null, promotion_code: null }], invoice_settings: null, automatic_tax: null,
    items: [{ price: priceId("base", "starter", "monthly"), quantity: 1, discounts: [], tax_rates: [], metadata: {} },
      { price: priceId("seat", "starter", "monthly"), quantity: 8, discounts: [{ discount: "di_item", coupon: null, promotion_code: null }],
        tax_rates: [], metadata: { kept: "yes" } }] };
  const createKeys = [];
  t.mock.method(gateway.stripe.subscriptionSchedules, "create", async (params, options) => {
    assert.deepEqual(params, { from_subscription: "sub_trainers" });
    createKeys.push(options.idempotencyKey);
    return { id: "sub_sched", livemode: false, phases: [structuredClone(phase)] };
  });
  const updates = [];
  t.mock.method(gateway.stripe.subscriptionSchedules, "update", async (...args) => { updates.push(args); return {}; });
  const quote = { quoteId: "q-down", subscriptionId: "sub_trainers", prorationDate: START + 100, periodEnd: END,
    to: stateView(state("free", "monthly", 4)),
    fromItems: [{ price: priceId("seat", "starter", "monthly"), quantity: 8 }, { price: priceId("base", "starter", "monthly"), quantity: 1 }],
    targetItems: [{ price: priceId("seat", "free", "monthly"), quantity: 4 }] };
  assert.deepEqual(await gateway.scheduleChange(quote, "down-one"), { scheduleId: "sub_sched" });
  const [, params, options] = updates[0];
  assert.deepEqual(createKeys, ["down-one-create"]);
  assert.equal(options.idempotencyKey, "down-one-update");
  assert.equal(params.end_behavior, "release");
  assert.equal(params.phases[0].end_date, END);
  assert.deepEqual(params.phases[0].items.map((item) => [item.price, item.quantity]), [[priceId("base", "starter", "monthly"), 1],
    [priceId("seat", "starter", "monthly"), 8]]);
  assert.deepEqual(params.phases[0].items[1].discounts, [{ discount: "di_item" }]);
  assert.deepEqual(params.phases[1].items, [{ price: priceId("seat", "free", "monthly"), quantity: 4 }]);
  assert.equal(params.phases[1].start_date, END);
  assert.equal(params.phases[1].billing_cycle_anchor, "phase_start");
  assert.deepEqual(params.phases[1].discounts, [{ discount: "di_existing" }]);
  assert.equal(params.phases[1].default_payment_method, "pm_saved");
  // Si la fase actual no es la que se propuso, no se programa nada.
  await assert.rejects(gateway.scheduleChange({ ...quote, fromItems: [{ price: priceId("base", "professional", "monthly"), quantity: 1 }] }, "down-two"),
    errorCode("BILLING_REVIEW_REQUIRED"));
});

test("el pago de un cambio solo cuenta si su factura cobra el precio de destino; los enlaces quedan en Stripe", async (t) => {
  const { gateway } = fixture(t);
  const invoice = { livemode: false, customer: "cus_trainerone", billing_reason: "subscription_update", currency: "eur", status: "paid",
    parent: { subscription_details: { subscription: "sub_trainers" } }, hosted_invoice_url: "https://invoice.stripe.com/i/acct/in_change",
    lines: { has_more: false, data: [previewLine("base", "professional", "monthly", 2000, { end: END })] } };
  t.mock.method(gateway.stripe.invoices, "retrieve", async () => structuredClone(invoice));
  const operation = { invoiceId: "in_change", quote: { subscriptionId: "sub_trainers", targetItems: [{ price: priceId("base", "professional", "monthly"), quantity: 1 }] } };
  assert.deepEqual(await gateway.changePayment({ customerId: "cus_trainerone" }, operation),
    { paid: true, voided: false, periodEnd: END, url: "https://invoice.stripe.com/i/acct/in_change" });
  const other = { ...operation, quote: { ...operation.quote, targetItems: [{ price: priceId("base", "scale", "monthly"), quantity: 1 }] } };
  assert.equal((await gateway.changePayment({ customerId: "cus_trainerone" }, other)).paid, false);
  await assert.rejects(gateway.changePayment({ customerId: "cus_someone" }, operation), errorCode("PAYMENT_NOT_OWNED"));
  for (const url of ["https://evil.test/i/one", "http://invoice.stripe.com/i/one", "https://user@invoice.stripe.com/i/one"]) {
    invoice.hosted_invoice_url = url;
    assert.equal((await gateway.changePayment({ customerId: "cus_trainerone" }, operation)).url, undefined);
  }
});

test("deshacer una subida vuelve al estado anterior sin prorrateo: ni factura ni cobro", async (t) => {
  const { gateway } = fixture(t);
  let call;
  t.mock.method(gateway.stripe.subscriptions, "update", async (...args) => { call = args; return { livemode: false }; });
  await gateway.revertState(subscription(state("starter", "annual", 9)), state("starter", "annual", 4), "revert-one");
  assert.deepEqual(call[1], { items: [{ id: "si_seat", price: priceId("seat", "starter", "annual"), quantity: 4 }], proration_behavior: "none" });
  assert.equal(call[2].idempotencyKey, "revert-one");
});

test("sandbox test clocks use expanded simulated time and normal subscriptions need no extra clock request", async (t) => {
  const { gateway } = fixture(t);
  const sub = stripeSub(state("starter"));
  t.mock.method(gateway.stripe.subscriptions, "list", async (params) => {
    assert.ok(params.expand.includes("data.test_clock"));
    return { has_more: false, data: [sub] };
  });
  assert.equal((await gateway.listSubscriptions("cus_trainerone"))[0].billingNow, undefined);
  sub.test_clock = { id: "clock_test", frozen_time: START + 1000, status: "ready", livemode: false };
  assert.equal((await gateway.listSubscriptions("cus_trainerone"))[0].billingNow, START + 1000);
  sub.test_clock.status = "advancing";
  await assert.rejects(gateway.listSubscriptions("cus_trainerone"), errorCode("TEST_CLOCK_NOT_READY"));
});
