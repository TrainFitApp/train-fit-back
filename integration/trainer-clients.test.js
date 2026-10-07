const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Relación profesional ↔ cliente: invitar, aceptar, rechazar, cancelar,
// revocar por cada lado, solapes de scope, límites de plan y plazas en solo
// lectura, y el cuestionario de alta. Cada paso tiene que verse igual desde
// las DOS apps (lo que hace el entrenador lo ve el cliente y al revés).

const ctx = h.setup();

const invite = (trainer, client, scopes = ["training", "nutrition"]) =>
  ctx.call(trainer, "POST", "/trainer/invites", { clientEmail: client.email ?? client, scopes });

// El cliente responde por profesional: un solo aceptar para todos sus scopes.
const respond = (client, trainer, decision) => ctx.call(client, "POST", `/trainer/invites/${trainer._id}/${decision}`);

async function inviteAndAccept(trainer, client, scopes = ["training", "nutrition"]) {
  const res = await invite(trainer, client, scopes);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  for (const r of res.body.results) assert.equal(r.success, true, JSON.stringify(r));
  const accepted = await respond(client, trainer, "accept");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return res.body.results.map((r) => r.invitation);
}

const trainerNotifications = async (trainer) => ctx.get(trainer, "/trainer/notifications/mine");
const clientNotifications = async (client) => ctx.get(client, "/notifications/mine");
const typesOf = (list) => (Array.isArray(list) ? list : list.notifications || list.items || []).map((n) => n.type);

// --- Invitar y aceptar -------------------------------------------------------------

test("flujo completo: invitar dos scopes, el cliente ve UNA invitación con datos del entrenador, acepta una vez y ambos lo ven", async () => {
  const trainer = await ctx.makeTrainer({ name: "Marta" });
  const client = await ctx.makeClient({ name: "Pablo" });

  const res = await invite(trainer, client);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.results.map((r) => [r.scope, r.success]), [["training", true], ["nutrition", true]]);

  const pending = await ctx.get(client, "/trainer/invites/mine");
  assert.equal(pending.length, 1, "una invitación por profesional");
  assert.deepEqual(pending[0].scopes, ["training", "nutrition"]);
  assert.equal(pending[0].trainer?.name, "Marta", "el cliente ve quién le invita");

  const sent = await ctx.get(trainer, "/trainer/invites");
  assert.equal(sent.filter((i) => i.status === "pending").length, 2);

  const accepted = await respond(client, trainer, "accept");
  assert.deepEqual(accepted.body, { trainerId: String(trainer._id), scopes: ["training", "nutrition"], pending: [] });

  const clients = await ctx.get(trainer, "/trainer/clients");
  assert.equal(clients.length, 1, "un cliente con dos scopes cuenta como uno");
  const professionals = await ctx.get(client, "/trainer/info");
  assert.equal(professionals.length, 1);
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id }), 1, "un documento por par");
  const pair = await ctx.pairOf(trainer, client);
  assert.deepEqual(pair.scopes.map((link) => [link.scope, link.status]), [["training", "active"], ["nutrition", "active"]]);
  assert.equal(pair.intakePending, true, "el cuestionario queda pendiente al aceptar");
  assert.deepEqual(await ctx.get(client, "/trainer/invites/mine"), [], "ya no quedan invitaciones pendientes");
  assert.equal(typesOf(await trainerNotifications(trainer)).filter((t) => t === "invite_accepted").length, 1, "un solo aviso");
});

test("el email de la invitación se normaliza (mayúsculas/espacios) y la invitación llega igual", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient({ email: "cliente.normaliza@example.test" });
  const res = await invite(trainer, "  Cliente.NORMALIZA@Example.test ", ["training"]);
  assert.equal(res.status, 201);
  assert.equal((await ctx.get(client, "/trainer/invites/mine")).length, 1);
});

