const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-anthropometry-reminder-notification-type-fix]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Re-test dirigido al bug arreglado: Notification.type no incluía
// "anthropometry_requested", así que notificationDao.create() lanzaba
// ValidationError para CUALQUIER recordatorio vencido y
// runReminderJob() contaba todo como `failed`. El fix añadió
// "anthropometry_requested" al enum en
// components/notifications/notification-schema.js.
//
// Este script reproduce exactamente el camino que rompía:
// 1. Crea trainer/cliente de prueba.
// 2. upsert() una petición recurrente (weekly, fields:['weight']).
// 3. Backdatea lastRequestedAt 10 días atrás (vencida, nunca recordada).
// 4. runReminderJob() debe devolver sent:1/failed:0 sin excepción.
// 5. Confirma que existe la Notification con type "anthropometry_requested"
//    y que lastReminderSentAt quedó seteado en el AnthropometryRequest.
// 6. Limpia todo y confirma 0 documentos remanentes.
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
      email: `verify-anthreq-fix-${label}-${runId}@test.local`,
      name: label,
      lastname: "Prueba",
    });
    created.users.push(u._id);
    return u;
  };

  try {
    // --- Step 1: trainer + client de prueba ---
    const trainer = await makeUser("trainer");
    const client = await makeUser("client");
    ok("trainer y cliente de prueba creados", { trainerId: String(trainer._id), clientId: String(client._id) });

    // --- Step 2: upsert() petición recurrente weekly ---
    const upserted = await anthropometryRequestDao.upsert(trainer._id, client._id, {
      fields: ["weight"],
      notes: "",
      cadence: "weekly",
      customIntervalDays: null,
    });
    created.requests.push(upserted._id);
    report(
      "2",
      "upsert() crea petición recurrente weekly, fields:['weight']",
      upserted.active === true && upserted.cadence === "weekly" && Array.isArray(upserted.fields) && upserted.fields.includes("weight")
    );

    // --- Step 3: backdatea lastRequestedAt 10 días atrás (vencida) ---
    await AnthropometryRequest.updateOne(
      { _id: upserted._id },
      { $set: { lastRequestedAt: daysAgo(10) } }
    );
    const backdated = await AnthropometryRequest.findById(upserted._id).lean();
    report(
      "3",
      "lastRequestedAt backdateado a hace 10 días",
      backdated.lastRequestedAt.getTime() <= daysAgo(9).getTime()
    );

    // --- Step 4: runReminderJob() -- este es el camino que antes lanzaba
    // ValidationError dentro del try/catch de runReminderJob (por lo que no
    // se propagaba como excepción, pero SI contaba como `failed` y NO creaba
    // la Notification). Confirmamos que ahora no hay excepción y sent:1/failed:0.
    let jobResult;
    let jobThrew = null;
    try {
      jobResult = await anthropometryRequestReminderService.runReminderJob(new Date());
    } catch (error) {
      jobThrew = error;
    }
    report(
      "4",
      "runReminderJob() no lanza excepción y devuelve sent:1, failed:0",
      !jobThrew && jobResult && jobResult.sent === 1 && jobResult.failed === 0
    );
    if (jobThrew) log("runReminderJob() lanzó (no debería):", jobThrew.message);
    else log("jobResult:", jobResult);

    // --- Step 5: Notification con type "anthropometry_requested" existe,
    // y lastReminderSentAt quedó seteado ---
    const notif = await Notification.findOne({
      clientId: client._id,
      trainerId: trainer._id,
      type: "anthropometry_requested",
    }).lean();
    if (notif) created.notifications.push(notif._id);

    const afterJob = await AnthropometryRequest.findById(upserted._id).lean();

    report(
      "5",
      "Notification type:'anthropometry_requested' creada y lastReminderSentAt seteado",
      !!notif && notif.recipient === "client" && !!afterJob.lastReminderSentAt
    );

    const allPassed = results.every((r) => r.passed);
    console.log(`${LOG_PREFIX} ${allPassed ? "PASS" : "FAIL"}`);
    if (!allPassed) process.exitCode = 1;
  } finally {
    // --- Step 6: limpieza + confirmación post-cleanup ---
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
