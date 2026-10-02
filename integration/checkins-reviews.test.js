const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Check-ins: el profesional programa, el cliente responde en su ventana, las
// medidas viajan a Anthropometry (sin ensuciar lo que el cliente apuntó), y
// la revisión se ve en los dos lados: bandeja «Por revisar», contador de no
// vistos, avisos y el historial del cliente.

const ctx = h.setup();

async function pair() {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  return { trainer, client };
}

async function schedule(trainer, client, extra = {}) {
  const res = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/checkin-schedules`, {
    name: "Semanal",
    startDate: h.day(0),
    time: "00:00",
    frequency: "weekly",
    interval: 1,
    enabledFields: ["weight", "perimeter_waist", "stress_level", "comment"],
    ...extra,
  });
  assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
  return res.body;
}

const respond = (client, scheduleId, values) => ctx.call(client, "POST", `/trainer/checkins/${scheduleId}/respond`, { values });
const typesOf = (list) => (Array.isArray(list) ? list : list.notifications || []).map((n) => n.type);

test("programar: valida fechas, hora, frecuencia, campos del catálogo y que haya al menos una pregunta", async () => {
  const { trainer, client } = await pair();
  const base = { name: "X", startDate: h.day(0), time: "09:00", frequency: "weekly", interval: 1, enabledFields: ["weight"] };
  const bad = [
    { ...base, startDate: "2026-02-30" },
    { ...base, time: "25:00" },
    { ...base, frequency: "hourly" },
    { ...base, interval: 0 },
    { ...base, interval: 53 },
    { ...base, name: "  " },
    { ...base, enabledFields: ["no_existe"] },
    { ...base, enabledFields: [] },
  ];
  for (const body of bad) {
    assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/checkin-schedules`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(await ctx.count("CheckinSchedule", { clientId: client._id }), 0);
  // Cliente ajeno: 403.
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${stranger.id}/checkin-schedules`, base)).status, 403);
});

test("el cliente ve el check-in abierto con los datos del profesional y lo responde; el profesional lo ve por revisar", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  const mine = await ctx.get(client, "/trainer/checkins/mine");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].trainerId, trainer.id);

  const res = await respond(client, sched._id, { weight: 81.2, perimeter_waist: 88, stress_level: 2, comment: "  Semana dura  " });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const responses = await ctx.get(trainer, `/trainer/clients/${client.id}/checkin-responses`);
  const list = Array.isArray(responses) ? responses : responses.responses || [];
  assert.equal(list.length, 1);
  assert.equal(list[0].values.comment, "Semana dura", "se recorta");

  const queue = await ctx.get(trainer, "/trainer/review-queue/count");
  assert.ok(JSON.stringify(queue).match(/[1-9]/), JSON.stringify(queue));
  assert.ok(typesOf(await ctx.get(trainer, "/trainer/notifications/mine")).includes("checkin_responded"));
  const unseen = await ctx.get(trainer, "/trainer/checkins/unseen-count");
  assert.ok(JSON.stringify(unseen).match(/[1-9]/), JSON.stringify(unseen));
});

test("responder: valida cada respuesta contra el catálogo (rango, escala, campos que no son del check-in)", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  const bad = [
    {},
    { weight: 5 },
    { weight: 900 },
    { stress_level: 9 },
    { stress_level: 2.5 },
    { comment: "" },
    { body_fat_secret: 3 },
    { sleep_hours: 7 },
  ];
  for (const values of bad) {
    const res = await respond(client, sched._id, values);
    assert.equal(res.status, 400, JSON.stringify(values));
  }
  assert.equal(await ctx.count("CheckinResponse", { clientId: client._id }), 0);
});

test("las medidas del check-in llegan a la ficha del profesional, NO a las pantallas propias del cliente, y no pisan lo que él apuntó", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  // El cliente ya había apuntado su cintura hoy.
  await ctx.model("Anthropometry").create({ userId: client._id, date: h.day(0), waist: 90 });
  await respond(client, sched._id, { weight: 79.5, perimeter_waist: 87 });

  const stored = await ctx.model("Anthropometry").find({ userId: client._id, date: h.day(0) }).lean();
  assert.equal(stored.length, 1, "un documento por día");
  assert.equal(stored[0].waist, 90, "lo del cliente manda");

  const trainerView = await ctx.get(trainer, `/trainer/clients/${client.id}/anthropometry`);
  assert.ok(JSON.stringify(trainerView).includes("79.5"), "el profesional ve el peso del check-in");

  const clientDay = await ctx.post(client, "/dietdays/date/x", { date: h.day(0) });
  assert.notEqual(clientDay.anthropometry?.weight, 79.5, "el peso del check-in no aparece como apuntado por el cliente");
});

test("reescribir la respuesta dentro de la ventana la actualiza (200) y vuelve a estar pendiente de revisar", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  const first = await respond(client, sched._id, { weight: 80, comment: "uno" });
  const responseId = first.body._id || first.body.response?._id;
  await ctx.post(trainer, `/trainer/clients/${client.id}/checkin-responses/${responseId}/review`, { comment: "ok" });
  const again = await respond(client, sched._id, { weight: 79.8, comment: "corrijo" });
  assert.equal(again.status, 200);
  const stored = await ctx.model("CheckinResponse").findById(responseId).lean();
  assert.equal(stored.status, "responded");
  assert.equal(stored.reviewedAt, null);
  assert.equal(await ctx.count("CheckinResponse", { scheduleId: sched._id }), 1, "una respuesta por ocurrencia");
});

test("revisar: el cliente recibe el aviso y lo ve en su historial; otro entrenador no puede revisarlo", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  const res = await respond(client, sched._id, { weight: 80 });
  const responseId = res.body._id || res.body.response?._id;
  const other = await ctx.makeTrainer();
  await ctx.relate(other, client, { scope: "training", status: "revoked" });
  assert.equal((await ctx.call(other, "POST", `/trainer/clients/${client.id}/checkin-responses/${responseId}/review`, {})).status, 403);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/checkin-responses/${responseId}/review`, { comment: "x".repeat(2001) })).status, 400);

  const reviewed = await ctx.post(trainer, `/trainer/clients/${client.id}/checkin-responses/${responseId}/review`, { comment: "  Bien  " });
  assert.equal(reviewed.reviewComment, "Bien");
  assert.ok(typesOf(await ctx.get(client, "/notifications/mine")).includes("checkin_reviewed"));
  const history = await ctx.get(client, "/trainer/checkins/mine/history");
  assert.equal(history[0].reviewComment, "Bien");
  assert.equal(history[0].trainer?.name, trainer.name);
});

