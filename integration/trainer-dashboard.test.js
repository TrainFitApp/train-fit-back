const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// El panel del profesional lee lo que hace el cliente en SU app: adherencia y
// seguimiento de nutrición, cartera, resumen de la ficha, alertas y reglas.
// Aquí se comprueba que una acción del cliente cambia lo que ve el
// profesional (y solo el suyo).

const ctx = h.setup();

let pollo;
ctx.before(async () => {
  pollo = await ctx.model("Product").create({ name: "Pollo", energyKcal100g: 165, protein100g: 31, carbohydrates100g: 0, fat100g: 3.6, verified: true });
});

async function clientOnPlan({ startDate = h.day(-3) } = {}) {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  await ctx.post(trainer, `/trainer/clients/${client.id}/diet-phases`, {
    name: "Plan",
    startDate,
    menus: [{ name: "Único", meals: [{ slot: "Comida", alternatives: [{ customProducts: [{ product: String(pollo._id), quantity: 200, energyKcal100g: 165, protein100g: 31, carbohydrates100g: 0, fat100g: 3.6 }] }] }] }],
  });
  return { trainer, client };
}

async function eatPrescribed(client, date) {
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Único" });
  const day = (await ctx.post(client, `/dietdays/date/${date}`, {})).dietDay;
  const comida = day.meals.find((m) => m.name === "Comida");
  for (const cp of comida.customProducts) {
    await ctx.patch(client, `/meals/${comida._id}/customproducts/${cp._id}/consumed`, { consumed: true });
  }
  return comida;
}

test("adherencia: el día que el cliente come lo pautado cuenta como dentro de margen; el que no, fuera", async () => {
  const { trainer, client } = await clientOnPlan();
  const today = h.day(0);
  const yesterday = h.day(-1);
  await eatPrescribed(client, today);
  await ctx.put(client, `/dietdays/date/${yesterday}/menu`, { menuName: "Único" }); // eligió pero no marcó nada

  const adherence = await ctx.get(trainer, `/trainer/clients/${client.id}/adherence?from=${yesterday}&to=${today}`);
  const byDate = Object.fromEntries(adherence.dailyBreakdown.map((d) => [d.date, d]));
  assert.equal(byDate[today].withinMargin, true);
  assert.equal(byDate[today].kcal, 330);
  assert.equal(byDate[yesterday].withinMargin, false);
  assert.equal(byDate[yesterday].kcal, 0);
  assert.equal(adherence.percentage, 50);
});

