const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Schema = mongoose.Schema;
const dietDaySchema = require("../dietDays/diet-days-schema");
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
const checkinTemplateDefinitionSchema = require("../trainerCheckins/checkin-template-definition-schema");
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
  // Refactor nutrición (2026-09) — la colección `diets` se elimina: era un
  // wrapper 1:1 con el usuario cuyo único contenido propio era `name`
  // (literalmente siempre "Diet", nunca renombrado desde ninguna app) y esta
  // nota. Los días se consultan ahora directos por DietDay.userId, sin array
  // intermedio. `dietInUse` se mantiene SOLO durante la migración y se borra
  // en el mismo script una vez copiada la nota.
  dietPinnedNote: { type: String, trim: true, maxlength: 500 },
  // `dietInUse` hacía doble trabajo: puntero al wrapper Y interruptor de
  // "dieta activada" (playStopDiet lo ponía/quitaba). El puntero desaparece
  // con el wrapper; el interruptor se queda, ahora explícito. Por defecto
  // activada, que es como se comportaba todo usuario existente.
  dietEnabled: { type: Boolean, default: true },
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
    stripeRevision: Number,
    stripeMode: String,
  },
  // Clientes que el entrenador mantiene activos cuando supera el cupo de su
  // plan; el resto queda en solo lectura (ver trainer-seat-service.js). Fuera
  // de professionalPremium a propósito: la proyección de Stripe lo sobrescribe entero.
  trainerSeats: {
    clientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    updatedAt: Date,
    lockedUntil: Date,
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
  // Consentimiento explícito para guardar fotos y vídeos corporales (RGPD).
  // null = aún no lo ha dado y no puede subir (docs/plan-medidas-multimedia.md).
  mediaConsentAt: { type: Date, default: null },
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
      await require("../trainerBilling/adapter").assertDeletionAllowed([user._id]);
      // Antes de cualquier cascada: lo que esta cuenta deja en las de otros
      // (alimentos en el diario de sus clientes, fases y rutinas asignadas)
      // se conserva para ellos. Ver account-deletion-keep.js.
      await require("./account-deletion-keep").keepOtherUsersData(user._id);
      // Antes: deleteOne sobre el wrapper Diet, que arrastraba sus DietDay en
      // cascada. Sin wrapper, se borran directos por dueño — y el hook
      // deleteMany de DietDay sigue arrastrando Meals y su contenido.
      await dietDaySchema.deleteMany({ userId: user._id });
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
      // Plantillas de dieta del trainer, y copias congeladas de asignaciones
      // que él creó (mismo documento — ver diet-template-schema.js). El hook
      // pre('deleteMany') de ese schema ya cascada CustomProduct/CustomRecipe
      // de cada plantilla.
      await dietTemplateSchema.deleteMany({ trainerId: user._id });

      // El usuario puede ser el trainer O el cliente de cada una de estas
      // relaciones — hay que limpiar por ambos lados.
      await trainerClientSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await trainerNoteSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      // Cobros: se borran igual que el resto (decisión vigente; la baja de una
      // relación los conserva, el borrado de la cuenta no). Ver
      // components/trainerPayments/README.md.
      await trainerPaymentSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await require("../trainerPayments/trainer-payment-profile-schema").deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await require("../trainerPayments/trainer-payment-settings-schema").deleteMany({ trainerId: user._id });
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
      await require("../trainerCheckins/checkin-schedule-schema").deleteMany({ $or: [{ trainerId: user._id }, { clientId: user._id }] });
      await notificationSchema.deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      // Copias congeladas asignadas a este usuario COMO CLIENTE (el lado
      // trainerId ya se cubrió arriba, junto con sus plantillas reales), y
      // las plantillas de biblioteca que eran exclusivas suyas
      // (ownerClientId): sin el cliente no significan nada, mismo criterio
      // que sus fases asignadas.
      await dietTemplateSchema.deleteMany({
        $or: [{ clientId: user._id }, { ownerClientId: user._id }],
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

      // Fotos y vídeos (docs/plan-medidas-multimedia.md). Cada deleteMany
      // arrastra sus MediaAsset, y el hook de MediaAsset borra los archivos
      // en R2/Bunny. Al final, los MediaAsset sueltos (subidas sin colgar de
      // nada) de los que el usuario es dueño o protagonista.
      await require("../progressMedia/progress-media-schema").deleteMany({ userId: user._id });
      await require("../formChecks/form-check-schema").deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await require("../techniqueVideos/technique-video-schema").deleteMany({ trainerId: user._id });
      await require("../techniqueVideos/technique-video-override-schema").deleteMany({
        $or: [{ trainerId: user._id }, { clientId: user._id }],
      });
      await require("../media/media-schema").deleteMany({
        $or: [{ ownerId: user._id }, { subjectId: user._id }],
      });

      // Recientes ocultos del buscador de alimentos.
      await require("../hiddenRecentFoods/hidden-recent-food-schema").deleteMany({ userId: user._id });

      // Datos de salud del cliente (dolor, suplementación, alergias y
      // preferencias) y el seguimiento del profesional sobre él, por los dos
      // lados. Sobrevivían al borrado de la cuenta.
      const bothSides = { $or: [{ trainerId: user._id }, { clientId: user._id }] };
      const { PainEntry, PainThreshold } = require("../painLog/pain-schema");
      await PainEntry.deleteMany({ userId: user._id });
      await PainThreshold.deleteMany(bothSides);
      await require("../supplements/supplement-schema").Supplement.deleteMany(bothSides);
      await require("../nutritionPreferences/nutrition-preferences-schema").deleteMany({ clientId: user._id });
      await require("../routineAssignments/routine-assignment-schema").deleteMany(bothSides);
      await require("../planChanges/plan-change-schema").deleteMany(bothSides);
      const CoachAlert = require("../coachAlerts/coach-alert-schema");
      await CoachAlert.deleteMany(bothSides);
      await CoachAlert.updateMany({ resolvedBy: user._id }, { $unset: { resolvedBy: "" } });
      await require("../coachTasks/coach-task-schema").deleteMany(bothSides);
      await require("../clientNotes/trainer-note-read-schema").deleteMany(bothSides);
      // Biblioteca del profesional (reglas, protocolos, puntuaciones de
      // ejercicios), y el cliente borrado fuera de las reglas de otros.
      const CoachRule = require("../coachRules/coach-rule-schema");
      await CoachRule.deleteMany({ trainerId: user._id });
      await CoachRule.updateMany({ clientIds: user._id }, { $pull: { clientIds: user._id } });
      await require("../coachProtocols/coach-protocol-schema").deleteMany({ trainerId: user._id });
      await require("../exerciseScores/exercise-score-schema").deleteMany({ trainerId: user._id });
    }
    next();
  } catch (e) {
    next(e);
  }
});

// Los scripts de limpieza no pueden saltarse la preparación explícita de facturación.
UserSchema.pre(["deleteMany", "findOneAndDelete"], async function () {
  const users = await this.model.find(this.getQuery()).select("_id").lean();
  await require("../trainerBilling/adapter").assertDeletionAllowed(users.map((user) => user._id));
});

module.exports = mongoose.model("User", UserSchema);
