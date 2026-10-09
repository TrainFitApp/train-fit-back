const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Coach del cliente, en modales: "Tus planes" (rutina y dieta de hoy, las
// programadas y las anteriores) y "Tus profesionales" (desde cuándo trabaja
// con cada uno y lo que le cobra). Solo lectura y solo de sus propias
// relaciones: un cobro nunca enseña notas ni métodos de pago.

const ctx = h.setup();

async function pair() {
  const trainer = await ctx.makeTrainer({ name: "Coach" });
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  return { trainer, client };
}

let opSeq = 0;
const op = (label) => `op-${label}-${Date.now()}-${++opSeq}`;
const paymentsPath = (client) => `/trainer/payments/clients/${client.id}`;

test("tus planes: rutina y dieta de hoy, las programadas y las anteriores, con su profesional", async () => {
  const { trainer, client } = await pair();
  const routine = async (name, startDate) => {
    const { table } = await ctx.seedTable({ owner: client, name, assignedBy: trainer });
    await ctx.model("RoutineAssignment").create({ tableId: table._id, clientId: client._id, trainerId: trainer._id, startDate });
    return table;
  };
  await routine("Fuerza base", h.day(-60));
  await routine("Hipertrofia", h.day(-10));
  await routine("Descarga", h.day(20));

  const diet = (name, startDate) =>
    ctx.post(trainer, `/trainer/clients/${client.id}/diet-phases`, { name, startDate, menus: [{ name: "Único", meals: [] }] });
  await diet("Volumen", h.day(-30));
  await diet("Definición", h.day(-5));
  // La app no deja programar detrás de una fase sin fin: se siembra a mano.
  await ctx.model("DietPhase").create({
    clientId: client._id,
    trainerId: trainer._id,
    name: "Mantenimiento",
    startDate: h.day(15),
    contents: [{ startDate: h.day(15), menus: [] }],
  });

  const plans = await ctx.get(client, "/coach/plans");

  assert.equal(plans.training.current.name, "Hipertrofia");
  assert.equal(plans.training.current.status, "active");
  assert.equal(plans.training.current.startDate, h.day(-10));
  assert.equal(plans.training.current.endDate, h.day(19), "acaba la víspera de la siguiente");
  assert.equal(plans.training.current.trainerName, "Coach Test");
  assert.deepEqual(plans.training.upcoming.map((p) => p.name), ["Descarga"]);
  assert.deepEqual(plans.training.past.map((p) => p.name), ["Fuerza base"]);

  assert.equal(plans.nutrition.current.name, "Definición");
  assert.deepEqual(plans.nutrition.upcoming.map((p) => p.name), ["Mantenimiento"]);
  assert.deepEqual(plans.nutrition.past.map((p) => [p.name, p.endDate]), [["Volumen", h.day(-6)]]);
  assert.equal(plans.nutrition.past[0].trainerName, "Coach Test");

  // El dashboard sigue diciendo lo mismo de hoy.
  const dashboard = await ctx.get(client, "/coach/dashboard");
  assert.equal(dashboard.currentPlans.training.name, "Hipertrofia");
  assert.equal(dashboard.currentPlans.nutrition.name, "Definición");
});

test("tus planes: lo de un profesional que ya no está no es el plan de hoy, pero queda en el historial", async () => {
  const { trainer, client } = await pair();
  const { table } = await ctx.seedTable({ owner: client, name: "Rutina antigua", assignedBy: trainer });
  await ctx.model("RoutineAssignment").create({ tableId: table._id, clientId: client._id, trainerId: trainer._id, startDate: h.day(-20) });
  await ctx.endRelation(trainer, client);

  const plans = await ctx.get(client, "/coach/plans");
  assert.equal(plans.training.current, null);
  assert.deepEqual(plans.training.past.map((p) => [p.name, p.trainerName]), [["Rutina antigua", "Coach Test"]]);

  const stranger = await ctx.makeClient();
  const empty = await ctx.get(stranger, "/coach/plans");
  assert.deepEqual(empty.training, { current: null, upcoming: [], past: [] });
  assert.deepEqual(empty.nutrition, { current: null, upcoming: [], past: [] });
});

test("tus profesionales: /trainer/info dice desde cuándo trabajáis juntos", async () => {
  const { trainer, client } = await pair();
  const [pro] = await ctx.get(client, "/trainer/info");
  assert.equal(String(pro.user._id), trainer.id);
  assert.ok(pro.since && !Number.isNaN(new Date(pro.since).getTime()), JSON.stringify(pro));
});

test("cobros del profesional: el cliente ve cobros, saldo y pagos, sin notas ni método", async () => {
  const { trainer, client } = await pair();
  const charge = await ctx.post(trainer, `${paymentsPath(client)}/charges`, {
    amount: 60,
    dueDay: h.day(-3),
    concept: "Asesoría octubre",
    note: "Nota solo del entrenador",
    operationId: op("create"),
    confirmPastDue: true,
  });
  const chargeId = charge.charge?.id || charge.id;
  assert.ok(chargeId, JSON.stringify(charge).slice(0, 300));
  await ctx.post(trainer, `${paymentsPath(client)}/charges/${chargeId}/payments`, {
    amount: 20,
    receivedDay: h.day(-1),
    method: "bizum",
    note: "Le faltaba cambio",
    operationId: op("pay"),
  });

  const view = await ctx.get(client, `/coach/professionals/${trainer.id}/payments`);
  const json = JSON.stringify(view);
  for (const secret of ["Nota solo del entrenador", "Le faltaba cambio", "bizum"]) {
    assert.ok(!json.includes(secret), `no debe salir «${secret}»`);
  }
  assert.equal(view.charges.length, 1);
  assert.equal(view.charges[0].concept, "Asesoría octubre");
  assert.equal(view.charges[0].amountCents, 6000);
  assert.equal(view.charges[0].balanceCents, 4000);
  assert.equal(view.charges[0].temporal, "overdue");
  assert.deepEqual(view.charges[0].payments.map((p) => [p.amountCents, p.receivedDay]), [[2000, h.day(-1)]]);
  assert.equal(view.summary.pendingCents, 4000);
});

test("cobros del profesional: solo de un profesional con el que trabaja ahora y solo para el propio cliente", async () => {
  const { trainer, client } = await pair();
  const stranger = await ctx.makeClient();

  assert.equal((await ctx.call(stranger, "GET", `/coach/professionals/${trainer.id}/payments`)).status, 404);
  assert.equal((await ctx.call(client, "GET", "/coach/professionals/no-es-un-id/payments")).status, 404);
  assert.equal((await ctx.call(trainer, "GET", `/coach/professionals/${trainer.id}/payments`)).status, 403);
  assert.equal((await ctx.call(client, "GET", `/coach/professionals/${trainer.id}/payments`)).status, 200);

  await ctx.endRelation(trainer, client);
  assert.equal((await ctx.call(client, "GET", `/coach/professionals/${trainer.id}/payments`)).status, 404);
});