test("invitar a alguien sin cuenta todavía: queda pendiente y la acepta al registrarse con ese email", async () => {
  const trainer = await ctx.makeTrainer();
  const email = `futuro.${Date.now()}@example.test`;
  assert.equal((await invite(trainer, email, ["nutrition"])).status, 201);
  const client = await ctx.makeClient({ email });
  const [pending] = await ctx.get(client, "/trainer/invites/mine");
  assert.deepEqual(pending.scopes, ["nutrition"]);
  await ctx.post(client, `/trainer/invites/${pending.trainerId}/accept`);
  assert.equal(await ctx.count("TrainerClient", { clientId: client._id, "scopes.status": "active" }), 1);
});

test("no se puede invitar a una cuenta de profesional (NOT_A_USER_ACCOUNT)", async () => {
  const trainer = await ctx.makeTrainer();
  const other = await ctx.makeTrainer();
  const res = await invite(trainer, other, ["training"]);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "NOT_A_USER_ACCOUNT");
});

test("invitarse a sí mismo o sin scope válido: 400 con mensaje (no 500)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  assert.equal((await ctx.call(trainer, "POST", "/trainer/invites", { clientEmail: trainer.email, scopes: ["training"] })).status, 400);
  assert.equal((await ctx.call(trainer, "POST", "/trainer/invites", { clientEmail: client.email, scopes: ["yoga"] })).status, 400);
});

test("invitación duplicada pendiente del mismo scope: no se crea otra", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await invite(trainer, client, ["training"]);
  const again = await invite(trainer, client, ["training"]);
  assert.equal(again.status, 400);
  assert.equal(again.body.results[0].success, false);
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id, clientEmail: client.email }), 1);
  assert.equal((await ctx.model("TrainerClient").findOne({ trainerId: trainer._id }).lean()).scopes.length, 1);
});

test("solape: un cliente no puede tener dos profesionales activos del mismo scope (al invitar ni al aceptar)", async () => {
  const a = await ctx.makeTrainer({ name: "A" });
  const b = await ctx.makeTrainer({ name: "B" });
  const client = await ctx.makeClient();

  // B invita ANTES de que el cliente acepte a A.
  await invite(b, client, ["training"]);
  await inviteAndAccept(a, client, ["training"]);

  const lateAccept = await respond(client, b, "accept");
  assert.equal(lateAccept.status, 400);
  assert.equal(lateAccept.body.code, "OVERLAP");

  const newInvite = await invite(b, client, ["training", "nutrition"]);
  assert.equal(newInvite.status, 201, "nutrición sí");
  const byScope = Object.fromEntries(newInvite.body.results.map((r) => [r.scope, r.success]));
  assert.deepEqual(byScope, { training: false, nutrition: true });

  // Aceptar a B acepta lo que se puede; entrenamiento sigue sin responder.
  const partial = await respond(client, b, "accept");
  assert.deepEqual([partial.body.scopes, partial.body.pending], [["nutrition"], ["training"]]);
});

test("aceptar una invitación que no es para mí o de quien no me invitó: 404; aceptar dos veces es idempotente", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const intruder = await ctx.makeClient();
  await invite(trainer, client, ["training"]);
  assert.equal((await respond(intruder, trainer, "accept")).status, 404);
  assert.equal((await ctx.call(client, "POST", `/trainer/invites/${ctx.oid()}/accept`)).status, 404);
  assert.equal((await ctx.call(client, "POST", "/trainer/invites/no-es-un-id/accept")).status, 404);
  await respond(client, trainer, "accept");
  const again = await respond(client, trainer, "accept");
  assert.deepEqual([again.status, again.body.scopes], [200, []]);
  assert.equal((await ctx.pairOf(trainer, client)).scopes[0].status, "active");
  assert.equal(typesOf(await trainerNotifications(trainer)).filter((t) => t === "invite_accepted").length, 1, "un solo aviso");
});

