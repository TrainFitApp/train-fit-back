const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Solo Mongo local y una base efímera propia. Nunca lee MONGODB_URI ni .env.
test("resumen integrado: permisos, etapas, intake, CAS, tareas y revisión privada", { skip: process.env.TRAINFIT_OVERVIEW_INTEGRATION !== "1", timeout: 60000 }, async (t) => {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  process.env.PUBLIC_KEY = keys.publicKey;
  process.env.PRIVATE_KEY = keys.privateKey;
  const mongoose = require("mongoose");
  const database = `trainfit_overview_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 4000 });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.host === "127.0.0.1" && mongoose.connection.name === database && /^trainfit_overview_test_\d+_\d+$/.test(database)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  // clientProgress importa mail.js: aislar SMTP sin sustituir rutas ni DAOs.
  const nodemailer = require("nodemailer");
  const createTransport = nodemailer.createTransport.bind(nodemailer);
  t.mock.method(nodemailer, "createTransport", () => {
    const transport = createTransport({ jsonTransport: true });
    transport.verify = async () => false;
    transport.sendMail = async () => { throw new Error("Correo deshabilitado en la integración local de Resumen"); };
    return transport;
  });
  const User = require("../users/schema");
  const Relation = require("../trainerClients/trainer-client-schema");
  const Intake = require("../clientIntake/client-intake-schema");
  const Task = require("../coachTasks/coach-task-schema");
  const Note = require("../trainerNotes/trainer-note-schema");
  const CheckinRequest = require("../trainerCheckins/checkin-request-schema");
  const { CoachingStage, OverviewReview } = require("./overview-schema");
  const { prepareIntake, persistPreparedIntake } = require("./intake-service");
  const { upsertMeasurement } = require("./measurement-write");
  const Token = require("../../services/token.service");
  const routes = require("./overview-routes");
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/trainer", routes.router);
  app.use(routes.consumerRouter);
  app.use("/trainer", require("../clientProgress/client-progress-routes"));
  app.use("/trainer", require("../trainerClients/trainer-client-routes"));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  await Promise.all([Relation.init(), Intake.init(), Task.init(), Note.init(), CheckinRequest.init(), CoachingStage.init(), OverviewReview.init(), mongoose.models.Anthropometry.init(), mongoose.models.MeasurementCorrection.init()]);
  const trainer = new mongoose.Types.ObjectId();
  const stranger = new mongoose.Types.ObjectId();
  const client = new mongoose.Types.ObjectId();
  const otherClient = new mongoose.Types.ObjectId();
  await User.collection.insertMany([
    { _id: trainer, roles: ["trainer"], name: "Coach", email: "coach@overview.invalid", auth: { sessionId: "test-coach", clientFamily: "trainfit-trainers" } },
    { _id: stranger, roles: ["trainer"], name: "Other", email: "other@overview.invalid", auth: { sessionId: "test-other", clientFamily: "trainfit-trainers" } },
    { _id: client, roles: ["user"], name: "Cliente", lastname: "Prueba", email: "client@overview.invalid", height: 180, birth: new Date("1990-02-15"), auth: { sessionId: "test-client", clientFamily: "trainfit-front" } },
  ]);
  const tokens = {
    trainer: Token.signAccess({ sub: String(trainer), sid: "test-coach" }, { audience: "trainfit-trainers" }),
    stranger: Token.signAccess({ sub: String(stranger), sid: "test-other" }, { audience: "trainfit-trainers" }),
    client: Token.signAccess({ sub: String(client), sid: "test-client" }, { audience: "trainfit-front" }),
  };
  const base = `/trainer/clients/${client}/overview`;
  async function request(path = base, method = "GET", body, who = "trainer") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "x-client-family": who === "client" ? "trainfit-front" : "trainfit-trainers", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const relation = await Relation.create({ trainerId: trainer, clientId: client, clientEmail: "client@overview.invalid", scope: "training", status: "cuestionario_pendiente", respondedAt: new Date("2026-08-01T10:00:00Z") });
  const intake = { goals: "Ganar fuerza", healthConditions: "Sin limitaciones declaradas", experienceLevel: "beginner", availability: "Tres días", trainingLocation: "gym", equipmentTags: ["barbell"], customAnswers: [], measurements: [{ field: "weight", value: 80, date: "2026-08-01" }], requestId: "intake_test_0001", timeZone: "Europe/Madrid", missingMeasurementsAcknowledged: true };

  await t.test("intake escribe una referencia y el reintento no duplica medición", async () => {
    await persistPreparedIntake(trainer, client, await prepareIntake(trainer, client, intake));
    await persistPreparedIntake(trainer, client, await prepareIntake(trainer, client, intake));
    assert.equal(await mongoose.models.Anthropometry.countDocuments({ userId: client }), 1);
    await Relation.updateOne({ _id: relation._id }, { $set: { status: "active", activatedAt: new Date() } });
    const result = await request();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.body.weight.initial.value, 80);
    assert.equal(result.body.context.values.goals, "Ganar fuerza");
  });

  await t.test("identidad ajena y cliente no pueden consultar datos privados", async () => {
    assert.equal((await request(base, "GET", undefined, "stranger")).status, 403);
    assert.equal((await request(base, "GET", undefined, "client")).status, 403);
  });

  await t.test("contexto editable conserva original y rechaza versión antigua", async () => {
    const before = (await request()).body;
    const edit = { expectedVersion: before.context.version, patch: { trainingLocation: "home", healthConditions: "Lesión comunicada; adaptar entrenamiento" } };
    assert.equal((await request(`${base}/context`, "PATCH", edit)).status, 200);
    assert.equal((await request(`${base}/context`, "PATCH", edit)).status, 409);
    const original = (await request(`${base}/intake`)).body;
    assert.equal(original.answers.trainingLocation, "gym");
    assert.equal((await request()).body.context.values.trainingLocation, "home");
    const forbidden = await request(`${base}/profile`, "PATCH", { expectedVersion: before.identity.profileVersion, patch: { roles: ["admin"] } });
    assert.equal(forbidden.status, 400);
    assert.equal((await request(`${base}/nutrition`, "PATCH", { patch: { allergies: "Nueces" } })).status, 403);
  });

  await t.test("tareas filtradas antes de límite; nota privada y CAS", async () => {
    await Task.insertMany(Array.from({ length: 120 }, (_, i) => ({ trainerId: trainer, clientId: otherClient, title: `Ajena ${i}` })));
    for (const [index, dueDate] of ["2026-09-15", null, "2026-09-01"].entries()) {
      const saved = await request(`${base}/tasks`, "POST", { title: `Acción ${index}`, dueDate, requestId: `task_test_000${index}` });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
    }
    const tasks = (await request()).body.tasks;
    assert.equal(tasks.total, 3);
    assert.equal(tasks.items[0].dueDate, "2026-09-01");
    const note = await request(`${base}/notes`, "POST", { text: "Recordar adaptación", pinned: true, requestId: "note_test_0001" });
    assert.equal(note.status, 201);
    assert.equal((await request(`${base}/notes/${note.body.id}`, "PATCH", { text: "Nueva observación", expectedVersion: 0 })).status, 200);
    assert.equal((await request(`${base}/notes/${note.body.id}`, "PATCH", { text: "Borrador viejo", expectedVersion: 0 })).status, 409);
  });

  await t.test("revisión privada idempotente conserva conclusión y detecta datos retrospectivos", async () => {
    const overview = (await request()).body;
    const review = { requestId: "review_test_0001", conclusion: "Mantener plan adaptado", nextStep: "Revisar tolerancia el viernes", observedFingerprint: overview.review.observedFingerprint, observedAt: overview.review.observedAt };
    assert.equal((await request(`${base}/reviews`, "POST", review)).status, 201);
    assert.equal((await request(`${base}/reviews`, "POST", review)).status, 201);
    assert.equal(await OverviewReview.countDocuments({ trainerId: trainer, clientId: client }), 1);
    assert.equal((await request()).body.review.hasNewData, false);
    await upsertMeasurement({ clientId: client, date: "2026-08-15", fields: { waist: 90 }, requestId: "retro_test_0001", source: "completion" });
    const fresh = (await request()).body;
    assert.equal(fresh.review.hasNewData, true);
    assert.equal(fresh.review.latest.nextStep, review.nextStep);
  });

  await t.test("corregir fuente avisa sobre baseline; reintento tras borrar no recrea datos", async () => {
    const input = { trainerId: trainer, clientId: client, date: "2026-08-01", fields: { weight: 82 }, expectedValues: { weight: 80 }, requestId: "correct_test_0001", source: "professional" };
    const saved = await upsertMeasurement(input);
    assert.equal((await request()).body.body.weight.baselineStatus, "source_changed");
    await mongoose.models.Anthropometry.deleteOne({ _id: saved._id });
    await upsertMeasurement(input);
    assert.equal(await mongoose.models.Anthropometry.countDocuments({ _id: saved._id }), 0);
    assert.equal((await request()).body.body.weight.baselineStatus, "source_missing");
  });

  await t.test("conflicto confirmado informa el valor actual y una corrección nueva puede recuperarse", async () => {
    const original = { clientId: client, trainerId: trainer, date: "2026-08-16", fields: { weight: 81 }, requestId: "conflict_seed_0001" };
    await upsertMeasurement(original);
    const correction = { ...original, fields: { weight: 82 }, expectedValues: { weight: 80 }, requestId: "conflict_correction_0001" };
    await assert.rejects(upsertMeasurement(correction), error => error.code === "MEASUREMENT_CONFLICT");
    await assert.rejects(upsertMeasurement({ ...correction, expectedValues: { weight: 81 } }), error => error.code === "MEASUREMENT_CONFLICT" && error.currentValues.weight === 81);
    const saved = await upsertMeasurement({ ...correction, expectedValues: { weight: 81 }, requestId: "conflict_correction_0002" });
    assert.equal(saved.weight, 82);
    assert.equal(await mongoose.models.Anthropometry.countDocuments({ userId: client, date: original.date }), 1);
  });

  await t.test("revocar un ámbito conserva etapa; regreso tras cierre crea otra y oculta pins previos", async () => {
    const firstStage = (await request()).body.stage.id;
    const nutrition = await Relation.create({ trainerId: trainer, clientId: client, clientEmail: "client@overview.invalid", scope: "nutrition", status: "active", respondedAt: new Date("2026-08-10T10:00:00Z") });
    await Relation.updateOne({ _id: relation._id }, { $set: { status: "revoked", revokedAt: new Date("2026-08-20T10:00:00Z") } });
    assert.equal((await request()).body.stage.id, firstStage);
    await Relation.updateOne({ _id: nutrition._id }, { $set: { status: "revoked", revokedAt: new Date("2026-08-25T10:00:00Z") } });
    assert.equal((await request()).status, 403);
    assert.equal((await request(`${base}/notes`, "POST", { text: "Sin permiso", requestId: "revoked_note_0001" })).status, 403);
    await Relation.create({ trainerId: trainer, clientId: client, clientEmail: "client@overview.invalid", scope: "training", status: "active", respondedAt: new Date("2026-09-01T10:00:00Z") });
    const current = (await request()).body;
    assert.notEqual(current.stage.id, firstStage);
    assert.equal(current.pinnedNotes.length, 0);
    assert.equal(current.body.weight.initial, null);
    const history = (await request(`${base}?stageId=${firstStage}`)).body;
    assert.equal(history.readOnly, true);
    assert.equal((await request(`${base}/context`, "PATCH", { stageId: firstStage, expectedVersion: history.context.version, patch: { goals: "Cambiar pasado" } })).status, 409);
  });

  await t.test("checkins actuales: estados, bienestar por campo y revisión privada sin alterar respuestas", async () => {
    const now = Date.now();
    const hoursFromNow = (hours) => new Date(now + hours * 3600000);
    const rows = await CheckinRequest.create([
      { status: "responded", scheduledAt: hoursFromNow(-3), respondedAt: hoursFromNow(-2), values: { comment: "Última respuesta", general_fatigue: 3, sleep_hours: 0 } },
      { status: "reviewed", scheduledAt: hoursFromNow(-6), respondedAt: hoursFromNow(-5), reviewedAt: hoursFromNow(-4), reviewComment: "Ya revisado en Checkins", values: { comment: "Respuesta anterior", sleep_quality: 4, recovery_between_sessions: 4 } },
      { status: "pending", scheduledAt: hoursFromNow(-1), closesAt: hoursFromNow(1) },
      { status: "pending", scheduledAt: hoursFromNow(-4), closesAt: hoursFromNow(-3) },
      { status: "unanswered", scheduledAt: hoursFromNow(-8), closesAt: hoursFromNow(-7) },
      { status: "cancelled", scheduledAt: hoursFromNow(-10) },
      { status: "pending", scheduledAt: hoursFromNow(2), closesAt: hoursFromNow(3) },
      { status: "responded", scheduledAt: new Date("2026-08-20T12:00:00Z"), respondedAt: hoursFromNow(-1), values: { comment: "Etapa anterior" } },
      { trainerId: stranger, status: "responded", scheduledAt: hoursFromNow(-3), respondedAt: hoursFromNow(-1), values: { comment: "Otro profesional" } },
    ].map((row, index) => ({ trainerId: trainer, clientId: client, scheduleId: new mongoose.Types.ObjectId(), occurrenceKey: `overview_compat_${index}`, name: "Seguimiento de prueba", timeZone: "Europe/Madrid", enabledFields: Object.keys(row.values || {}), ...row })));
    const snapshot = async () => JSON.stringify(await CheckinRequest.find({ _id: { $in: rows.map((row) => row._id) } }).sort({ _id: 1 }).lean());
    const before = await snapshot();
    const result = await request();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const overview = result.body;
    assert.deepEqual(overview.checkins, { pendingReviewCount: 1, waitingResponseCount: 1, overdueResponseCount: 2, lastResponseAt: hoursFromNow(-2).toISOString() });
    const wellbeing = Object.fromEntries(overview.wellbeing.map((item) => [item.key, item]));
    assert.equal(wellbeing.comment.value, "Última respuesta");
    assert.equal(wellbeing.general_fatigue.displayValue, "Cansado por la tarde, dentro de lo normal");
    assert.equal(wellbeing.sleep_hours.value, 0);
    assert.equal(wellbeing.sleep_quality.value, 4);
    assert.equal(wellbeing.sleep_quality.requestId, String(rows[1]._id));
    assert.equal(wellbeing.recovery_between_sessions.requestId, String(rows[1]._id));
    const review = { requestId: "review_checkins_0001", conclusion: "Seguimiento comprobado", nextStep: "Continuar el plan", observedFingerprint: overview.review.observedFingerprint, observedAt: overview.review.observedAt };
    const saved = await request(`${base}/reviews`, "POST", review);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal((await request()).body.review.hasNewData, false);
    assert.equal(await snapshot(), before, "La revisión privada no debe cambiar ningún checkin");
    await CheckinRequest.updateOne({ _id: rows[0]._id }, { $set: { "values.comment": "Respuesta actualizada", respondedAt: new Date() } });
    const fresh = (await request()).body;
    assert.equal(fresh.review.hasNewData, true);
    assert.equal(fresh.wellbeing.find((item) => item.key === "comment").value, "Respuesta actualizada");

    // Las rutas antiguas siguen alimentando la ficha junto a /overview.
    // Usar el DAO real detecta contratos retirados (como getAppliedConfig).
    const summary = await request(`/trainer/clients/${client}/summary`);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.ok(summary.body.checkinRequests.some((row) => row._id === String(rows[0]._id)));
    assert.ok(!summary.body.checkinRequests.some((row) => row._id === String(rows[8]._id)));
    const adherence = summary.body.adherence.dimensions.checkins;
    const answered = summary.body.checkinRequests.filter((row) => ["responded", "reviewed"].includes(row.status)).length;
    assert.equal(adherence.applicable, true);
    assert.ok(answered >= 2);
    assert.equal(adherence.answered, answered);
    assert.equal(adherence.missed, 2);
    assert.equal(adherence.percentage, Math.round(answered / (answered + 2) * 100));
    const progress = await request(`/trainer/clients/${client}/progress?weeks=4`);
    assert.equal(progress.status, 200, JSON.stringify(progress.body));
    assert.equal(progress.body.weeks, 4);
    assert.equal(progress.body.series.length, 4);
  });

  await t.test("mediciones por API: fecha civil exacta, límites inclusivos y rango inválido", async () => {
    const { todayIsoDate, addDaysToIsoDate } = require("../util/date-util");
    const today = todayIsoDate();
    const oldDate = addDaysToIsoDate(today, -120);
    const rows = await mongoose.models.Anthropometry.create([
      { userId: client, date: oldDate, weight: 75 },
      { userId: client, date: addDaysToIsoDate(today, -121), weight: 74 },
      { userId: client, date: addDaysToIsoDate(today, -91), weight: 76 },
      { userId: client, date: addDaysToIsoDate(today, -90), weight: 77 },
      { userId: client, date: today, weight: 78 },
      { userId: client, date: addDaysToIsoDate(today, 1), weight: 79 },
      { userId: otherClient, date: oldDate, weight: 99 },
    ]);
    const path = `/trainer/clients/${client}/anthropometry`;
    const exact = await request(`${path}?minDate=${oldDate}&maxDate=${oldDate}`);
    assert.equal(exact.status, 200, JSON.stringify(exact.body));
    assert.deepEqual(exact.body.map((row) => ({ id: row._id, date: row.date, weight: row.weight })), [{ id: String(rows[0]._id), date: oldDate, weight: 75 }]);
    const ranged = await request(`${path}?minDate=${oldDate}&maxDate=${today}`);
    assert.equal(ranged.status, 200, JSON.stringify(ranged.body));
    assert.ok(ranged.body.some((row) => row._id === String(rows[0]._id)));
    assert.ok(ranged.body.some((row) => row._id === String(rows[4]._id)));
    assert.ok(!ranged.body.some((row) => [rows[1], rows[5], rows[6]].some((outside) => row._id === String(outside._id))));
    assert.deepEqual(ranged.body.map((row) => row.date), ranged.body.map((row) => row.date).sort().reverse());
    const defaults = await request(path);
    assert.equal(defaults.status, 200, JSON.stringify(defaults.body));
    assert.ok(defaults.body.some((row) => row._id === String(rows[3]._id)));
    assert.ok(defaults.body.some((row) => row._id === String(rows[4]._id)));
    assert.ok(!defaults.body.some((row) => [rows[0], rows[1], rows[2], rows[5]].some((outside) => row._id === String(outside._id))));
    const maximumOnly = await request(`${path}?maxDate=${oldDate}`);
    assert.deepEqual(maximumOnly.body.map((row) => row._id), [String(rows[0]._id), String(rows[1]._id)]);
    const minimumOnly = await request(`${path}?minDate=${today}`);
    assert.deepEqual(minimumOnly.body.map((row) => row._id), [String(rows[4]._id)]);
    for (const query of ["minDate=no-date", "maxDate=2026-02-30", "minDate=2026-09-11&maxDate=2026-09-10", "minDate=2026-09-10&minDate=2026-09-11", "minDate="]) {
      assert.equal((await request(`${path}?${query}`)).status, 400, query);
    }
    assert.equal((await request(`${path}?minDate=${oldDate}&maxDate=${oldDate}`, "GET", undefined, "stranger")).status, 403);
  });

  await t.test("borrado elimina los datos nuevos de la cuenta y conserva otros clientes", async () => {
    const { deleteForUser } = require("./overview-cleanup");
    const otherProfile = await mongoose.connection.collection("clientmeasurementprofiles").insertOne({ clientId: otherClient, timeZone: "UTC" });
    await mongoose.connection.collection("clientmeasurementprofiles").updateOne({ clientId: client }, { $set: { timeZone: "Europe/Madrid" } }, { upsert: true });
    const unrelatedTasks = await Task.countDocuments({ clientId: otherClient });
    await deleteForUser(client);
    for (const name of ["coachingstages", "clientoverviewreviews", "clientoverviewaudits", "coachtasks", "measurementcorrections", "clientmeasurementprofiles"]) {
      assert.equal(await mongoose.connection.collection(name).countDocuments({ clientId: client }), 0, name);
    }
    assert.equal(await Task.countDocuments({ clientId: otherClient }), unrelatedTasks);
    assert.equal(await mongoose.connection.collection("clientmeasurementprofiles").countDocuments({ _id: otherProfile.insertedId }), 1);
  });
});
