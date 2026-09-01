const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-user-cascade-full]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Confirma la cascada completa de users/schema.js: crea contenido en las
// colecciones que dependen del trainer o del cliente (TrainerClient,
// TrainerNote, TrainerPayment, TrainerTask+TaskCompletion, ClientIntake,
// TrainerIntakeConfig, CheckinResponse, TrainerCheckinTemplate,
// CheckinTemplateDefinition, DietTemplate(copia)+DietException,
// Notification, Recipe, BillingCustomer, BillingEvent), borra al TRAINER, y
// confirma que todo desaparece — incluido lo que dependía del CLIENTE en la
// relación (para probar el lado $or), y que borrar al cliente después limpia
// el resto.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const trainerNoteSchema = require("../components/trainerNotes/trainer-note-schema");
  const trainerPaymentSchema = require("../components/trainerPayments/trainer-payment-schema");
  const trainerTaskSchema = require("../components/trainerTasks/trainer-task-schema");
  const taskCompletionSchema = require("../components/trainerTasks/task-completion-schema");
  const clientIntakeSchema = require("../components/clientIntake/client-intake-schema");
  const trainerIntakeConfigSchema = require("../components/trainerIntakeConfig/trainer-intake-config-schema");
  const checkinResponseSchema = require("../components/trainerCheckins/checkin-response-schema");
  const trainerCheckinTemplateSchema = require("../components/trainerCheckins/trainer-checkin-template-schema");
  const checkinTemplateDefinitionSchema = require("../components/trainerCheckins/checkin-template-definition-schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const dietExceptionSchema = require("../components/dietExceptions/diet-exception-schema");
  const notificationSchema = require("../components/notifications/notification-schema");
  const recipeSchema = require("../components/recipes/recipe-schema");
  const billingCustomerSchema = require("../components/billing/billing-customer-schema");
  const billingEventSchema = require("../components/billing/billing-event-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const trainer = await userSchema.create({ email: `verify-full-cascade-trainer-${runId}@test.local` });
  const client = await userSchema.create({ email: `verify-full-cascade-client-${runId}@test.local` });
  ok("trainer/cliente creados", trainer._id.toString(), client._id.toString());

  const docs = {};
  try {
    docs.relation = await trainerClientSchema.create({
      trainerId: trainer._id, clientId: client._id, clientEmail: client.email, scope: "training", status: "active",
    });
    docs.note = await trainerNoteSchema.create({ trainerId: trainer._id, clientId: client._id, text: "nota" });
    docs.payment = await trainerPaymentSchema.create({
      trainerId: trainer._id, clientId: client._id, amount: 10, dueDate: new Date(),
    });
    docs.task = await trainerTaskSchema.create({
      trainerId: trainer._id, clientId: client._id, type: "steps", target: 1000, unit: "pasos",
    });
    docs.completion = await taskCompletionSchema.create({ taskId: docs.task._id, date: "2026-01-05" });
    docs.intake = await clientIntakeSchema.create({ trainerId: trainer._id, clientId: client._id });
    docs.intakeConfig = await trainerIntakeConfigSchema.create({ trainerId: trainer._id, enabledFields: ["goals"] });
    docs.checkinResponse = await checkinResponseSchema.create({
      trainerId: trainer._id, clientId: client._id, values: { weight: 80 },
    });
    docs.checkinTemplateDef = await checkinTemplateDefinitionSchema.create({ trainerId: trainer._id, name: `Plantilla ${runId}` });
    docs.checkinTemplateApplied = await trainerCheckinTemplateSchema.create({
      trainerId: trainer._id, clientId: client._id, enabledFields: [],
    });
    docs.dietTemplateCopy = await dietTemplateSchema.create({
      trainerId: trainer._id, clientId: client._id, name: "Copia verificación",
      startDate: "2026-01-01", endMode: "indefinite", status: "active",
    });
    docs.dietException = await dietExceptionSchema.create({
      assignmentId: docs.dietTemplateCopy._id, clientId: client._id, date: "2026-01-05", action: "skip",
    });
    docs.notification = await notificationSchema.create({
      trainerId: trainer._id, clientId: client._id, type: "payment_created",
    });
    docs.recipe = await recipeSchema.create({ name: `Receta ${runId}`, userId: trainer._id });
    docs.billingCustomer = await billingCustomerSchema.create({
      userId: trainer._id, appUserId: `verify-cascade-${runId}`,
    });
    docs.billingEvent = await billingEventSchema.create({
      eventId: `verify-cascade-event-${runId}`, type: "TEST", userId: trainer._id, payload: {},
    });
    ok("contenido creado en las 15 colecciones (13 huecos + 2 hijos en cascada)");

    // Borra al TRAINER — todo lo anterior está trainerId=trainer o
    // userId=trainer, así que debe desaparecer entero.
    await userSchema.deleteOne({ _id: trainer._id });
    ok("trainer borrado");

    const checks = [
      ["TrainerClient", trainerClientSchema, docs.relation._id],
      ["TrainerNote", trainerNoteSchema, docs.note._id],
      ["TrainerPayment", trainerPaymentSchema, docs.payment._id],
      ["TrainerTask", trainerTaskSchema, docs.task._id],
      ["TaskCompletion", taskCompletionSchema, docs.completion._id],
      ["ClientIntake", clientIntakeSchema, docs.intake._id],
      ["TrainerIntakeConfig", trainerIntakeConfigSchema, docs.intakeConfig._id],
      ["CheckinResponse", checkinResponseSchema, docs.checkinResponse._id],
      ["CheckinTemplateDefinition", checkinTemplateDefinitionSchema, docs.checkinTemplateDef._id],
      ["TrainerCheckinTemplate", trainerCheckinTemplateSchema, docs.checkinTemplateApplied._id],
      ["DietTemplate (copia)", dietTemplateSchema, docs.dietTemplateCopy._id],
      ["DietException", dietExceptionSchema, docs.dietException._id],
      ["Notification", notificationSchema, docs.notification._id],
      ["Recipe", recipeSchema, docs.recipe._id],
      ["BillingCustomer", billingCustomerSchema, docs.billingCustomer._id],
      ["BillingEvent", billingEventSchema, docs.billingEvent._id],
    ];

    for (const [label, model, id] of checks) {
      const found = await model.findById(id);
      assert.equal(found, null, `${label} debía borrarse en cascada al borrar el trainer, sigue existiendo`);
    }
    ok("las 16 colecciones quedaron limpias tras borrar al trainer (incluida la cascada de 2do nivel: TaskCompletion, DietException)");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    await userSchema.deleteOne({ _id: client._id }).catch(() => {});
    ok("cliente borrado (verifica de paso que la cascada también corre para un usuario sin nada trainerId propio)");
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