test("rechazar: la invitación queda 'declined' y el entrenador puede volver a invitar", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await invite(trainer, client, ["nutrition"]);
  const declined = await respond(client, trainer, "decline");
  assert.deepEqual(declined.body.scopes, ["nutrition"]);
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id, "scopes.status": "declined" }), 1);
  assert.deepEqual(await ctx.get(client, "/trainer/invites/mine"), []);
  assert.equal((await invite(trainer, client, ["nutrition"])).status, 201);
});

test("rechazar y volver a invitar: la misma persona sigue siendo un solo par, con su historial", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const [first] = (await invite(trainer, client, ["nutrition"])).body.results.map((r) => r.invitation);
  await respond(client, trainer, "decline");
  const [second] = (await invite(trainer, client, ["nutrition"])).body.results.map((r) => r.invitation);
  assert.notEqual(String(second._id), String(first._id), "cada invitación tiene su id");
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id }), 1);
  await respond(client, trainer, "accept");
  const history = await ctx.get(client, "/trainer/history?asClient=1");
  assert.deepEqual(history.map((r) => r.status), ["declined"], "el rechazo queda en su historial");
  assert.equal((await ctx.get(trainer, "/trainer/history")).length, 1);
});

test("cancelar invitación: solo su entrenador; queda rechazada y desaparece de las pendientes del cliente", async () => {
  const trainer = await ctx.makeTrainer();
  const other = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const [relation] = (await invite(trainer, client, ["training"])).body.results.map((r) => r.invitation);
  assert.equal((await ctx.call(other, "DELETE", `/trainer/invites/${relation._id}`)).status, 404);
  const cancelled = await ctx.del(trainer, `/trainer/invites/${relation._id}`);
  assert.equal(cancelled.status, "declined");
  assert.deepEqual(await ctx.get(client, "/trainer/invites/mine"), []);
  // Cancelar una relación ya activa no la rompe (idempotente sobre estados terminales).
  const [active] = await inviteAndAccept(trainer, client, ["nutrition"]);
  assert.equal((await ctx.del(trainer, `/trainer/invites/${active._id}`)).status, "active");
});

// --- Límites del plan y plazas -----------------------------------------------------

test("plan free del entrenador: 3 clientes; el 4º da TRAINER_LIMIT_REACHED; el mismo cliente en otro scope no cuenta doble", async () => {
  const trainer = await ctx.makeTrainer();
  const clients = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await ctx.makeClient();
    clients.push(c);
    assert.equal((await invite(trainer, c, ["training"])).status, 201);
  }
  assert.equal((await invite(trainer, clients[0], ["nutrition"])).status, 201, "mismo cliente, otro scope");
  const fourth = await invite(trainer, await ctx.makeClient(), ["training"]);
  assert.equal(fourth.status, 403);
  assert.equal(fourth.body.code, "TRAINER_LIMIT_REACHED");
});

test("las invitaciones canceladas o rechazadas liberan plaza", async () => {
  const trainer = await ctx.makeTrainer();
  const relations = [];
  for (let i = 0; i < 3; i += 1) relations.push((await invite(trainer, await ctx.makeClient(), ["training"])).body.results[0].invitation);
  await ctx.del(trainer, `/trainer/invites/${relations[0]._id}`);
  assert.equal((await invite(trainer, await ctx.makeClient(), ["training"])).status, 201);
});

test("las plazas contratadas mandan: Free con 2 plazas adicionales admite 5; un plan caducado vuelve a 3", async () => {
  const paid = (expiresAt) => ({ professionalPremium: { entitled: true, tier: "free", interval: "monthly", seats: 5, expiresAt,
    stripeMode: "test" } });
  const trainer = await ctx.makeTrainer({ fields: paid(new Date(Date.now() + 86400000)) });
  for (let i = 0; i < 5; i += 1) assert.equal((await invite(trainer, await ctx.makeClient(), ["training"])).status, 201);
  const sixth = await invite(trainer, await ctx.makeClient(), ["training"]);
  assert.equal(sixth.status, 403, "invitar nunca compra plazas");
  assert.equal(sixth.body.code, "TRAINER_LIMIT_REACHED");

  const lapsed = await ctx.makeTrainer({ fields: paid(new Date(Date.now() - 1000)) });
  for (let i = 0; i < 3; i += 1) await invite(lapsed, await ctx.makeClient(), ["training"]);
  assert.equal((await invite(lapsed, await ctx.makeClient(), ["training"])).status, 403);
});

