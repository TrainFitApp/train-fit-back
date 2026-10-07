const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Schema = mongoose.Schema;
const NutritionalGoalSchema = require("../nutritionalGoals/nutritional-goal-schema");
const NutritionPreferencesSchema = require("../nutritionPreferences/nutrition-preferences-schema");
const TrainerPaymentSettingsSchema = require("../trainerPayments/trainer-payment-settings-schema");
const { TrainerIntakeConfigSchema } = require("../trainerIntakeConfig/trainer-intake-config-schema");
const { EMAIL_FORMAT_REGEX } = require("../util/normalize-email");
const { accountCascade, deleteAccountData } = require("../util/account-cascade");
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
  height: { type: Number, min: 70, max: 300 },
  status: String,
  roles: { type: [String], default: undefined },
  sex: Number,
  activity: Number,
  objetive: Number,
  steps: Number,
  training: Number,
  // Día de calendario "YYYY-MM-DD": la fecha que eligió el usuario, sin hora
  // ni huso (users/age-policy.js valida y cuenta la edad).
  birth: String,
  // Sus objetivos nutricionales (nutritionalGoals/nutritional-goal-dao.js) y
  // el que rige (`_id` de uno de ellos).
  nutritionalGoals: { type: [NutritionalGoalSchema], default: undefined },
  goalInUse: Schema.Types.ObjectId,
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
  // Nota fijada de la pantalla de dieta (los días cuelgan del usuario por
  // DietDay.userId).
  dietPinnedNote: { type: String, trim: true, maxlength: 500 },
  // La última rutina (y sesión a medias) que eligió el usuario o su
  // entrenador, con cuándo. La que tiene en uso de verdad se calcula junto con
  // sus fases de rutina (routineAssignments/routine-in-use.js): nunca se lee
  // este campo a pelo.
  tableInUse: Schema.Types.ObjectId,
  tableInUseAt: Date,
  workoutInUse: Schema.Types.ObjectId,
  workoutInUseAt: Date,
  // Lo que ha marcado como favorito. Solo se toca por
  // favorites/favorites-dao.js.
  favorites: {
    products: { type: [Schema.Types.ObjectId], default: [] },
    recipes: { type: [Schema.Types.ObjectId], default: [] },
    exercises: { type: [Schema.Types.ObjectId], default: [] },
  },
  personalAds: Boolean,
  lastLogin: Date,
  // Zona horaria IANA del móvil ("Europe/Madrid"). La pone el middleware de
  // auth con la cabecera X-Timezone; de ella sale el "hoy" del usuario
  // también cuando lo calcula otro (su entrenador). Ver util/date-util.js.
  timezone: { type: String, default: null },
  premium: {
    entitled: { type: Boolean, default: false },
    plan: String,
    expiresAt: Date,
    source: String,
    lastSyncAt: Date,
  },
  // Suscripción del entrenador a TrainFit, separada de `premium` (consumidor,
  // RevenueCat). Solo la escribe la facturación de Trainers (Stripe) como
  // proyección de su cuenta: plan, periodicidad y plazas de clientes contratadas
  // (ver feature-access.js#trainerPlan).
  professionalPremium: {
    entitled: { type: Boolean, default: false },
    // "free" | "starter" | "professional" | "scale" (trainerBilling/src/catalog.ts)
    tier: String,
    // "monthly" | "annual"
    interval: String,
    // Plazas contratadas: las incluidas en el plan más las adicionales.
    seats: Number,
    expiresAt: Date,
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
  // Consentimiento explícito para guardar fotos y vídeos corporales (RGPD),
  // con la versión del texto aceptado. Sin él, o con una versión anterior a
  // media-access#MEDIA_CONSENT_VERSION, no puede subir.
  mediaConsentAt: { type: Date, default: null },
  mediaConsentVersion: { type: String, default: null },
  // Preferencias y restricciones de nutrición del cliente (alergias, flags,
  // comidas que hace). Sin subdocumento = nunca pedidas ni respondidas. Se
  // leen y escriben solo por nutritionPreferences/nutrition-preferences-dao.js.
  nutritionPreferences: { type: NutritionPreferencesSchema, default: undefined },
  // Recientes que ha quitado del buscador de alimentos, por comida (posición,
  // Desayuno = 0…) y pestaña. Los recientes no se guardan: se calculan del
  // historial (recentFoods/recent-food-dao.js) y esto solo dice qué quitar.
  // refId null = «Borrar todos» de esa comida; lo añadido después de
  // `hiddenAt` vuelve a salir (recentFoods/recent-food-match.js).
  hiddenRecentFoods: {
    type: [
      new Schema(
        {
          mealIndex: { type: Number, required: true, min: 0 },
          kind: { type: String, enum: ["product", "recipe"], required: true },
          refId: { type: Schema.Types.ObjectId, default: null },
          hiddenAt: { type: Date, required: true },
        },
        { _id: false },
      ),
    ],
    default: undefined,
  },
  // Ajustes propios del profesional; sin subdocumento, los de defecto.
  // `payments`: hora, zona y avisos de sus cobros (trainerPayments/trainer-payment-dao.js).
  // `intake`: campos y preguntas de su cuestionario inicial (trainerIntakeConfig/trainer-intake-config-dao.js).
  trainerSettings: {
    payments: { type: TrainerPaymentSettingsSchema, default: undefined },
    intake: { type: TrainerIntakeConfigSchema, default: undefined },
  },
});

UserSchema.plugin(require("mongoose-autopopulate"));

// La contraseña se guarda cifrada, y cada cambio sube su versión (los tokens
// emitidos con la anterior dejan de valer).
UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.passwordVersion = this.isNew ? Math.max(this.passwordVersion || 0, 1) : (this.passwordVersion || 0) + 1;
  this.password = await bcrypt.hash(this.password, SALT_WORK_FACTOR);
});

// Lo que otras cuentas guardan de esta: el cliente sale de las plazas
// elegidas de su entrenador, y una sesión de impersonación abierta por un
// admin que se borra se cierra (sin admin al que volver no puede seguir).
UserSchema.plugin(accountCascade, {
  detach: {
    "trainerSeats.clientIds": "pull",
    "auth.impersonatedByUserId": { $unset: { auth: "" } },
  },
  authorship: ["updatedByTrainerId", "requestedBy"],
});

// Borrar una cuenta, por la vía que sea, borra o suelta antes todo lo que
// tiene en las demás colecciones: cada schema declara lo suyo
// (util/account-cascade.js). La facturación de entrenadores exige antes su
// flujo de cancelación (trainerBilling/adapter.js#prepareDeletion).
UserSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], { document: false, query: true }, async function () {
  const filter = this.getFilter();
  const users = this.op === "deleteMany"
    ? await this.model.find(filter).select("_id").lean()
    : [await this.model.findOne(filter).select("_id").lean()].filter(Boolean);
  if (!users.length) return;
  await require("../trainerBilling/adapter").assertDeletionAllowed(users.map((user) => user._id));
  for (const user of users) await deleteAccountData(user._id);
});

// Localizar el dueño de un objetivo por su id (rutas /nutritionalgoals/:id).
UserSchema.index({ "nutritionalGoals._id": 1 });

module.exports = mongoose.model("User", UserSchema);
