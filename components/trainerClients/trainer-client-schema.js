const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TrainerClientSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // clientId queda AUSENTE del documento (nunca `null` explícito) hasta que el
    // invitado acepta y se resuelve a un usuario real — ver modelos-de-datos/01-trainerclient.md.
    clientId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    clientEmail: { type: String, required: true, trim: true, lowercase: true },
    scope: {
      type: String,
      enum: ["training", "nutrition"],
      required: true,
    },
    // TAREA 3 (coach-tab) — "active" se mantiene como valor literal a
    // propósito: es el único gate que ya comprueban ~15 archivos existentes
    // (requireActiveClient, hasActiveRelation, coach-dashboard, billing F14/
    // F21) y renombrarlo obligaría a tocarlos todos sin necesidad real.
    // "cuestionario_pendiente"/"en_revision" eran estados intermedios
    // (aceptar → cuestionario → confirmación del profesional → "active").
    // Desde 2026-09 aceptar pasa directo a "active" (ver intakePending);
    // se conservan en el enum por los datos antiguos. No existe "pausado" (rompería la
    // regla ya documentada de que revoked es terminal, sin deshacer — F08)
    // ni "finalizado" (redundante con revoked/declined, que ya cubren
    // "relación terminada").
    status: {
      type: String,
      enum: ["pending", "cuestionario_pendiente", "en_revision", "active", "revoked", "declined"],
      default: "pending",
      index: true,
    },
    // 2026-09 — aceptar la invitación ya deja la relación "active" (el
    // cliente sale en Clientes al momento); el cuestionario inicial queda
    // pendiente aparte, sin bloquear nada. Todas las relaciones del mismo
    // par (trainer, cliente) llevan el mismo valor: el cuestionario es uno
    // por par, no por scope. "cuestionario_pendiente"/"en_revision" solo
    // quedan en datos antiguos.
    intakePending: { type: Boolean, default: false },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // TASK-065 (MASTER_BACKLOG.md) — recordatorio único si la invitación
    // sigue en "pending" (nunca aceptada) pasados unos días. Ver
    // invite-reminder-service.js. No aplica a otros estados.
    lastReminderSentAt: { type: Date, default: null },
    // `null` debe estar en la lista del enum explícitamente — Mongoose no
    // exime automáticamente el default:null de la validación de enum.
    revokedBy: { type: String, enum: ["trainer", "client", null], default: null },
    // Tarea 3 bis (2026-08) — "Objetivo de entrenamiento", paridad con
    // Nutrición pero en su versión mínima: un tipo de objetivo, editable por
    // el entrenador en cualquier momento (no un cuestionario de una sola vez
    // como ClientIntake.goals). Solo tiene sentido en el documento
    // scope:"training" de este par.
    //
    // Tenía también `trainingFrequencyTarget` (frecuencia declarada a mano),
    // quitado 2026-09: nunca llegó a ser el denominador real de "adherencia
    // de entrenamiento" — esa se calcula sobre la fase vigente
    // (RoutineAssignment), no sobre un número declarado aparte.
    trainingGoalType: {
      type: String,
      enum: ["strength", "hypertrophy", "endurance", "mobility", "general", null],
      default: null,
    },
  },
  { collection: "trainerclients" }
);

// Evita invitaciones duplicadas del mismo profesional al mismo email para el mismo
// ámbito MIENTRAS estén pendientes, en curso de alta o activas — permite
// reinvitar tras un revoked/declined.
TrainerClientSchema.index(
  { trainerId: 1, clientEmail: 1, scope: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending", "cuestionario_pendiente", "en_revision", "active"] },
    },
  }
);

// Acelera la consulta más frecuente de todas (requireActiveClient).
TrainerClientSchema.index({ trainerId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model("TrainerClient", TrainerClientSchema);