test("si las plazas bajan, una invitación pendiente no se cancela pero no se puede aceptar hasta que haya sitio", async () => {
  const trainer = await ctx.makeTrainer({ fields: { professionalPremium: { entitled: true, tier: "free", interval: "monthly", seats: 4,
    expiresAt: new Date(Date.now() + 86400000), stripeMode: "test" } } });
  const clients = [];
  for (let i = 0; i < 4; i += 1) clients.push(await ctx.makeClient());
  for (const c of clients) await invite(trainer, c, ["training"]);
  // Termina el periodo pagado: vuelve a Free con 3 plazas y 4 invitaciones reservadas.
  await trainer.doc.constructor.updateOne({ _id: trainer._id }, { $set: { "professionalPremium.expiresAt": new Date(Date.now() - 1000) } });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await respond(clients[i], trainer, "accept")).status, 200);
  }
  const late = await respond(clients[3], trainer, "accept");
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "SEAT_UNAVAILABLE");
  const pending = await ctx.get(clients[3], "/trainer/invites/mine");
  assert.equal(pending.length, 1, "la invitación sigue pendiente");
  // Al liberar una plaza (el entrenador termina con un cliente), ya se puede aceptar.
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${clients[0].id}?scope=training`)).status, 200);
  assert.equal((await respond(clients[3], trainer, "accept")).status, 200);
});

test("por encima del plan: los clientes más recientes quedan en SOLO LECTURA (leer sí, escribir CLIENT_READ_ONLY)", async () => {
  const trainer = await ctx.makeTrainer();
  const clients = [];
  for (let i = 0; i < 4; i += 1) {
    const c = await ctx.makeClient({ name: `Plaza${i}` });
    clients.push(c);
    await ctx.relate(trainer, c, { scope: "training", invitedAt: new Date(Date.UTC(2026, 0, 1 + i)) });
  }
  const newest = clients[3];
  const seats = await ctx.get(trainer, "/trainer/seats");
  assert.equal(seats.overLimit, true);
  assert.equal(seats.limit, 3);
  assert.deepEqual(seats.clients.filter((c) => !c.active).map((c) => c.clientId), [newest.id]);

  const listed = await ctx.get(trainer, "/trainer/clients");
  assert.equal(listed.find((c) => String(c.user?._id) === newest.id)?.readOnly, true);

  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${newest.id}/tables`)).status, 200, "leer sí");
  const write = await ctx.call(trainer, "POST", `/trainer/clients/${newest.id}/notes`, { text: "Nota" });
  assert.equal(write.status, 403);
  assert.equal(write.body.code, "CLIENT_READ_ONLY");
  assert.notEqual((await ctx.call(trainer, "POST", `/trainer/clients/${clients[0].id}/notes`, { text: "Nota" })).status, 403);
});