test("un check-in de un profesional con quien ya no hay relación no se puede responder", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  await ctx.model("TrainerClient").updateMany({ trainerId: trainer._id, clientId: client._id }, { $set: { status: "revoked" } });
  assert.equal((await respond(client, sched._id, { weight: 80 })).status, 403);
  assert.deepEqual(await ctx.get(client, "/trainer/checkins/mine"), []);
});

test("un check-in que aún no ha empezado o de otro cliente: no se puede responder", async () => {
  const { trainer, client } = await pair();
  const future = await schedule(trainer, client, { startDate: h.day(3) });
  const notYet = await respond(client, future._id, { weight: 80 });
  assert.equal(notYet.status, 409);
  assert.equal(notYet.body.code, "CHECKIN_CLOSED");
  const other = await ctx.makeClient();
  assert.equal((await respond(other, future._id, { weight: 80 })).status, 404);
});

test("desactivar o borrar la programación: deja de aparecerle al cliente", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  await ctx.patch(trainer, `/trainer/clients/${client.id}/checkin-schedules/${sched._id}/active`, { active: false });
  assert.deepEqual(await ctx.get(client, "/trainer/checkins/mine"), []);
  await ctx.patch(trainer, `/trainer/clients/${client.id}/checkin-schedules/${sched._id}/active`, { active: true });
  assert.equal((await ctx.get(client, "/trainer/checkins/mine")).length, 1);
  await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/checkin-schedules/${sched._id}`);
  assert.deepEqual(await ctx.get(client, "/trainer/checkins/mine"), []);
});

test("editar la programación con una revisión vieja: 409 (no pisa cambios de otra pestaña)", async () => {
  const { trainer, client } = await pair();
  const sched = await schedule(trainer, client);
  const body = { name: "Renombrado", startDate: h.day(0), time: "08:00", frequency: "weekly", interval: 2, enabledFields: ["weight"], revision: sched.revision };
  const ok = await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/checkin-schedules/${sched._id}`, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const stale = await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/checkin-schedules/${sched._id}`, { ...body, name: "Otra" });
  assert.equal(stale.status, 409);
  assert.equal((await ctx.model("CheckinSchedule").findById(sched._id).lean()).name, "Renombrado");
});

test("plantillas de check-in: nombre único por entrenador, campos del catálogo, aplicar a varios clientes", async () => {
  const { trainer, client } = await pair();
  const second = await ctx.makeClient();
  await ctx.relate(trainer, second, { scope: "nutrition" });
  const def = await ctx.post(trainer, "/trainer/checkin-templates", { name: "Revisión mensual", enabledFields: ["weight", "fat_mass"] });
  const dup = await ctx.call(trainer, "POST", "/trainer/checkin-templates", { name: "Revisión mensual", enabledFields: ["weight"] });
  assert.equal(dup.status, 409);
  assert.equal((await ctx.call(trainer, "POST", "/trainer/checkin-templates", { name: "Mala", enabledFields: ["inventado"] })).status, 400);

  const applied = await ctx.call(trainer, "POST", `/trainer/checkin-templates/${def._id}/apply`, {
    clientIds: [client.id, second.id],
    startDate: h.day(0),
    time: "07:00",
    frequency: "monthly",
    interval: 1,
  });
  assert.ok([200, 201].includes(applied.status), JSON.stringify(applied.body));
  assert.equal(await ctx.count("CheckinSchedule", { trainerId: trainer._id, sourceTemplateId: def._id }), 2);
  // Editar la plantilla después no cambia las programaciones ya creadas.
  await ctx.put(trainer, `/trainer/checkin-templates/${def._id}`, { name: "Revisión mensual", enabledFields: ["weight"] });
  const sched = await ctx.model("CheckinSchedule").findOne({ clientId: client._id, sourceTemplateId: def._id }).lean();
  assert.deepEqual(sched.enabledFields, ["weight", "fat_mass"]);
});
