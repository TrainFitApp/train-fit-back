const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-anthropometry-requests]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Verifica la feature "solicitar antropometría" (independiente de check-ins):
// 1. upsert() crea un doc active:true, cadence:'once'.
// 2. findByTrainerAndClient() lo devuelve.
// 3. markFulfilledForClient() desactiva la petición 'once' y marca lastFulfilledAt.
// 4. cadence 'weekly' vencida (>7d) sale en findDueReminders(); runReminderJob()
//    crea una Notification "anthropometry_requested" y marca lastReminderSentAt;
//    una segunda llamada a findDueReminders() ya no la repite (mismo ciclo).
// 5. cadence 'custom' con customIntervalDays:3, vencida a los 5 días, igual que 4.
// 6. la validación de schema rechaza fields:[] y fields con claves no catalogadas.
//
// Un trainer solo puede tener UNA petición activa por cliente (índice único
// {trainerId,clientId}), así que cada check que necesita su propio doc usa un
// cliente de prueba distinto en vez de reutilizar el mismo par trainer/cliente.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const AnthropometryRequest = require("../components/anthropometryRequests/anthropometry-request-schema");
  const anthropometryRequestDao = require("../components/anthropometryRequests/anthropometry-request-dao");
  const anthropometryRequestReminderService = require("../components/anthropometryRequests/anthropometry-request-reminder-service");
  const Notification = require("../components/notifications/notification-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { users: [], requests: [], notifications: [] };

  const results = [];
  const report = (n, label, passed) => {
    results.push({ n, label, passed });
    if (passed) ok(`check ${n}: ${label}`);
    else console.error(`${LOG_PREFIX} FAIL check ${n}: ${label}`);
  };

  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  const makeUser = async (label) => {
    const u = await userSchema.create({
      email: `verify-anthreq-${label}-${runId}@test.local`,
      name: label,
      lastname: "Prueba",
    });
    created.users.push(u._id);
    return u;
  };

  try {
    const trainer = await makeUser("trainer");
    const client = await makeUser("client-once");
    const clientWeekly = await makeUser("client-weekly");
    const clientCustom = await makeUser("client-custom");
    const trainerId = trainer._id;
    const clientId = client._id;
    ok("usuarios de prueba creados");

    // --- Check 1: upsert crea doc active:true, cadence:'once' ---
    const upserted = await anthropometryRequestDao.upsert(trainerId, clientId, {
      fields: ["weight", "perimeter_waist"],
      notes: "",
      cadence: "once",
      customIntervalDays: null,
    });
    created.requests.push(upserted._id);
    report(
      1,
      "upsert crea doc active:true cadence:'once'",
      upserted.active === true && upserted.cadence === "once"
    );

    // --- Check 2: findByTrainerAndClient lo devuelve ---
    const found = await anthropometryRequestDao.findByTrainerAndClient(trainerId, clientId);
    report(
      2,
      "findByTrainerAndClient devuelve el doc creado",
      !!found && String(found._id) === String(upserted._id)
    );

    // --- Check 3: markFulfilledForClient desactiva 'once' ---
    await anthropometryRequestDao.markFulfilledForClient(clientId);
    const afterFulfilled = await anthropometryRequestDao.findByTrainerAndClient(trainerId, clientId);
    report(
      3,
      "markFulfilledForClient desactiva 'once' y marca lastFulfilledAt",
      afterFulfilled.active === false && !!afterFulfilled.lastFulfilledAt
    );

    // --- Check 4: cadence 'weekly' vencida sale en findDueReminders, se recuerda, no se repite ---
    const weeklyDoc = await AnthropometryRequest.create({
      trainerId,
      clientId: clientWeekly._id,
      fields: ["weight"],
      notes: "",
      cadence: "weekly",
      customIntervalDays: null,
    });
    created.requests.push(weeklyDoc._id);
    // Backdate directo en el schema, simulando "pedido hace 10 días, nunca cumplido".
    await AnthropometryRequest.updateOne(
      { _id: weeklyDoc._id },
      { $set: { lastRequestedAt: daysAgo(10) } }
    );

    const dueBefore = await anthropometryRequestReminderService.findDueReminders(new Date());
    const weeklyDueBefore = dueBefore.some((d) => String(d.request._id) === String(weeklyDoc._id));

    const jobResult = await anthropometryRequestReminderService.runReminderJob(new Date());
    const notifAfterJob = await Notification.findOne({
      clientId: clientWeekly._id,
      trainerId,
      type: "anthropometry_requested",
    }).lean();
    if (notifAfterJob) created.notifications.push(notifAfterJob._id);

    const weeklyAfterJob = await AnthropometryRequest.findById(weeklyDoc._id).lean();

    const dueAfter = await anthropometryRequestReminderService.findDueReminders(new Date());
    const weeklyDueAfter = dueAfter.some((d) => String(d.request._id) === String(weeklyDoc._id));

    report(
      4,
      "weekly vencida (10d>7d) sale due, runReminderJob crea Notification y marca lastReminderSentAt, no se repite",
      weeklyDueBefore === true &&
        jobResult.sent >= 1 &&
        !!notifAfterJob &&
        !!weeklyAfterJob.lastReminderSentAt &&
        weeklyDueAfter === false
    );

    // --- Check 5: cadence 'custom' con customIntervalDays:3, vencida a los 5 días ---
    const customDoc = await AnthropometryRequest.create({
      trainerId,
      clientId: clientCustom._id,
      fields: ["weight"],
      notes: "",
      cadence: "custom",
      customIntervalDays: 3,
    });
    created.requests.push(customDoc._id);
    await AnthropometryRequest.updateOne(
      { _id: customDoc._id },
      { $set: { lastRequestedAt: daysAgo(5) } }
    );

    const dueCustomBefore = await anthropometryRequestReminderService.findDueReminders(new Date());
    const customDueBefore = dueCustomBefore.some((d) => String(d.request._id) === String(customDoc._id));

    const customJobResult = await anthropometryRequestReminderService.runReminderJob(new Date());
    const customNotif = await Notification.findOne({
      clientId: clientCustom._id,
      trainerId,
      type: "anthropometry_requested",
    }).lean();
    if (customNotif) created.notifications.push(customNotif._id);

    const customAfterJob = await AnthropometryRequest.findById(customDoc._id).lean();

    report(
      5,
      "custom (5d>3d) sale due y runReminderJob crea su Notification y marca lastReminderSentAt",
      customDueBefore === true &&
        customJobResult.sent >= 1 &&
        !!customNotif &&
        !!customAfterJob.lastReminderSentAt
    );

    // --- Check 6: schema rechaza fields:[] y fields con clave inválida ---
    const clientBadEmpty = await makeUser("client-bad-empty");
    const clientBadKey = await makeUser("client-bad-key");

    let rejectedEmpty = false;
    try {
      await AnthropometryRequest.create({
        trainerId,
        clientId: clientBadEmpty._id,
        fields: [],
        cadence: "once",
      });
    } catch (error) {
      rejectedEmpty = error instanceof mongoose.Error.ValidationError;
    }

    let rejectedBadKey = false;
    try {
      await AnthropometryRequest.create({
        trainerId,
        clientId: clientBadKey._id,
        fields: ["not_a_real_key"],
        cadence: "once",
      });
    } catch (error) {
      rejectedBadKey = error instanceof mongoose.Error.ValidationError;
    }

    // Por si alguna de las dos, contra toda expectativa, llegó a persistir.
    const strayDocs = await AnthropometryRequest.find({
      $or: [
        { trainerId, clientId: clientBadEmpty._id },
        { trainerId, clientId: clientBadKey._id },
      ],
    }).lean();
    for (const d of strayDocs) created.requests.push(d._id);

    report(
      6,
      "schema rechaza fields:[] y fields:['not_a_real_key'] (ValidationError, nada persiste)",
      rejectedEmpty && rejectedBadKey && strayDocs.length === 0
    );

    const allPassed = results.every((r) => r.passed);
    console.log(`${LOG_PREFIX} ${allPassed ? "PASS" : "FAIL"}`);
    if (!allPassed) process.exitCode = 1;
  } finally {
    log("limpiando datos de prueba...");
    if (created.notifications.length) {
      await Notification.deleteMany({ _id: { $in: created.notifications } });
    }
    if (created.requests.length) {
      await AnthropometryRequest.deleteMany({ _id: { $in: created.requests } });
    }
    if (created.users.length) {
      await userSchema.deleteMany({ _id: { $in: created.users } });
    }

    // Confirmación explícita: 0 documentos remanentes para estos ids de prueba.
    const remainingRequests = created.requests.length
      ? await AnthropometryRequest.countDocuments({ _id: { $in: created.requests } })
      : 0;
    const remainingNotifications = created.notifications.length
      ? await Notification.countDocuments({ _id: { $in: created.notifications } })
      : 0;
    const remainingUsers = created.users.length
      ? await userSchema.countDocuments({ _id: { $in: created.users } })
      : 0;
    log(
      `cleanup verificado: requests=${remainingRequests} notifications=${remainingNotifications} users=${remainingUsers} (deben ser 0)`
    );
    assert.equal(remainingRequests, 0, "quedaron AnthropometryRequest de prueba sin borrar");
    assert.equal(remainingNotifications, 0, "quedaron Notification de prueba sin borrar");
    assert.equal(remainingUsers, 0, "quedaron User de prueba sin borrar");
    ok("datos de prueba borrados y confirmados en 0");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