test("seguimiento y cumplimiento: lo pautado frente a lo marcado como tomado, y el día saltado se ve como tal", async () => {
  const { trainer, client } = await clientOnPlan();
  const today = h.day(0);
  await eatPrescribed(client, today);
  const compliance = await ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-compliance?from=${today}&to=${today}`);
  const day = compliance.dailyBreakdown.find((d) => d.date === today);
  assert.equal(day.hasPlan, true);
  assert.equal(day.completionPercentage, 100);

  const yesterday = h.day(-1);
  await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${yesterday}`);
  await ctx.put(client, `/dietdays/date/${yesterday}/menu`, { menuName: "Único" });
  await ctx.post(trainer, `/trainer/clients/${client.id}/skipped-days`, { date: yesterday });
  const after = await ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-compliance?from=${yesterday}&to=${today}`);
  assert.equal(after.dailyBreakdown.find((d) => d.date === yesterday).skipped, true);
});

test("cartera: solo clientes activos del propio entrenador, con sus pendientes de revisar", async () => {
  const { trainer, client } = await clientOnPlan();
  const revoked = await ctx.makeClient({ name: "Exclient" });
  await ctx.relate(trainer, revoked, { scope: "training", status: "revoked" });
  const othersClient = await ctx.makeClient({ name: "DeOtro" });
  await ctx.relate(await ctx.makeTrainer(), othersClient, { scope: "training" });

  const sched = await ctx.post(trainer, `/trainer/clients/${client.id}/checkin-schedules`, {
    name: "S", startDate: h.day(0), time: "00:00", frequency: "weekly", interval: 1, enabledFields: ["weight"],
  });
  await ctx.post(client, `/trainer/checkins/${sched._id}/respond`, { values: { weight: 80 } });

  const roster = await ctx.get(trainer, "/trainer/roster");
  const ids = roster.clients.map((c) => String(c.clientId || c._id || c.user?._id));
  assert.deepEqual(ids, [client.id]);
  assert.equal(roster.clients[0].pendingCheckins, 1);
});

test("resumen de la ficha: responde para su cliente y 403 para uno ajeno; el progreso de entrenamiento exige scope de entrenamiento", async () => {
  const { trainer, client } = await clientOnPlan();
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/summary`)).status, 200);
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/progress`)).status, 200);
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/training-progress`)).status, 200);
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${stranger.id}/summary`)).status, 403);

  const dietitian = await ctx.makeTrainer();
  const onlyDiet = await ctx.makeClient();
  await ctx.relate(dietitian, onlyDiet, { scope: "nutrition" });
  assert.equal((await ctx.call(dietitian, "GET", `/trainer/clients/${onlyDiet.id}/training-progress`)).status, 403);
});

// Un día solo lleva pauta cuando el cliente elige menú. Los días pasados de
// la fase en los que no lo eligió tienen que contar como no seguidos: antes
// el Resumen decía "sin datos de seguimiento" con la fase semanas asignada.
test("resumen: los días pasados de la fase sin menú elegido cuentan como 0 %, no como «sin datos»", async () => {
  const { trainer, client } = await clientOnPlan({ startDate: h.day(-6) });
  const base = `/trainer/clients/${client.id}`;

  const untouched = (await ctx.get(trainer, `${base}/summary`)).adherence.dimensions.nutrition;
  assert.deepEqual(
    { applicable: untouched.applicable, percentage: untouched.percentage, daysWithData: untouched.daysWithData },
    { applicable: true, percentage: 0, daysWithData: 6 },
    "6 días pasados de fase sin elegir; hoy aún puede elegir"
  );

  await eatPrescribed(client, h.day(-1));
  const summary = await ctx.get(trainer, `${base}/summary`);
  assert.equal(summary.adherence.dimensions.nutrition.percentage, 17, "1 día al 100 % y 5 al 0 %");
  assert.equal(summary.dietPhase.name, "Plan");

  const progress = await ctx.get(trainer, `${base}/progress?weeks=4`);
  assert.ok(progress.series.some((week) => week.nutritionAdherence !== null), "la serie semanal también tiene datos");

  const compliance = await ctx.get(trainer, `${base}/nutrition-compliance?from=${h.day(-6)}&to=${h.day(0)}`);
  const byDate = Object.fromEntries(compliance.dailyBreakdown.map((d) => [d.date, d]));
  assert.deepEqual([byDate[h.day(-6)].hasPlan, byDate[h.day(-6)].completionPercentage], [true, 0]);
  assert.equal(byDate[h.day(-1)].completionPercentage, 100);
  assert.equal(byDate[h.day(0)], undefined, "hoy sin elegir no se juzga");
});

test("bandeja «Por revisar»: el check-in respondido aparece y desaparece al revisarlo", async () => {
  const { trainer, client } = await clientOnPlan();
  const sched = await ctx.post(trainer, `/trainer/clients/${client.id}/checkin-schedules`, {
    name: "S", startDate: h.day(0), time: "00:00", frequency: "weekly", interval: 1, enabledFields: ["weight"],
  });
  const res = await ctx.post(client, `/trainer/checkins/${sched._id}/respond`, { values: { weight: 80 } });
  const countOf = async () => {
    const c = await ctx.get(trainer, "/trainer/review-queue/count");
    return typeof c === "number" ? c : c.count ?? c.total;
  };
  assert.equal(await countOf(), 1);
  const queue = await ctx.get(trainer, "/trainer/review-queue");
  assert.ok(JSON.stringify(queue).includes(String(res._id || res.response?._id)));
  await ctx.post(trainer, `/trainer/clients/${client.id}/checkin-responses/${res._id || res.response?._id}/review`, {});
  assert.equal(await countOf(), 0);
});

test("alertas: se evalúan bajo demanda, se cierran por el propio entrenador y nadie más puede tocarlas", async () => {
  const { trainer, client } = await clientOnPlan();
  await ctx.post(trainer, "/trainer/alerts/evaluate", {});
  const list = await ctx.get(trainer, "/trainer/alerts");
  const alerts = Array.isArray(list) ? list : list.alerts || [];
  const other = await ctx.makeTrainer();
  if (alerts.length) {
    const alert = alerts[0];
    assert.equal(String(alert.clientId?._id || alert.clientId), client.id);
    assert.equal((await ctx.call(other, "PATCH", `/trainer/alerts/${alert._id}`, { status: "resolved" })).status, 404);
    assert.equal((await ctx.call(trainer, "PATCH", `/trainer/alerts/${alert._id}`, { status: "borrada" })).status, 400);
    const closed = await ctx.patch(trainer, `/trainer/alerts/${alert._id}`, { status: "dismissed", coachNote: "  visto  " });
    assert.equal(closed.status, "dismissed");
  }
  const otherList = await ctx.get(other, "/trainer/alerts");
  assert.equal((Array.isArray(otherList) ? otherList : otherList.alerts || []).length, 0);
});

test("reglas del coach: validación, solo clientes propios y CRUD solo sobre las suyas", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "nutrition" });
  const valid = {
    name: "Baja adherencia",
    conditions: [{ metric: "nutrition_adherence", operator: "lt", value: 60 }],
    actions: [{ type: "create_alert", message: "Revisar dieta" }],
    appliesTo: "selected",
    clientIds: [client.id],
  };
  for (const bad of [
    { ...valid, name: "" },
    { ...valid, conditions: [] },
    { ...valid, conditions: [{ metric: "humor", operator: "lt", value: 1 }] },
    { ...valid, conditions: [{ metric: "nutrition_adherence", operator: "dropped_more_than_pct", value: 1 }] },
    { ...valid, conditions: [{ metric: "nutrition_adherence", operator: "lt", value: "60" }] },
    { ...valid, actions: [{ type: "notify", message: "x" }] },
    { ...valid, clientIds: [String(ctx.oid())] },
  ]) {
    const res = await ctx.call(trainer, "POST", "/trainer/rules", bad);
    assert.ok([400, 403].includes(res.status), `${res.status} ${JSON.stringify(bad).slice(0, 120)}`);
  }
  assert.equal(await ctx.count("CoachRule", { trainerId: trainer._id }), 0, "ninguna regla inválida llega a guardarse");
  const rule = await ctx.post(trainer, "/trainer/rules", valid);
  const other = await ctx.makeTrainer();
  assert.ok([403, 404].includes((await ctx.call(other, "PUT", `/trainer/rules/${rule._id}`, valid)).status));
  assert.ok([403, 404].includes((await ctx.call(other, "DELETE", `/trainer/rules/${rule._id}`)).status));
  assert.equal((await ctx.get(other, "/trainer/rules")).length, 0);
  await ctx.patch(trainer, `/trainer/rules/${rule._id}/toggle`, { enabled: false });
  assert.equal((await ctx.get(trainer, "/trainer/rules"))[0].enabled, false);
  await ctx.call(trainer, "DELETE", `/trainer/rules/${rule._id}`);
  assert.equal((await ctx.get(trainer, "/trainer/rules")).length, 0);
});

test("notas internas del entrenador sobre el cliente: privadas de cada entrenador", async () => {
  const { trainer, client } = await clientOnPlan();
  const created = await ctx.post(trainer, `/trainer/clients/${client.id}/notes`, { text: "Prefiere entrenar por la mañana" });
  const other = await ctx.makeTrainer();
  await ctx.relate(other, client, { scope: "training", status: "revoked" });
  assert.equal((await ctx.call(other, "GET", `/trainer/clients/${client.id}/notes`)).status, 403);
  const listed = await ctx.get(trainer, `/trainer/clients/${client.id}/notes`);
  assert.ok(JSON.stringify(listed).includes("Prefiere entrenar por la mañana"));
  const noteId = created._id || created.note?._id;
  await ctx.patch(trainer, `/trainer/clients/${client.id}/notes/${noteId}`, { text: "Mañanas y fines de semana" });
  assert.ok(JSON.stringify(await ctx.get(trainer, `/trainer/clients/${client.id}/notes`)).includes("fines de semana"));
  await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/notes/${noteId}`);
  assert.ok(!JSON.stringify(await ctx.get(trainer, `/trainer/clients/${client.id}/notes`)).includes("fines de semana"));
});

