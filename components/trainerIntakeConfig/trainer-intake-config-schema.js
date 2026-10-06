const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");
const { CustomQuestionSchema } = require("../forms/custom-question");

// TASK-049 (MASTER_BACKLOG.md) — antes el cuestionario inicial era un
// esquema fijo, idéntico para todos los trainers de la plataforma, sin
// ningún override posible desde la UI. Uno por trainer (no por cliente — la
// personalización es del profesional, no por relación individual). Desde
// 2026-10 vive EMBEBIDO en su usuario (User.trainerSettings.intake): era una
// colección propia (`trainerintakeconfigs`) con un documento por trainer que
// solo se leía por `trainerId`. Sin subdocumento todavía = todos los campos
// activos (retrocompatible).
const TrainerIntakeConfigSchema = new Schema(
  {
    enabledFields: {
      type: [String],
      default: () => [...INTAKE_FIELD_KEYS],
      validate: {
        validator: (fields) => fields.every((f) => INTAKE_FIELD_KEYS.includes(f)),
        message: "Campo de intake no reconocido en el catálogo",
      },
    },
    // Preguntas propias con tipo (las mismas que en los check-ins). Valen
    // para cualquier cliente del profesional, lleve el scope que lleve.
    customQuestions: { type: [CustomQuestionSchema], default: () => [] },
    // Últimos checkboxes de ámbito marcados en la pantalla de invitar (no el
    // scope de ninguna invitación en concreto) — solo para recordar el
    // estado de esos 2 checkboxes la próxima vez que el trainer entre,
    // igual que enabledFields recuerda los del cuestionario.
    lastScopes: {
      type: [String],
      default: () => [],
      validate: {
        validator: (scopes) => scopes.every((s) => ["training", "nutrition"].includes(s)),
        message: "lastScopes solo admite 'training'/'nutrition'",
      },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

module.exports = TrainerIntakeConfigSchema;
