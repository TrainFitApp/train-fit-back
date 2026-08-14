const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-checkin-reminders]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-025 (MASTER_BACKLOG.md) — confirma la lógica de findDueReminders()
// (qué configuraciones "tocan" recordatorio) sin enviar ningún email real:
// - un cliente que respondió hace poco NO debe estar "due".
// - un cliente que respondió hace más de 7 días (weekly) SÍ debe estarlo.
// - "biweekly" respeta 14 días, no 7.
// - una configuración ya recordada para este ciclo no vuelve a salir.
// - "once" nunca sale (fuera del alcance de cadence recurrente).
// sendReminder()/runReminderJob() (que sí envían email vía SES) se
// verifican por revisión de código, no aquí — no tiene sentido disparar
// envíos SES reales contra direcciones de prueba en un script automatizado.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerCheckinTemplate = require("../components/trainerCheckins/trainer-checkin-template-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const { findDueReminders } = require("../components/trainerCheckins/checkin-reminder-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, clients: [], configs: [], responses: [] };

  const now = new Date("2026-08-13T09:00:00.000Z");
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  try {
    created.trainer = await userSchema.create({ email: `verify-reminders-t-${runId}@test.local` });

    async function makeClientWithConfig({ label, cadence, lastResponseDaysAgo, configUpdatedDaysAgo, lastReminderDaysAgo }) {
      const client = await userSchema.create({
        email: `verify-reminders-${label}-${runId}@test.local`,
        name: label,
        lastname: "Prueba",
      });
      created.clients.push(client);

      const config = await TrainerCheckinTemplate.create({
        trainerId: created.trainer._id,
        clientId: client._id,
        enabledFields: [],
        cadence,
        updatedAt: daysAgo(configUpdatedDaysAgo),
        lastReminderSentAt: lastReminderDaysAgo != null ? daysAgo(lastReminderDaysAgo) : null,
      });
      created.configs.push(config);

      if (lastResponseDaysAgo != null) {
        const resp = await CheckinResponse.create({
          trainerId: created.trainer._id,
          clientId: client._id,
          respondedAt: daysAgo(lastResponseDaysAgo),
          values: { mood: 7 },
        });
        created.responses.push(resp);
      }

      return { client, config };
    }

    // 1. Respondió hace 2 días, cadence weekly (7d) — NO debe tocar.
    const recent = await makeClientWithConfig({
      label: "recent",
      cadence: "weekly",
      lastResponseDaysAgo: 2,
      configUpdatedDaysAgo: 20,
    });

    // 2. Respondió hace 10 días, cadence weekly (7d) — SÍ debe tocar.
    const overdue = await makeClientWithConfig({
      label: "overdue",
      cadence: "weekly",
      lastResponseDaysAgo: 10,
      configUpdatedDaysAgo: 20,
    });

    // 3. Respondió hace 10 días, cadence biweekly (14d) — NO debe tocar todavía.
    const biweeklyOk = await makeClientWithConfig({
      label: "biweekly-ok",
      cadence: "biweekly",
      lastResponseDaysAgo: 10,
      configUpdatedDaysAgo: 20,
    });

    // 4. Respondió hace 15 días, cadence biweekly (14d) — SÍ debe tocar.
    const biweeklyOverdue = await makeClientWithConfig({
      label: "biweekly-overdue",
      cadence: "biweekly",
      lastResponseDaysAgo: 15,
      configUpdatedDaysAgo: 30,
    });

    // 5. Nunca respondió, plantilla aplicada hace 10 días, weekly — SÍ debe tocar
    // (ancla en updatedAt cuando no hay respuesta previa).
    const neverResponded = await makeClientWithConfig({
      label: "never-responded",
      cadence: "weekly",
      lastResponseDaysAgo: null,
      configUpdatedDaysAgo: 10,
    });

    // 6. Overdue pero YA se le recordó DESPUÉS de que tocara — no debe repetirse.
    const alreadyReminded = await makeClientWithConfig({
      label: "already-reminded",
      cadence: "weekly",
      lastResponseDaysAgo: 10,
      configUpdatedDaysAgo: 20,
      lastReminderDaysAgo: 1, // recordado ayer, después de que tocara hace 3 días (10-7)
    });

    const due = await findDueReminders(now);
    const dueClientIds = due.map((d) => String(d.config.clientId._id));

    assert.ok(!dueClientIds.includes(String(recent.client._id)), "cliente reciente NO debe estar due");
    ok("cliente que respondió hace poco no sale como due (weekly)");

    assert.ok(dueClientIds.includes(String(overdue.client._id)), "cliente overdue SÍ debe estar due");
    ok("cliente que respondió hace más de 7 días sale como due (weekly)");

    assert.ok(!dueClientIds.includes(String(biweeklyOk.client._id)), "biweekly a 10 días NO debe estar due");
    ok("biweekly respeta 14 días, no 7 (a los 10 días no toca)");

    assert.ok(dueClientIds.includes(String(biweeklyOverdue.client._id)), "biweekly a 15 días SÍ debe estar due");
    ok("biweekly a 15 días sí toca");

    assert.ok(dueClientIds.includes(String(neverResponded.client._id)), "sin respuesta previa, ancla en updatedAt");
    ok("cliente sin ninguna respuesta previa usa updatedAt de la config como ancla");

    assert.ok(!dueClientIds.includes(String(alreadyReminded.client._id)), "ya recordado para este ciclo, no debe repetirse");
    ok("no repite un recordatorio ya enviado para el mismo ciclo de vencimiento");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.responses.length) {
      await CheckinResponse.deleteMany({ _id: { $in: created.responses.map((r) => r._id) } });
    }
    if (created.configs.length) {
      await TrainerCheckinTemplate.deleteMany({ _id: { $in: created.configs.map((c) => c._id) } });
    }
    if (created.clients.length) {
      await userSchema.deleteMany({ _id: { $in: created.clients.map((c) => c._id) } });
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
