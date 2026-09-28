const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Integración contra un Mongo LOCAL AISLADO (nunca .env ni la BD compartida):
// índices únicos, compare-and-swap real, HTTP completo con tokens firmados en
// el propio test, job con reloj inyectado y migración doble.
//
//   npm run test:trainer-payments:db
//
// Por defecto usa mongodb://127.0.0.1:27017/trainfit_payments_test_<pid>_<ts>
// y la borra al terminar. TRAINER_PAYMENTS_TEST_MONGO_URI permite otra, pero
// solo en loopback y con nombre trainfit_payments_test*. Sin Mongo local, los
// tests se marcan como omitidos (no fallan en falso ni tocan nada más).

const URI =
  process.env.TRAINER_PAYMENTS_TEST_MONGO_URI ||
  `mongodb://127.0.0.1:27017/trainfit_payments_test_${process.pid}_${Date.now()}`;
{
  const url = new URL(URI);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.slice(1).startsWith("trainfit_payments_test")) {
    throw new Error("Este test solo corre contra un Mongo local y una BD trainfit_payments_test*.");
  }
}

// Claves JWT propias del test, antes de cargar el servicio de tokens.
const keys = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.PUBLIC_KEY = keys.publicKey;
process.env.PRIVATE_KEY = keys.privateKey;

const mongoose = require("mongoose");
mongoose.set("strictQuery", true);

let available = false;
let server = null;
let baseUrl = "";
let C, TokenService, User, TrainerClient, Notification, TrainerPayment, TrainerPaymentProfile, TrainerPaymentSettings;
let reminderService, migration, mapper;

test.before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2500 });
    available = true;
  } catch (error) {
    console.warn(`[trainer-payments-db] Mongo local no disponible (${error.message}): tests omitidos.`);
    return;
  }
  C = require("./core").load();
  TokenService = require("../../services/token.service");
  User = require("../users/schema");
  TrainerClient = require("../trainerClients/trainer-client-schema");
  Notification = require("../notifications/notification-schema");
  TrainerPayment = require("./trainer-payment-schema");
  TrainerPaymentProfile = require("./trainer-payment-profile-schema");
  TrainerPaymentSettings = require("./trainer-payment-settings-schema");
  reminderService = require("./trainer-payment-reminder-service");
  migration = require("../../scripts/migrate-trainer-payments-v2");
  mapper = require("./trainer-payment-mapper");
  for (const model of [User, TrainerClient, Notification, TrainerPayment, TrainerPaymentProfile, TrainerPaymentSettings]) {
    await model.createIndexes();
  }
  const app = require("../../app");
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

// --- Helpers ------------------------------------------------------------------

const oid = () => new mongoose.Types.ObjectId();
const todayMadrid = () => C.civilDayInZone(new Date(), "Europe/Madrid");
let opSeq = 0;
const op = (label) => `op-${label}-${Date.now()}-${++opSeq}`;

async function reset() {
  for (const model of [User, TrainerClient, Notification, TrainerPayment, TrainerPaymentProfile, TrainerPaymentSettings]) {
    await model.deleteMany({});
  }
}

async function makeUser(name, roles, family) {
  const _id = oid();
  const sessionId = crypto.randomUUID();
  await User.collection.insertOne({
    _id,
    name,
    lastname: "Test",
    email: `${name.toLowerCase()}.${_id}@example.test`,
    roles,
    passwordVersion: 0,
    auth: { sessionId, clientFamily: family, refreshExpiresAt: new Date(Date.now() + 86400000) },
  });
  const token = TokenService.signAccess({ sub: String(_id), sid: sessionId, pver: 0 }, { audience: family });
  return { id: String(_id), token, family, name };
}

let invitedSeq = 0;
async function relate(trainer, client, status = "active", scope = "training") {
  invitedSeq += 1;
  await TrainerClient.collection.insertOne({
    trainerId: new mongoose.Types.ObjectId(trainer.id),
    clientId: new mongoose.Types.ObjectId(client.id),
    clientEmail: `${client.name.toLowerCase()}.${client.id}@example.test`,
    scope,
    status,
    intakePending: false,
    invitedAt: new Date(Date.UTC(2026, 0, 1, 0, invitedSeq)),
    respondedAt: new Date(),
    revokedAt: status === "revoked" ? new Date() : null,
  });
}

