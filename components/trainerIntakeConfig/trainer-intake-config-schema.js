const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");
const { INTAKE_MEASUREMENT_KEYS, INTAKE_PHOTO_POSES, VIDEO_LABEL_MAX } = require("./intake-requests");
const { CustomQuestionSchema } = require("../forms/custom-question");

// Lo que el profesional pide además de preguntas (intake-requests.js): cada
// medida, las fotos y cada vídeo, obligatorio u opcional.
const MeasurementRequestSchema = new Schema(
  {
    key: { type: String, required: true, enum: INTAKE_MEASUREMENT_KEYS },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const PhotoRequestSchema = new Schema(
  {
    poses: {
      type: [{ type: String, enum: INTAKE_PHOTO_POSES }],
      validate: { validator: (poses) => poses.length > 0, message: "Elige al menos una pose" },
    },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

// Con _id: la respuesta del cliente lo referencia (TrainerClient.intake.videos).
const videoRequestFields = {
  label: { type: String, required: true, trim: true, maxlength: VIDEO_LABEL_MAX },
  required: { type: Boolean, default: false },
};
// En la configuración, desactivar deja de pedirlo sin perder el texto.
const VideoRequestSchema = new Schema({ ...videoRequestFields, enabled: { type: Boolean, default: true } });
// En el formulario de un cliente solo está lo que se le pide.
const FormVideoRequestSchema = new Schema(videoRequestFields);

const enabledFieldsType = {
  type: [String],
  default: () => [...INTAKE_FIELD_KEYS],
  validate: {
    validator: (fields) => fields.every((f) => INTAKE_FIELD_KEYS.includes(f)),
    message: "Campo de intake no reconocido en el catálogo",
  },
};

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
    enabledFields: enabledFieldsType,
    // Preguntas propias con tipo (las mismas que en los check-ins). Valen
    // para cualquier cliente del profesional, lleve el scope que lleve.
    customQuestions: { type: [CustomQuestionSchema], default: () => [] },
    // Medidas del catálogo de check-in (sin el peso, que va en el perfil).
    measurements: { type: [MeasurementRequestSchema], default: () => [] },
    // Fotos de inicio; null = no se piden.
    photos: { type: PhotoRequestSchema, default: null },
    // Vídeos con lo que tiene que grabar («Sentadilla sin peso, de perfil»).
    videos: { type: [VideoRequestSchema], default: () => [] },
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

// El formulario de alta de UN cliente (TrainerClient.intakeForm): la copia
// de lo que el profesional tenía activo al invitarle
// (intake-requests.js#intakeFormOf). Lo desactivado no se copia (las
// preguntas reutilizan su schema y llevan siempre `enabled: true`). Las
// preguntas propias y los vídeos conservan su _id, que es lo que
// referencian las respuestas.
const IntakeFormSchema = new Schema(
  {
    enabledFields: enabledFieldsType,
    customQuestions: { type: [CustomQuestionSchema], default: () => [] },
    measurements: { type: [MeasurementRequestSchema], default: () => [] },
    photos: { type: PhotoRequestSchema, default: null },
    videos: { type: [FormVideoRequestSchema], default: () => [] },
    // Cuándo se copió (la última invitación que lo abrió).
    sentAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

module.exports = { TrainerIntakeConfigSchema, IntakeFormSchema };