// QA 2026-10-09 (M9): la evaluación de alertas valía el día entero. Una
// regla creada hoy, o un dolor apuntado después de la primera visita del
// día, no saltaba hasta mañana salvo con «Revisar ahora».
test("alertas: una regla nueva y un dato posterior del cliente saltan en la siguiente lectura, sin esperar a mañana", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const alertsOf = async () => {
    const list = await ctx.get(trainer, "/trainer/alerts");
    return (Array.isArray(list) ? list : list.alerts || []).filter((alert) => String(alert.clientId?._id || alert.clientId) === client.id);
  };

  // Primera visita del día: se evalúa y no hay nada.
  assert.equal((await alertsOf()).length, 0);

  // El cliente apunta un dolor fuerte DESPUÉS de esa visita…
  await ctx.put(client, "/pain/mine", { zone: "Cuello", level: 7 });
  // …y el profesional crea ahora la regla.
  await ctx.post(trainer, "/trainer/rules", {
    name: "Dolor fuerte",
    conditions: [{ metric: "pain_max", operator: "gt", value: 6, periodDays: 7 }],
    actions: [{ type: "create_alert", message: "Revisar el dolor" }],
    appliesTo: "selected",
    clientIds: [client.id],
  });

  const fromRule = (await alertsOf()).filter((alert) => alert.type === "rule_matched");
  assert.equal(fromRule.length, 1, JSON.stringify(fromRule));
  assert.match(JSON.stringify(fromRule[0]), /Dolor fuerte|Revisar el dolor/);
});