test("elegir clientes activos: solo de la cartera, como mucho el límite, y bloqueado 30 días tras un cambio", async () => {
  const trainer = await ctx.makeTrainer();
  const clients = [];
  for (let i = 0; i < 4; i += 1) {
    const c = await ctx.makeClient();
    clients.push(c);
    await ctx.relate(trainer, c, { scope: "nutrition", invitedAt: new Date(Date.UTC(2026, 1, 1 + i)) });
  }
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(trainer, "PUT", "/trainer/seats", { clientIds: [stranger.id] })).body.code, "SEAT_NOT_OWNED");
  assert.equal((await ctx.call(trainer, "PUT", "/trainer/seats", { clientIds: clients.map((c) => c.id) })).body.code, "SEAT_LIMIT_EXCEEDED");
  assert.equal((await ctx.call(trainer, "PUT", "/trainer/seats", { clientIds: "todos" })).status, 400);

  const chosen = [clients[1].id, clients[2].id, clients[3].id];
  const res = await ctx.put(trainer, "/trainer/seats", { clientIds: chosen });
  assert.deepEqual(res.clients.filter((c) => !c.active).map((c) => c.clientId), [clients[0].id]);
  assert.ok(res.lockedUntil);
  // Ahora el más antiguo es el de solo lectura.
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${clients[0].id}/notes`, { text: "x" })).body.code, "CLIENT_READ_ONLY");

  const locked = await ctx.call(trainer, "PUT", "/trainer/seats", { clientIds: [clients[0].id, clients[1].id, clients[2].id] });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, "SEAT_CHANGE_LOCKED");
  // Repetir la misma selección no es un cambio.
  assert.equal((await ctx.call(trainer, "PUT", "/trainer/seats", { clientIds: chosen })).status, 200);
});

// --- Revocar ---------------------------------------------------------------------

test("revocar un scope: el entrenador pierde acceso a ese lado y conserva el otro; el cliente lo ve en su historial", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(trainer, client);

  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}`)).status, 400, "scope obligatorio");
  await ctx.del(trainer, `/trainer/clients/${client.id}?scope=training`);

  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/tables`)).status, 403);
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/diet`)).status, 200);
  assert.equal((await ctx.get(trainer, "/trainer/clients")).length, 1, "sigue siendo su cliente por nutrición");

  const history = await ctx.get(client, "/trainer/history?asClient=1");
  assert.deepEqual(history.map((r) => [r.scope, r.status]), [["training", "revoked"]]);

  // Revocar otra vez: 404 idempotente.
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}?scope=training`)).status, 404);
});

test("el cliente se da de baja de un scope: el entrenador deja de verle por ese lado y puede re-invitarle", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(trainer, client, ["nutrition"]);
  const revoked = await ctx.del(client, "/trainer/link/nutrition");
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedBy, "client");
  assert.deepEqual(await ctx.get(trainer, "/trainer/clients"), []);
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/diet`)).status, 403);
  assert.equal((await ctx.call(client, "DELETE", "/trainer/link/nutrition")).status, 404);
  assert.equal((await invite(trainer, client, ["nutrition"])).status, 201, "revocada es terminal pero se puede volver a invitar");
});

test("tras la baja el cliente vuelve a cumplir los límites free (la exención de rutinas asignadas se pierde)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(trainer, client, ["training"]);
  await ctx.model("Table").create({ name: "Asignada", userId: client._id, assignedByTrainerId: trainer._id, splits: [] });
  await ctx.post(client, `/tables/user/${client.id}`, { name: "Propia" });
  await ctx.del(client, "/trainer/link/training");
  const res = await ctx.call(client, "POST", `/tables/user/${client.id}`, { name: "Otra" });
  assert.equal(res.body.code, "PREMIUM_LIMIT_ROUTINES");
});

// --- Cuestionario de alta ------------------------------------------------------------

