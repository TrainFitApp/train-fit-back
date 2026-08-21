const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Schema = mongoose.Schema;
const dietSchema = require("../diets/diet-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const tableSchema = require("../tables/table-schema");
const productSchema = require("../products/product-schema");
const anthropometrySchemaDef = require("../anthropometry/anthropometry-schema");
// anthropometry-schema.js exporta el Schema crudo a propósito (cada
// consumidor lo compila); aquí hace falta el modelo compilado para poder
// usar .deleteMany(), no el Schema en sí.
const anthropometrySchema =
  mongoose.models.Anthropometry ||
  mongoose.model("Anthropometry", anthropometrySchemaDef);
const nutritionalGoalSchema = require("../nutritionalGoals/nutritional-goal-schema");
const workoutSchema = require("../workouts/workout-schema");
const mealSchema = require("../meals/meal-schema");
const dietTemplateSchema = require("../dietTemplates/diet-template-schema");
// Auditoría cascadas de borrado (2026-08) — ninguna de estas colecciones
// "Coach tab" tenía limpieza al borrar cuenta, hueco preexistente arrastrado
// desde que se fueron añadiendo feature a feature (mismo problema que tenía
// DietTemplate antes de esta pasada).
const trainerClientSchema = require("../trainerClients/trainer-client-schema");
const trainerNoteSchema = require("../trainerNotes/trainer-note-schema");
const trainerPaymentSchema = require("../trainerPayments/trainer-payment-schema");
const trainerTaskSchema = require("../trainerTasks/trainer-task-schema");
const clientIntakeSchema = require("../clientIntake/client-intake-schema");
const trainerIntakeConfigSchema = require("../trainerIntakeConfig/trainer-intake-config-schema");
const checkinResponseSchema = require("../trainerCheckins/checkin-response-schema");
const trainerCheckinTemplateSchema = require("../trainerCheckins/trainer-checkin-template-schema");
const checkinTemplateDefinitionSchema = require("../trainerCheckins/checkin-template-definition-schema");
const planAssignmentSchema = require("../planAssignments/plan-assignment-schema");
const notificationSchema = require("../notifications/notification-schema");
const recipeSchema = require("../recipes/recipe-schema");
const billingCustomerSchema = require("../billing/billing-customer-schema");
const billingEventSchema = require("../billing/billing-event-schema");
const { EMAIL_FORMAT_REGEX } = require("../util/normalize-email");
const SALT_WORK_FACTOR = 10;

const UserSchema = new Schema({
  // trim/lowercase son setters de Mongoose: se aplican tanto al guardar
  // (create/save/update) como al castear condiciones de find/findOne/exists,
  // así que "David@Gmail.com" y "david@gmail.com" quedan garantizados como el
  // mismo valor en cualquier operación que pase por este schema.
  email: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    lowercase: true,
    match: [EMAIL_FORMAT_REGEX, "Formato de email inválido"],
  },
  appleId: { type: String, unique: true, sparse: true },
  password: String,
  name: { type: String, trim: true, maxlength: 100 },
  lastname: { type: String, trim: true, maxlength: 200 },
  weight: { type: Number, min: 30, max: 300 },
  height: { type: Number, min: 70, max: 300 },
  status: String,
  roles: { type: [String], default: undefined },
  sex: Number,
  activity: Number,
  objetive: Number,
  steps: Number,
  stepGoal: Number,
  training: Number,
  birth: Date,
  goalInUse: {
    type: Schema.Types.ObjectId,
    ref: "NutritionalGoal",
  },
  hash: String,
  hashExpiresAt: Date,
  hashFailedAttempts: { type: Number, default: 0 },
  lastHashSentAt: Date,
  restoreCodeExpiresAt: Date,
  restoreFailedAttempts: { type: Number, default: 0 },
  lastRestoreCodeSentAt: Date,
  restoreCodeDate: Date,
  restoreCodeDailyCount: { type: Number, default: 0 },
  restoreCode: String,
  theme: { type: String, default: "dark" },
  dietInUse: Schema.Types.ObjectId,
  tableInUse: Schema.Types.ObjectId,
  workoutInUse: Schema.Types.ObjectId,
  archivedProducts: { type: [Schema.Types.ObjectId], default: [] },
  archivedRecipes: { type: [Schema.Types.ObjectId], default: [] },
  archivedExercises: { type: [Schema.Types.ObjectId], default: [] },
  personalAds: Boolean,
  lastLogin: Date,
  premium: {
    entitled: { type: Boolean, default: false },
    plan: String,
    expiresAt: Date,
    source: String,
    lastSyncAt: Date,
  },
  // MVP-trainers F02: entitlement de `TrainFit: Entrenadores`, separado de
  // `premium` (consumidor) a propósito — un mismo User puede en teoría ser
  // profesional Y cliente (ver F27), y cada suscripción es independiente.
  // Misma forma que `premium` para reutilizar la misma lógica de sync.
  professionalPremium: {
    entitled: { type: Boolean, default: false },
    plan: String,
    // "trainer_pro" | "trainer_unlimited" — determina el límite de clientes
    // aplicable (ver feature-access-service.js#getTrainerLimits).
    tier: String,
    expiresAt: Date,
    source: String,
    lastSyncAt: Date,
  },
  passwordVersion: { type: Number, default: 0 },
  lastPasswordChangeAt: Date,
  auth: {
    sessionId: { type: String, default: null, index: true },
    refreshTokenHash: { type: String, default: null },
    refreshExpiresAt: { type: Date, default: null },
    clientFamily: { type: String, default: null },
    platform: { type: String, default: null },
    issuedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    impersonatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    impersonatedFromSessionId: { type: String, default: null },
  },
  provider: String,
  lang: { type: String, default: 'es' },
});