test("alertas: un dolor nuevo invalida la evaluación del día de su profesional", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  await ctx.post(trainer, "/trainer/rules", {
    name: "Dolor fuerte 2",
    conditions: [{ metric: "pain_max", operator: "gt", value: 6, periodDays: 7 }],
    actions: [{ type: "create_alert", message: "Revisar el dolor" }],
    appliesTo: "selected",
    clientIds: [client.id],
  });
  const count = async () => {
    const list = await ctx.get(trainer, "/trainer/alerts");
    return (Array.isArray(list) ? list : list.alerts || []).filter((alert) => alert.type === "rule_matched").length;
  };
  assert.equal(await count(), 0, "evaluado hoy, sin dolor");
  await ctx.put(client, "/pain/mine", { zone: "Cuello", level: 8 });
  assert.equal(await count(), 1, "el dolor de después salta en la siguiente lectura");
});

// QA 2026-10-09 (M10): sin una regla de dolor creada, un 7/10 no salía en
// ningún sitio. Ahora es una señal integrada con el umbral de su zona.
test("alertas: un dolor fuerte salta sin regla, con el umbral que fijó el profesional para esa zona", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  const painAlerts = async () => {
    const list = await ctx.get(trainer, "/trainer/alerts");
    return (Array.isArray(list) ? list : list.alerts || []).filter((alert) => alert.type === "pain_high");
  };

  await ctx.put(client, "/pain/mine", { zone: "Cuello", level: 5 });
  assert.equal((await painAlerts()).length, 0, "un 5 no pasa del umbral por defecto (7)");

  // El profesional fija que en el cuello hay que parar a partir de 5.
  const thresholds = await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/pain/thresholds`, { zone: "Cuello", workLevel: 3, painLevel: 5 });
  assert.ok(thresholds.status < 300, JSON.stringify(thresholds.body));
  const [alert] = await painAlerts();
  assert.ok(alert, "con su umbral, el 5 ya avisa");
  assert.equal(alert.priority, "high");
  assert.equal(alert.context.zone, "Cuello");

  // Otro profesional no lo ve.
  const other = await ctx.makeTrainer();
  const otherList = await ctx.get(other, "/trainer/alerts");
  assert.equal((Array.isArray(otherList) ? otherList : otherList.alerts || []).length, 0);
});