async function seed() {
  await reset();
  const A = await makeUser("Ana", ["trainer"], "trainfit-trainers");
  const B = await makeUser("Bruno", ["trainer"], "trainfit-trainers");
  const C1 = await makeUser("Carla", ["user"], "trainfit-front");
  const C2 = await makeUser("Carlos", ["user"], "trainfit-front");
  const C3 = await makeUser("Celia", ["user"], "trainfit-front");
  const C4 = await makeUser("Cesar", ["user"], "trainfit-front");
  const F = await makeUser("Fermin", ["user"], "trainfit-front");
  const X = await makeUser("Ximena", ["user"], "trainfit-front");
  // Plan Free = 3 plazas: C4 (el más reciente) queda en solo lectura.
  for (const client of [C1, C2, C3, C4]) await relate(A, client);
  await relate(A, F, "revoked");
  await relate(B, X);
  return { A, B, C1, C2, C3, C4, F, X };
}

async function call(user, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}`, "x-client-family": user.family },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const clientPath = (client) => `/trainer/payments/clients/${client.id}`;

async function createCharge(trainer, client, amount, dueDay, extra = {}) {
  const result = await call(trainer, "POST", `${clientPath(client)}/charges`, { amount, dueDay, operationId: op("create"), ...extra });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.charge;
}

function pay(trainer, client, chargeId, amount, receivedDay, operationId = op("pay")) {
  return call(trainer, "POST", `${clientPath(client)}/charges/${chargeId}/payments`, { amount, receivedDay, method: "bizum", operationId });
}

async function insertLegacy(trainer, client, fields) {
  const _id = oid();
  await TrainerPayment.collection.insertOne({
    _id,
    trainerId: new mongoose.Types.ObjectId(trainer.id),
    clientId: new mongoose.Types.ObjectId(client.id),
    currency: "EUR",
    paidAt: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    ...fields,
  });
  return String(_id);
}

// --- Tests --------------------------------------------------------------------------

test("permisos: otro entrenador, rol cliente, plaza en solo lectura y antiguo cliente", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const today = todayMadrid();
  const charge = await createCharge(s.A, s.C1, "60", today, { note: "Nota privada", concept: "Octubre" });

  assert.equal((await call(s.B, "GET", clientPath(s.C1))).status, 403, "otro entrenador no lee");
  const foreign = await pay(s.B, s.X, charge.id, 10, today);
  assert.equal(foreign.status, 404, "el id de un cobro ajeno no sirve por otra pareja");
  assert.equal((await call(s.C1, "GET", "/trainer/payments/overview")).status, 403, "rol cliente");
  assert.equal((await pay(s.C1, s.C1, charge.id, 10, today)).status, 403, "el cliente no registra pagos");

  assert.equal((await call(s.A, "GET", clientPath(s.C4))).status, 200, "solo lectura: consultar sí");
  const readOnly = await call(s.A, "POST", `${clientPath(s.C4)}/charges`, { amount: 10, dueDay: today, operationId: op("ro") });
  assert.equal(readOnly.status, 403);
  assert.equal(readOnly.body.code, "CLIENT_READ_ONLY");

  // Antiguo cliente con deuda previa: leerla y cerrarla sí; nada más.
  const legacyId = await insertLegacy(s.A, s.F, { amount: 50, dueDate: new Date("2026-08-05T00:00:00Z"), note: "agosto" });
  const ledger = await call(s.A, "GET", clientPath(s.F));
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.access, "former");
  assert.equal(ledger.body.charges[0].balanceCents, 5000);
  const newCharge = await call(s.A, "POST", `${clientPath(s.F)}/charges`, { amount: 10, dueDay: today, operationId: op("former") });
  assert.equal(newCharge.body.code, "FORMER_CLIENT_RESTRICTED");
  const plan = await call(s.A, "PUT", `${clientPath(s.F)}/plan`, { amount: 60, unit: "month", interval: 1, nextDueDay: today, operationId: op("fplan") });
  assert.equal(plan.status, 403);
  const settle = await pay(s.A, s.F, legacyId, 20, today);
  assert.equal(settle.status, 200);
  assert.equal(settle.body.charge.balanceCents, 3000);
  assert.equal((await call(s.A, "PUT", `${clientPath(s.F)}/preferences`, { clientRemindersEnabled: true })).status, 403);
  assert.equal((await call(s.A, "GET", `/trainer/clients/${s.F.id}/payments`)).status, 403, "la ficha sigue cerrada");

  // El Coach del cliente: saldo restante, sin notas privadas.
  await pay(s.A, s.C1, charge.id, 20, today);
  const coach = await call(s.C1, "GET", "/coach/dashboard");
  assert.equal(coach.status, 200);
  assert.deepEqual(coach.body.pendingPayments.map((item) => [item.amount, item.concept]), [[40, "Octubre"]]);
  assert.equal(JSON.stringify(coach.body.pendingPayments).includes("Nota privada"), false);
});

test("idempotencia y concurrencia: doble envío, pagos simultáneos y pago contra cancelación", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const today = todayMadrid();
  const body = { amount: "60", dueDay: today, operationId: op("dup") };
  const [first, second] = await Promise.all([
    call(s.A, "POST", `${clientPath(s.C1)}/charges`, body),
    call(s.A, "POST", `${clientPath(s.C1)}/charges`, body),
  ]);
  assert.deepEqual([first.status, second.status], [201, 201]);
  assert.equal(first.body.charge.id, second.body.charge.id);
  assert.equal(await TrainerPayment.countDocuments({ clientId: s.C1.id }), 1);
  const conflict = await call(s.A, "POST", `${clientPath(s.C1)}/charges`, { ...body, amount: "61" });
  assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");

  const chargeId = first.body.charge.id;
  const results = await Promise.all([pay(s.A, s.C1, chargeId, 40, today), pay(s.A, s.C1, chargeId, 40, today)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
  const sameOp = op("same");
  const replays = await Promise.all([pay(s.A, s.C1, chargeId, 10, today, sameOp), pay(s.A, s.C1, chargeId, 10, today, sameOp)]);
  assert.deepEqual(replays.map((r) => r.status), [200, 200]);
  const detail = await call(s.A, "GET", `${clientPath(s.C1)}/charges/${chargeId}`);
  assert.equal(detail.body.receivedCents, 5000);
  assert.equal(detail.body.payments.filter((p) => p.status === "valid").length, 2);

  // Pago y cancelación a la vez sobre 70 pendientes: gana uno, nunca los dos.
  const big = await createCharge(s.A, s.C1, "100", today);
  await pay(s.A, s.C1, big.id, 30, today);
  const race = await Promise.all([
    call(s.A, "POST", `${clientPath(s.C1)}/charges/${big.id}/cancel`, { reason: "Descuento acordado", confirmBalanceCents: 7000, operationId: op("cancel") }),
    pay(s.A, s.C1, big.id, 70, today),
  ]);
  assert.equal(race.filter((r) => r.status === 200).length, 1, JSON.stringify(race.map((r) => r.body)));
  const final = (await call(s.A, "GET", `${clientPath(s.C1)}/charges/${big.id}`)).body;
  assert.equal(final.balanceCents, 0);
  assert.ok(
    (final.status === "cancelled" && final.receivedCents === 3000 && final.cancelledCents === 7000) ||
      (final.status === "settled" && final.receivedCents === 10000 && final.cancelledCents === 0),
    JSON.stringify(final)
  );
  const stored = C.normalizeCharge(mapper.toChargeRecord(await TrainerPayment.findById(big.id).lean()));
  assert.deepEqual(C.verifyCharge(stored), []);
});

test("cuota: una sola regla por pareja, vencimientos únicos, precio desde el vencimiento y pausa", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const today = todayMadrid();
  const first = C.addDays(today, 2);
  const preview = await call(s.A, "POST", `${clientPath(s.C1)}/plan/preview`, { amount: "60", unit: "month", interval: 1, nextDueDay: first });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.nextDates.length, 3);
  assert.equal(await TrainerPaymentProfile.countDocuments({}), 0, "previsualizar no guarda");

  const planBody = { amount: "60", unit: "month", interval: 1, nextDueDay: first, operationId: op("plan") };
  const saved = await Promise.all([
    call(s.A, "PUT", `${clientPath(s.C1)}/plan`, planBody),
    call(s.A, "PUT", `${clientPath(s.C1)}/plan`, planBody),
  ]);
  assert.deepEqual(saved.map((r) => r.status), [200, 200]);
  assert.equal(await TrainerPaymentProfile.countDocuments({ clientId: s.C1.id }), 1);
  // Varias lecturas y puestas al día (entrenador y cliente) a la vez: un único vencimiento.
  await Promise.all([
    call(s.A, "GET", clientPath(s.C1)),
    call(s.A, "GET", clientPath(s.C1)),
    reminderService.refreshTrainer(s.A.id, new Date()),
    reminderService.refreshClient(s.C1.id, new Date()),
    call(s.A, "GET", `${clientPath(s.C1)}/summary`),
  ]);
  const recurring = await TrainerPayment.find({ clientId: s.C1.id, origin: "recurring" }).lean();
  assert.equal(recurring.length, 1);
  assert.equal(recurring[0].dueDay, first);

  const priced = await call(s.A, "PUT", `${clientPath(s.C1)}/plan`, {
    amount: "70",
    unit: "month",
    interval: 1,
    effectiveFromDay: first,
    operationId: op("price"),
  });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.deepEqual(priced.body.changes, ["price"]);
  const repriced = await TrainerPayment.findById(recurring[0]._id).lean();
  assert.equal(repriced.amountCents, 7000);
  assert.equal(repriced.adjustments.at(-1).type, "price_change");

  const paused = await call(s.A, "POST", `${clientPath(s.C1)}/plan/pause`, { operationId: op("pause") });
  assert.equal(paused.body.plan.status, "paused");
  const ledger = (await call(s.A, "GET", clientPath(s.C1))).body;
  assert.equal(ledger.charges.filter((c) => c.origin === "recurring").length, 0);
  assert.equal(ledger.voided.length, 1);
  assert.equal(ledger.summary.state, "paused");
  const resumed = await call(s.A, "POST", `${clientPath(s.C1)}/plan/resume`, { nextDueDay: C.addDays(today, 40), operationId: op("resume") });
  assert.equal(resumed.body.plan.status, "active");
  assert.equal(resumed.body.plan.nextDueDay, C.addDays(today, 40));
  assert.equal((await TrainerPayment.find({ clientId: s.C1.id, origin: "recurring", status: "open" }).lean()).length, 0, "sin cuotas del intervalo pausado");
});

test("baja: un scope no termina la cuota; el último sí, apaga avisos del cliente; reinvitar no reactiva", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  await relate(s.A, s.C1, "active", "nutrition");
  const today = todayMadrid();
  await call(s.A, "PUT", `${clientPath(s.C1)}/plan`, { amount: "60", unit: "month", interval: 1, nextDueDay: C.addDays(today, 3), operationId: op("plan") });
  const prefs = await call(s.A, "PUT", `${clientPath(s.C1)}/preferences`, { clientRemindersEnabled: true });
  assert.equal(prefs.body.clientRemindersEnabled, true);

  assert.equal((await call(s.A, "DELETE", `/trainer/clients/${s.C1.id}?scope=training`)).status, 200);
  let profile = await TrainerPaymentProfile.findOne({ clientId: s.C1.id }).lean();
  assert.equal(profile.plan.status, "active", "sigue nutrición con el mismo entrenador");

  assert.equal((await call(s.A, "DELETE", `/trainer/clients/${s.C1.id}?scope=nutrition`)).status, 200);
  profile = await TrainerPaymentProfile.findOne({ clientId: s.C1.id }).lean();
  assert.equal(profile.plan.status, "ended");
  assert.equal(profile.plan.endReason, "relation_ended");
  assert.equal(profile.clientReminders.enabled, false);
  const forecast = await TrainerPayment.findOne({ clientId: s.C1.id, origin: "recurring" }).lean();
  assert.equal(forecast.status, "void");
  assert.equal(forecast.voidReason, "relation_ended");

  await relate(s.A, s.C1, "active", "training"); // reinvitación aceptada
  const again = (await call(s.A, "GET", clientPath(s.C1))).body;
  assert.equal(again.plan.status, "ended");
  assert.equal(again.preferences.clientRemindersEnabled, false);
  assert.equal(await TrainerPaymentProfile.countDocuments({ clientId: s.C1.id }), 1);
});

test("avisos: hitos −3/0/+3, sin duplicados, saldo vigente tras un parcial y resolución al liquidar", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const ctx0 = { now: new Date("2025-03-01T10:00:00Z"), today: "2025-03-01", actorId: s.A.id };
  const { charge } = C.newOneOffCharge(
    { amount: "60", dueDay: "2025-03-10", concept: "Marzo", note: "privada", operationId: op("job") },
    { id: String(oid()), trainerId: s.A.id, clientId: s.C1.id },
    ctx0
  );
  await TrainerPayment.create(mapper.newChargeDoc(charge));
  const reminders = (recipient) => Notification.find({ type: "payment_reminder", recipient, "payload.chargeId": charge.id }).lean();

  const both = (iso) =>
    Promise.all([reminderService.refreshTrainer(s.A.id, new Date(iso)), reminderService.refreshClient(s.C1.id, new Date(iso))]);
  await both("2025-03-07T07:59:00Z"); // 08:59 en Madrid
  assert.equal((await reminders("trainer")).length, 0);
  await Promise.all([both("2025-03-07T08:05:00Z"), both("2025-03-07T08:05:00Z")]);
  let sent = await reminders("trainer");
  assert.deepEqual(sent.map((n) => n.payload.offset), [-3]);
  assert.equal(sent[0].payload.balanceCents, 6000);
  assert.equal(JSON.stringify(sent[0].payload).includes("privada"), false);
  assert.equal((await reminders("client")).length, 0, "avisos del cliente desactivados por defecto");

  // Activados el día 9: nada retroactivo; el del día 10 sí.
  await TrainerPaymentProfile.create({
    trainerId: s.A.id,
    clientId: s.C1.id,
    clientReminders: { enabled: true, enabledAt: new Date("2025-03-09T12:00:00Z") },
  });
  await both("2025-03-10T08:05:00Z");
  assert.deepEqual((await reminders("client")).map((n) => n.payload.offset), [0]);

  // Parcial: el aviso antiguo se lee con el saldo de ahora.
  assert.equal((await pay(s.A, s.C1, charge.id, 20, "2025-03-11")).status, 200);
  const listed = await call(s.A, "GET", "/trainer/notifications/mine");
  const old = listed.body.find((n) => n.type === "payment_reminder" && n.payload.offset === -3);
  assert.equal(old.payload.balanceCents, 6000, "importe histórico del aviso");
  assert.equal(old.payload.current.balanceCents, 4000, "saldo vigente");
  assert.equal(old.payload.current.clientRelation, "active");
  const clientView = await call(s.C1, "GET", "/notifications/mine");
  const clientNotice = clientView.body.find((n) => n.type === "payment_reminder");
  assert.equal(clientNotice.payload.current.balanceCents, 4000);
  assert.equal(JSON.stringify(clientView.body).includes("privada"), false);

  await both("2025-03-13T08:05:00Z");
  sent = await reminders("trainer");
  assert.deepEqual(sent.map((n) => [n.payload.offset, n.payload.balanceCents]), [[-3, 6000], [0, 6000], [3, 4000]]);

  // Liquidar resuelve los avisos pendientes: dejan de contar como deuda.
  assert.equal((await pay(s.A, s.C1, charge.id, 40, "2025-03-14")).status, 200);
  const after = await Notification.find({ "payload.chargeId": charge.id }).lean();
  assert.ok(after.every((n) => n.read && n.payload.resolution === "settled"));
  await both("2025-03-20T08:05:00Z");
  assert.equal((await Notification.countDocuments({ "payload.chargeId": charge.id })), after.length);

  // Nadie abre la app del 1 al 14 de abril: solo el hito vigente (+3), el resto omitidos.
  const late = C.newOneOffCharge(
    { amount: "30", dueDay: "2025-04-10", operationId: op("late") },
    { id: String(oid()), trainerId: s.A.id, clientId: s.C2.id },
    { now: new Date("2025-04-01T10:00:00Z"), today: "2025-04-01", actorId: s.A.id }
  ).charge;
  await TrainerPayment.create(mapper.newChargeDoc(late));
  await reminderService.refreshTrainer(s.A.id, new Date("2025-04-14T08:05:00Z"));
  const recovered = await Notification.find({ "payload.chargeId": late.id }).lean();
  assert.deepEqual(recovered.map((n) => n.payload.offset), [3]);
  const log = (await TrainerPayment.findById(late.id).lean()).reminderLog;
  assert.deepEqual(log.map((entry) => [entry.offset, entry.state]).sort(), [[-3, "skipped"], [0, "skipped"], [3, "sent"]]);
});

test("sin cron: leer crea los avisos; la memoria no relee hasta el siguiente hito o medianoche; escribir la invalida", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  // Con el reloj real: un cobro que venció ayer tiene alcanzado su hito "vence
  // hoy". Nadie lo crea hasta que el entrenador mira sus avisos.
  const today = todayMadrid();
  const overdue = C.newOneOffCharge(
    { amount: "15", dueDay: C.addDays(today, -1), operationId: op("read") },
    { id: String(oid()), trainerId: s.A.id, clientId: s.C1.id },
    { now: new Date(Date.now() - 10 * 86_400_000), today: C.addDays(today, -10), actorId: s.A.id }
  ).charge;
  await TrainerPayment.create(mapper.newChargeDoc(overdue));
  assert.equal(await Notification.countDocuments({ "payload.chargeId": overdue.id }), 0);
  const unread = await call(s.A, "GET", "/trainer/notifications/mine/unread-count");
  assert.ok(unread.body.count >= 1, "el contador ya lo cuenta");
  const listed = await call(s.A, "GET", "/trainer/notifications/mine");
  assert.deepEqual(listed.body.filter((n) => n.payload?.chargeId === overdue.id).map((n) => n.payload.offset), [0]);

  // Memoria, con reloj fijo (mayo: Madrid = UTC+2, hitos a las 07:00Z).
  const make = (dueDay, label) =>
    C.newOneOffCharge(
      { amount: "25", dueDay, operationId: op(label) },
      { id: String(oid()), trainerId: s.B.id, clientId: s.X.id },
      { now: new Date("2025-05-01T10:00:00Z"), today: "2025-05-01", actorId: s.B.id }
    ).charge;
  const sent = () => Notification.countDocuments({ type: "payment_reminder", recipient: "trainer", trainerId: s.B.id });
  const readAt = (iso) => reminderService.ensureTrainerUpToDate(s.B.id, { now: new Date(iso) });
  await TrainerPayment.create(mapper.newChargeDoc(make("2025-05-13", "m1"))); // −3: 10 may, 09:00
  await readAt("2025-05-10T06:59:00Z");
  assert.equal(await sent(), 0);
  await readAt("2025-05-10T07:01:00Z");
  assert.equal(await sent(), 1, "primera lectura tras el hito");

  // Un cobro escrito por detrás (sin controlador): no se mira hasta la
  // medianoche de Madrid (22:00Z)...
  await TrainerPayment.create(mapper.newChargeDoc(make("2025-05-11", "m2"))); // −3 ya pasó (8 may)
  await readAt("2025-05-10T21:59:00Z");
  assert.equal(await sent(), 1);
  await readAt("2025-05-10T22:01:00Z");
  assert.equal(await sent(), 2);

  // ...salvo que una escritura de la pareja invalide la memoria.
  await TrainerPayment.create(mapper.newChargeDoc(make("2025-05-12", "m3"))); // −3 ya pasó (9 may)
  await readAt("2025-05-10T22:02:00Z");
  assert.equal(await sent(), 2);
  reminderService.invalidate(s.B.id, s.X.id);
  await readAt("2025-05-10T22:03:00Z");
  assert.equal(await sent(), 3);
});


test("global: totales de todo el conjunto con varias páginas y recibido por fecha real", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const today = todayMadrid();
  const lastMonthDay = C.addDays(`${C.monthOf(today)}-01`, -3);
  const ids = [];
  for (let index = 0; index < 24; index += 1) {
    const client = [s.C1, s.C2, s.C3][index % 3];
    const dueDay = index % 2 ? C.addDays(today, -(index + 1)) : C.addDays(today, index + 1);
    const charge = await createCharge(s.A, client, "10.50", dueDay, { confirmPastDue: true });
    ids.push({ id: charge.id, client });
  }
  // Pago recibido el mes pasado pero anotado hoy: cuenta en el mes pasado.
  assert.equal((await pay(s.A, ids[0].client, ids[0].id, 5, lastMonthDay)).status, 200);
  assert.equal((await pay(s.A, ids[1].client, ids[1].id, "10.50", today)).status, 200);
  await insertLegacy(s.A, s.F, { amount: 20, dueDate: new Date(`${C.addDays(today, -40)}T00:00:00Z`) });

  const page0 = (await call(s.A, "GET", "/trainer/payments/overview?limit=10&state=all")).body;
  const page2 = (await call(s.A, "GET", "/trainer/payments/overview?limit=10&page=2&state=all")).body;
  assert.equal(page0.rows.length, 10);
  assert.equal(page2.rows.length, 5);
  assert.equal(page0.results.count, 25);
  // Equivalencia: el agregado de Mongo = el núcleo sobre todos los cobros.
  const all = (await TrainerPayment.find({ trainerId: s.A.id }).lean()).map((doc) => C.normalizeCharge(mapper.toChargeRecord(doc)));
  const expectedPending = all
    .filter((c) => c.status === "open" && !C.isForecast(c, today))
    .reduce((total, c) => total + C.balanceOf(c), 0);
  const expectedOverdue = all.filter((c) => C.isOverdue(c, today)).reduce((total, c) => total + C.balanceOf(c), 0);
  assert.equal(page0.totals.pendingCents, expectedPending);
  assert.equal(page0.totals.overdueCents, expectedOverdue);
  assert.equal(page0.totals.receivedThisMonthCents, 1050, "el pago del mes pasado no cuenta este mes");
  assert.equal(page0.rows[0].temporal, "overdue", "primero los vencidos");

  const former = (await call(s.A, "GET", "/trainer/payments/overview?relation=former&state=all")).body;
  assert.deepEqual(former.rows.map((row) => [row.clientRelation, row.amountCents]), [["former", 2000]]);
  const search = (await call(s.A, "GET", `/trainer/payments/overview?search=${encodeURIComponent("celía")}&state=all`)).body;
  assert.ok(search.rows.length > 0 && search.rows.every((row) => row.clientId === s.C3.id));

  const summary = (await call(s.A, "GET", "/trainer/payments/summary")).body;
  assert.equal(summary.pendingAmount, expectedPending / 100);
  assert.equal(summary.seriesBasis, "due_date");
});

test("contrato antiguo y migración: PATCH repetido, sin borrar parciales, migración doble sin avisos", async (t) => {
  if (!available) return t.skip("Mongo local no disponible");
  const s = await seed();
  const today = todayMadrid();
  const unpaid = await insertLegacy(s.A, s.C1, { amount: 60, dueDate: new Date("2026-08-05T00:00:00Z"), note: "agosto" });
  const paid = await insertLegacy(s.A, s.C1, {
    amount: 45.5,
    dueDate: new Date("2026-07-04T22:00:00Z"),
    paidAt: new Date("2026-07-07T09:30:00Z"),
  });
  const usd = await insertLegacy(s.A, s.C2, { amount: 20, currency: "USD", dueDate: new Date("2026-08-05T00:00:00Z") });
  const stranger = await makeUser("Sin", ["user"], "trainfit-front");
  const orphan = await insertLegacy(s.A, stranger, { amount: 15, dueDate: new Date("2026-08-05T00:00:00Z") });

  let list = (await call(s.A, "GET", `/trainer/clients/${s.C1.id}/payments`)).body;
  assert.deepEqual(list.map((item) => [item._id, item.amount, Boolean(item.paidAt)]), [[unpaid, 60, false], [paid, 45.5, true]]);

  const patch = (id, value) => call(s.A, "PATCH", `/trainer/clients/${s.C1.id}/payments/${id}`, { paid: value });
  const firstPaid = await patch(unpaid, true);
  const secondPaid = await patch(unpaid, true);
  assert.equal(firstPaid.body.paidAt, secondPaid.body.paidAt, "repetir no mueve la fecha");
  let doc = await TrainerPayment.findById(unpaid).lean();
  assert.equal(doc.payments.length, 1);
  assert.equal(doc.payments[0].method, "unknown");
  assert.equal((await patch(unpaid, false)).body.paidAt, null);
  doc = await TrainerPayment.findById(unpaid).lean();
  assert.deepEqual(doc.payments.map((m) => m.status), ["voided"], "deshacer conserva el rastro");

  // Parcial con la app nueva: el PATCH antiguo no lo borra.
  assert.equal((await pay(s.A, s.C1, unpaid, 20, today)).status, 200);
  assert.equal((await patch(unpaid, false)).status, 200);
  list = (await call(s.A, "GET", `/trainer/clients/${s.C1.id}/payments`)).body;
  assert.equal(list.find((item) => item._id === unpaid).amount, 40, "saldo real tras el parcial");
  assert.equal((await patch(unpaid, true)).status, 200);
  const conflict = await patch(unpaid, false);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "LEGACY_CONFLICT");

  // Migración: ensayo, real y repetida.
  const notificationsBefore = await Notification.countDocuments({});
  const dry = await migration.runMigration({ dryRun: true, now: new Date() });
  assert.equal(dry.converted, 1, "solo el pagado antiguo sigue sin migrar y está limpio");
  assert.equal((await TrainerPayment.findById(paid).lean()).schemaVersion, undefined, "el ensayo no escribe");
  const real = await migration.runMigration({ dryRun: false, now: new Date() });
  assert.equal(real.converted, 1);
  assert.equal(real.totalsMatch, true);
  assert.deepEqual(real.skipped.map((item) => [item.id, item.anomalies]), [[usd, ["non_eur_currency"]]]);
  assert.deepEqual(real.orphans.map((item) => item.id), [orphan]);
  const migrated = await TrainerPayment.findById(paid).lean();
  assert.equal(migrated.dueDay, "2026-07-05", "medianoche de Madrid, no el día UTC");
  assert.equal(migrated.payments[0].receivedDaySource, "legacy_marked_paid");
  assert.equal(migrated.paidAt.toISOString(), "2026-07-07T09:30:00.000Z", "paidAt se conserva");
  const again = await migration.runMigration({ dryRun: false, now: new Date() });
  assert.equal(again.converted, 0);
  assert.deepEqual(again.totalsBefore, again.totalsAfter);
  assert.equal(await Notification.countDocuments({}), notificationsBefore, "la migración no avisa a nadie");
  assert.equal(await TrainerPaymentProfile.countDocuments({}), 0, "ni deduce cuotas recurrentes");
});