test("cuestionario: pendiente al aceptar; enviarlo actualiza el perfil, siembra el peso y avisa a los dos; editable hasta revisarlo", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient({ fields: { weight: 80 } });
  await inviteAndAccept(trainer, client);

  let onboarding = await ctx.get(client, "/trainer/onboarding-status");
  assert.equal(onboarding.professionals.length, 1, "un cuestionario por profesional, no por scope");
  assert.deepEqual(onboarding.professionals[0].scopes.sort(), ["nutrition", "training"]);
  assert.equal(onboarding.professionals[0].intakeStatus, "pending");
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/intake/reviewed`)).status, 404, "aún no enviado");

  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, weight: 76.5, height: 178, sex: 1, allergies: "gluten", goals: "Perder grasa" });

  const me = (await ctx.get(client, "/auth/me")).user;
  assert.equal(me.weight, 76.5);
  assert.equal(me.height, 178);
  assert.equal((await ctx.model("Anthropometry").findOne({ userId: client._id, date: h.day(0) }).lean()).weight, 76.5, "el peso del cuestionario es la medida de hoy");
  assert.ok(typesOf(await trainerNotifications(trainer)).includes("intake_submitted_trainer"));
  assert.ok(typesOf(await clientNotifications(client)).includes("intake_submitted"));
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id, clientId: client._id, intakePending: true }), 0,
    "uno por par: se da por enviado en TODOS los scopes");

  onboarding = await ctx.get(client, "/trainer/onboarding-status");
  assert.equal(onboarding.professionals[0].intakeStatus, "submitted");

  // Reenviar mientras no está revisado: se sobrescribe sin volver a avisar.
  const before = typesOf(await trainerNotifications(trainer)).length;
  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, weight: 76, goals: "Recomposición" });
  assert.equal(typesOf(await trainerNotifications(trainer)).length, before);
  assert.equal((await ctx.model("Anthropometry").countDocuments({ userId: client._id, date: h.day(0) })), 1, "reenviar corrige la medida de hoy, no añade otra");

  // El entrenador lo ve y lo marca revisado; a partir de ahí es de solo lectura.
  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.ok(seen);
  await ctx.post(trainer, `/trainer/clients/${client.id}/intake/reviewed`);
  const locked = await ctx.call(client, "POST", "/trainer/intake", { trainerId: trainer.id, weight: 70 });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.code, "INTAKE_ALREADY_REVIEWED");
  assert.equal((await ctx.get(client, "/auth/me")).user.weight, 76);
});

test("cuestionario: la configuración del profesional (campos y preguntas propias) se guarda en su usuario y llega al cliente", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const initial = await ctx.get(trainer, "/trainer/intake-config");
  assert.deepEqual(initial.enabledFields, initial.catalog, "sin configurar: todos los campos");
  assert.deepEqual(initial.customQuestions, []);

  const bad = await ctx.call(trainer, "PUT", "/trainer/intake-config", { enabledFields: ["inventado"] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_INTAKE_FIELDS");

  const untyped = await ctx.call(trainer, "PUT", "/trainer/intake-config", { enabledFields: [], customQuestions: [{ label: "Sin tipo" }] });
  assert.equal(untyped.body.code, "INVALID_CUSTOM_QUESTIONS", "las preguntas llevan tipo, como en los check-ins");

  const saved = await ctx.put(trainer, "/trainer/intake-config", {
    enabledFields: ["goals", "allergies"],
    customQuestions: [
      { label: "¿Turnos de noche?", type: "yes_no", required: true },
      { label: "Borrador", type: "text", enabled: false },
    ],
    lastScopes: ["nutrition"],
  });
  assert.deepEqual(saved.enabledFields, ["goals", "allergies"]);
  assert.equal(saved.customQuestions.length, 2);
  assert.ok(saved.customQuestions.every((q) => /^[0-9a-f]{24}$/.test(String(q._id))), "cada pregunta con su id");
  // Volver a guardar conserva los ids (las respuestas ya recibidas los referencian).
  const resaved = await ctx.put(trainer, "/trainer/intake-config", { ...saved });
  assert.deepEqual(resaved.customQuestions.map((q) => String(q._id)), saved.customQuestions.map((q) => String(q._id)));
  const again = await ctx.get(trainer, "/trainer/intake-config");
  assert.deepEqual(again.customQuestions, saved.customQuestions);
  assert.deepEqual(again.lastScopes, ["nutrition"]);

  // Vive dentro del usuario del profesional (2026-10), no en una colección aparte.
  const stored = await ctx.model("User").findById(trainer.id).select("trainerSettings").lean();
  assert.deepEqual(stored.trainerSettings.intake.enabledFields, ["goals", "allergies"]);

  await inviteAndAccept(trainer, client, ["nutrition"]);
  const onboarding = await ctx.get(client, "/trainer/onboarding-status");
  const relation = onboarding.professionals[0];
  assert.ok(relation.intakeEnabledFields.includes("goals"));
  assert.ok(!relation.intakeEnabledFields.includes("equipment"), "lo desactivado no se pide");
  assert.ok(relation.intakeEnabledFields.includes("dietaryFlags"), "forzado en nutrición");
  assert.deepEqual(
    relation.intakeCustomQuestions.map((q) => [String(q._id), q.label, q.type, q.required]),
    [[String(saved.customQuestions[0]._id), "¿Turnos de noche?", "yes_no", true]],
    "solo las preguntas activas, con su tipo"
  );
});

test("cuestionario: las respuestas propias se validan por tipo, se exigen las obligatorias y guardan su enunciado", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const config = await ctx.put(trainer, "/trainer/intake-config", {
    enabledFields: ["goals"],
    customQuestions: [
      { label: "¿Turnos de noche?", type: "yes_no", required: true },
      { label: "Horas de sueño", type: "number", unit: "h" },
      { label: "Deporte", type: "select", options: ["Correr", "Nadar"] },
    ],
  });
  const [nights, sleep, sport] = config.customQuestions.map((q) => String(q._id));
  await inviteAndAccept(trainer, client, ["training"]);

  const missing = await ctx.call(client, "POST", "/trainer/intake", { trainerId: trainer.id, customAnswers: [{ questionId: sleep, value: 7 }] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "INVALID_CUSTOM_ANSWER", "falta la obligatoria");
  const wrongType = await ctx.call(client, "POST", "/trainer/intake", {
    trainerId: trainer.id,
    customAnswers: [{ questionId: nights, value: "true" }, { questionId: sport, value: "Bailar" }],
  });
  assert.equal(wrongType.body.code, "INVALID_CUSTOM_ANSWER", "opción que no existe");

  await ctx.post(client, "/trainer/intake", {
    trainerId: trainer.id,
    customAnswers: [{ questionId: nights, value: "true" }, { questionId: sleep, value: "7.5" }, { questionId: "inventada", value: "x" }],
  });
  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.deepEqual(
    seen.customAnswers.map((a) => [a.label, a.type, a.unit, a.value]),
    [["¿Turnos de noche?", "yes_no", "", true], ["Horas de sueño", "number", "h", 7.5]],
    "valores normalizados por tipo; lo que no es una pregunta suya no se guarda"
  );

  // El profesional borra una pregunta de su configuración: el formulario de
  // este cliente es la copia de su invitación y no cambia. Corregir una
  // respuesta deja las demás como estaban.
  await ctx.put(trainer, "/trainer/intake-config", { enabledFields: ["goals"], customQuestions: [config.customQuestions[1], config.customQuestions[2]] });
  const corrected = await ctx.put(trainer, `/trainer/clients/${client.id}/intake`, { goals: "x", customAnswers: [{ questionId: sport, value: "Nadar" }] });
  assert.deepEqual(corrected.customAnswers.map((a) => [a.label, a.value]),
    [["¿Turnos de noche?", true], ["Horas de sueño", 7.5], ["Deporte", "Nadar"]]);

  // Tras una baja, la invitación nueva copia la configuración de ahora: lo
  // ya respondido a la pregunta borrada sigue ahí, legible.
  await ctx.del(client, "/trainer/link/training");
  await inviteAndAccept(trainer, client, ["training"]);
  const reopened = await ctx.put(trainer, `/trainer/clients/${client.id}/intake`, { goals: "x", customAnswers: [{ questionId: sleep, value: 8 }] });
  assert.deepEqual(reopened.customAnswers.map((a) => [a.label, a.value]),
    [["Horas de sueño", 8], ["Deporte", "Nadar"], ["¿Turnos de noche?", true]]);
});

test("cuestionario: sin relación activa no se puede enviar; datos fuera de rango no tocan el perfil", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient({ fields: { weight: 70 } });
  const res = await ctx.call(client, "POST", "/trainer/intake", { trainerId: trainer.id, weight: 70 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "NO_INTAKE_PENDING");
  assert.equal((await ctx.call(client, "POST", "/trainer/intake", {})).status, 400, "trainerId obligatorio");

  await inviteAndAccept(trainer, client, ["training"]);
  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, weight: 9999, height: 5, sex: 7 });
  const me = (await ctx.get(client, "/auth/me")).user;
  assert.equal(me.weight, 70);
  assert.equal(me.height, undefined);
});

test("una relación nueva con un entrenador con quien ya se rellenó el cuestionario NO vuelve a pedirlo", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(trainer, client, ["training"]);
  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, goals: "x" });
  await inviteAndAccept(trainer, client, ["nutrition"]);
  assert.equal(await ctx.count("TrainerClient", { trainerId: trainer._id, clientId: client._id, intakePending: true }), 0);
});

test("cuestionario: lo que rellena el profesional antes no cuenta como enviado; volver tras una baja lo pide otra vez", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(trainer, client, ["training"]);
  const edited = await ctx.put(trainer, `/trainer/clients/${client.id}/intake`, { goals: "Lo apunto yo", trainingLocation: "luna" });
  assert.equal(edited.goals, "Lo apunto yo");
  assert.equal(edited.trainingLocation, null, "fuera de catálogo no se guarda");
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake/status`)).status, "pending");
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/intake/reviewed`)).status, 404);

  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, goals: "Fuerza" });
  await ctx.post(trainer, `/trainer/clients/${client.id}/intake/reviewed`);
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake/status`)).status, "reviewed");

  // Baja y vuelta: cuestionario pendiente otra vez y, al reenviarlo, por revisar.
  await ctx.del(client, "/trainer/link/training");
  await inviteAndAccept(trainer, client, ["training"]);
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake/status`)).status, "pending");
  assert.equal((await ctx.get(client, `/trainer/intake/${trainer.id}`)).goals, "Fuerza", "precarga lo que ya respondió");
  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, goals: "Fuerza 2" });
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake/status`)).status, "submitted");
  const queue = await ctx.get(trainer, "/trainer/review-queue");
  assert.equal(queue.counts.intake, 1);
});

test("ver o editar el cuestionario sin relación: 403", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/intake`)).status, 403);
  assert.equal((await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/intake`, { goals: "x" })).status, 403);
});

// --- Fronteras de scope -----------------------------------------------------------------

test("un entrenador solo de entrenamiento no ve la dieta, y uno solo de nutrición no ve las rutinas", async () => {
  const coach = await ctx.makeTrainer();
  const dietitian = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await inviteAndAccept(coach, client, ["training"]);
  await inviteAndAccept(dietitian, client, ["nutrition"]);

  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${client.id}/tables`)).status, 200);
  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${client.id}/diet`)).status, 403);
  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${client.id}/adherence`)).status, 403);
  assert.equal((await ctx.call(dietitian, "GET", `/trainer/clients/${client.id}/diet`)).status, 200);
  assert.equal((await ctx.call(dietitian, "GET", `/trainer/clients/${client.id}/tables`)).status, 403);
  // Lo común (medidas, notas) lo ven los dos.
  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${client.id}/anthropometry`)).status, 200);
  assert.equal((await ctx.call(dietitian, "GET", `/trainer/clients/${client.id}/anthropometry`)).status, 200);
  // Un cliente ajeno: nada.
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${stranger.id}/anthropometry`)).status, 403);
});
