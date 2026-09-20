const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-invite-reminder]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-065 (MASTER_BACKLOG.md) — confirma que findDueReminders:
// - NO toca invitaciones "pending" recientes (menos de REMINDER_AFTER_DAYS).
// - SÍ encuentra invitaciones "pending" con más de REMINDER_AFTER_DAYS sin respuesta.
// - NO repite una invitación ya recordada (lastReminderSentAt ya puesto).
// - NO toca relaciones en otros estados (cuestionario_pendiente/en_revision/active/etc),
//   aunque sean igual de antiguas — el recordatorio es solo para "pending" real.
// Deliberadamente NO llama a sendReminder/runReminderJob (evita un envío SES real),
// mismo criterio que el resto de scripts verify-*.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const { REMINDER_AFTER_DAYS, findDueReminders } = require("../components/trainerClients/invite-reminder-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, relations: [] };

  const now = new Date();
  const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    created.trainer = await userSchema.create({
      email: `verify-invite-reminder-t-${runId}@test.local`,
      name: "Trainer",
      lastname: "Prueba",
    });

    const recentPending = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientEmail: `verify-invite-recent-${runId}@test.local`,
      scope: "training",
      status: "pending",
      invitedAt: addDays(now, -1),
    });
    created.relations.push(recentPending);

    const stalePending = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientEmail: `verify-invite-stale-${runId}@test.local`,
      scope: "nutrition",
      status: "pending",
      invitedAt: addDays(now, -(REMINDER_AFTER_DAYS + 1)),
    });
    created.relations.push(stalePending);

    const alreadyReminded = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientEmail: `verify-invite-reminded-${runId}@test.local`,
      scope: "training",
      status: "pending",
      invitedAt: addDays(now, -(REMINDER_AFTER_DAYS + 5)),
      lastReminderSentAt: addDays(now, -1),
    });
    created.relations.push(alreadyReminded);

    const staleButActive = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientEmail: `verify-invite-active-${runId}@test.local`,
      scope: "nutrition",
      status: "active",
      invitedAt: addDays(now, -(REMINDER_AFTER_DAYS + 10)),
    });
    created.relations.push(staleButActive);

    const due = await findDueReminders(now);
    const dueIds = due.map((r) => String(r._id));

    assert.ok(!dueIds.includes(String(recentPending._id)), "invitación reciente no debe salir todavía");
    ok("invitación pending reciente (< límite de días) → no sale");

    assert.ok(dueIds.includes(String(stalePending._id)), "invitación antigua sin recordar debe salir");
    ok("invitación pending antigua sin recordatorio previo → sale");

    assert.ok(!dueIds.includes(String(alreadyReminded._id)), "invitación ya recordada no debe repetirse");
    ok("invitación ya recordada (lastReminderSentAt ya puesto) → no se repite");

    assert.ok(!dueIds.includes(String(staleButActive._id)), "una relación activa nunca es un recordatorio de invitación");
    ok("relación en otro estado (active), aunque antigua → no sale");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
    }
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
    ok("datos de prueba borrados");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
