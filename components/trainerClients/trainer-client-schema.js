const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { ClientIntakeSchema } = require("./client-intake-schema");
const { SCOPES, LINK_STATUSES } = require("./pair-state");

// Una entrada por invitación de un scope. Su `_id` es el id de la invitación
// (aceptar, rechazar, cancelar). Ciclo: pending → active | declined, y
// active → revoked. declined y revoked son terminales y se quedan como
// historial: volver a invitar añade otra entrada.
const ScopeLinkSchema = new Schema({
  scope: { type: String, enum: SCOPES, required: true },
  status: { type: String, enum: LINK_STATUSES, required: true, default: "pending" },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, enum: ["trainer", "client", null], default: null },
});

// Hasta dónde trabaja el cliente con una zona dolorida y desde dónde para.
// Lo fija cada profesional para su cliente: dos profesionales del mismo
// cliente pueden tener criterios distintos sobre la misma rodilla.
const PainThresholdSchema = new Schema(
  {
    zone: { type: String, required: true },
    workLevel: { type: Number, min: 0, max: 10, required: true },
    // Nunca menor que workLevel (painLog/pain-catalog.js#sanitizeThreshold).
    painLevel: { type: Number, min: 0, max: 10, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Vídeo de técnica que el profesional pone a este cliente para un
// ejercicio («hazlo con esta variante»): manda sobre su vídeo por defecto.
const TechniqueOverrideSchema = new Schema(
  {
    exerciseId: { type: Schema.Types.ObjectId, ref: "Exercise", required: true },
    techniqueVideoId: { type: Schema.Types.ObjectId, ref: "TechniqueVideo", required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// La relación profesional ↔ cliente: UN documento por par. Es la puerta de
// los permisos de todo el módulo profesional y solo se lee y escribe desde
// trainer-client-dao.js. Lo que es del par y no de un scope (cuestionario de
// alta, objetivo de entrenamiento, fotos anteriores compartidas, umbrales de
// dolor, vídeos de técnica asignados) vive aquí una sola vez, y se va con él
// al borrar cualquiera de las dos cuentas.
const TrainerClientSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Se invita por email (también a quien aún no tiene cuenta). El email de
    // una cuenta no cambia, así que (trainerId, clientEmail) identifica el par.
    clientEmail: { type: String, required: true, trim: true, lowercase: true },
    // Ausente (nunca null) hasta que el cliente acepta su primera invitación.
    clientId: { type: Schema.Types.ObjectId, ref: "User" },
    scopes: { type: [ScopeLinkSchema], default: () => [] },
    // Cuestionario de alta sin enviar: se pone al aceptar el primer scope y
    // se quita cuando el cliente lo envía. Nunca bloquea nada.
    intakePending: { type: Boolean, default: false },
    intake: { type: ClientIntakeSchema, default: null },
    // Fotos de progreso (docs/plan-medidas-multimedia.md, decisión 4): el
    // profesional ve las del cliente desde que empezó la relación; las
    // anteriores, solo si el cliente se las comparte. `AskedAt` evita
    // repetirle la pregunta.
    mediaHistorySharedAt: { type: Date, default: null },
    mediaHistoryAskedAt: { type: Date, default: null },
    // Una por zona y una por ejercicio (ver trainer-client-dao.js#putInList).
    painThresholds: { type: [PainThresholdSchema], default: () => [] },
    techniqueOverrides: { type: [TechniqueOverrideSchema], default: () => [] },
    // Objetivo de entrenamiento que fija el profesional (scope training).
    trainingGoalType: {
      type: String,
      enum: ["strength", "hypertrophy", "endurance", "mobility", "general", null],
      default: null,
    },
  },
  { collection: "trainerclients", timestamps: true }
);

TrainerClientSchema.index({ trainerId: 1, clientEmail: 1 }, { unique: true });
TrainerClientSchema.index(
  { trainerId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $exists: true } } }
);
TrainerClientSchema.index({ clientId: 1 });
TrainerClientSchema.index({ clientEmail: 1 });

TrainerClientSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "clientId"] });

module.exports = mongoose.model("TrainerClient", TrainerClientSchema);