UserSchema.plugin(require("mongoose-autopopulate"));

UserSchema.pre("save", function (next) {
  let user = this;
  if (!user.isModified("password")) return next();

  user.lastPasswordChangeAt = new Date();
  if (user.isNew) {
    user.passwordVersion = user.passwordVersion > 0 ? user.passwordVersion : 1;
  } else {
    user.passwordVersion = (user.passwordVersion || 0) + 1;
  }

  // generate a salt
  bcrypt.genSalt(SALT_WORK_FACTOR, function (err, salt) {
    if (err) return next(err);

    // hash the password using our new salt
    bcrypt.hash(user.password, salt, function (err, hash) {
      if (err) return next(err);
      // override the cleartext password with the hashed one
      user.password = hash;
      next();
    });
  });
});

// Middleware para eliminar las referencias al eliminar un usuario con deleteOne
UserSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const user = await this.model.findOne(query);

    if (user) {
      if (user.dietInUse) await dietSchema.deleteOne({ _id: user.dietInUse });
      await tableSchema.deleteMany({ userId: user._id });
      await anthropometrySchema.deleteMany({ userId: user._id });

      const ownExercises = await exerciseSchema
        .find({ userId: user._id })
        .select("_id")
        .lean();

      for (const exercise of ownExercises) {
        await exerciseSchema.deleteOne({ _id: exercise._id });
      }

      await productSchema.deleteMany({ userId: user._id });
      await nutritionalGoalSchema.deleteMany({ userId: user._id });
      // Plantillas de workout del trainer (trainerId set, sin split que las
      // referencie) — el hook pre('deleteMany') de workout-schema.js ya
      // cascada el borrado de sus CustomExercise/Set.
      await workoutSchema.deleteMany({ trainerId: user._id });
      // Snippets de comida del trainer (trainerId set, sin DietDay que los
      // referencie) — el hook pre('deleteMany') de meal-schema.js ya
      // cascada el borrado de sus CustomProduct/CustomRecipe.
      await mealSchema.deleteMany({ trainerId: user._id });
      // Plantillas de dieta del trainer — hueco preexistente (nunca se
      // limpiaban al borrar la cuenta). El hook pre('deleteMany') de
      // diet-template-schema.js ya cascada el borrado de sus
      // CustomProduct/CustomRecipe.
      await dietTemplateSchema.deleteMany({ trainerId: user._id });

      // El usuario puede ser el trainer O el cliente de cada una de estas
      // relaciones — hay que limpiar por ambos lados.
      await trainerClientSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await trainerNoteSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await trainerPaymentSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      // deleteMany (no deleteOne) dispara el hook en cascada de
      // trainer-task-schema.js que borra los TaskCompletion de cada tarea.
      await trainerTaskSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await clientIntakeSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await checkinResponseSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await trainerCheckinTemplateSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await notificationSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      // deleteMany (no deleteOne) dispara el hook en cascada de
      // plan-assignment-schema.js que borra las DietException de cada plan.
      await planAssignmentSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });

      // Config/biblioteca solo del lado trainer (sin clientId).
      await trainerIntakeConfigSchema.deleteMany({ trainerId: user._id });
      await checkinTemplateDefinitionSchema.deleteMany({ trainerId: user._id });

      // Recetas propias del usuario (no verificadas por admin) — nunca
      // tuvieron hook de borrado propio.
      await recipeSchema.deleteMany({ userId: user._id });

      // Billing — decisión explícita: se borra igual que el resto, no se
      // conserva como histórico tras borrar la cuenta.
      await billingCustomerSchema.deleteMany({ userId: user._id });
      await billingEventSchema.deleteMany({ userId: user._id });
    }
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.model("User", UserSchema);
