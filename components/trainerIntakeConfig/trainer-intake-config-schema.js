const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

// A diferencia de enabledFields (catálogo cerrado, ver intake-field-catalog.js),
// estas SÍ son de texto libre inventadas por el trainer — el propio label lo
// define él, no hay validación de contenido más allá de longitud. Sin ámbito
// asociado (de libre selección, igual que los 9 campos predefinidos): una
// pregunta con enabled=true se muestra a CUALQUIER cliente de ese trainer,
// sin importar el scope de su relación concreta (ver
// trainer-client-service.js#getOnboardingStatus). `enabled` existe aparte de
// borrar la pregunta — igual que un campo predefinido se puede desactivar
// sin perder que existió, aquí el trainer puede dejar de mandarla sin perder
// el texto ya escrito.
const CustomIntakeQuestionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: false }
);

// TASK-049 (MASTER_BACKLOG.md) — antes el cuestionario inicial era un
// esquema fijo, idéntico para todos los trainers de la plataforma, sin
// ningún override posible desde la UI. Un documento por trainer (no por
// cliente — la personalización es del profesional, no por relación
// individual). Sin documento guardado todavía = todos los campos activos
// (mismo comportamiento que hoy, retrocompatible).
const TrainerIntakeConfigSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    enabledFields: {
      type: [String],
      default: () => [...INTAKE_FIELD_KEYS],
      validate: {
        validator: (fields) => fields.every((f) => INTAKE_FIELD_KEYS.includes(f)),
        message: "Campo de intake no reconocido en el catálogo",
      },
    },
    customQuestions: { type: [CustomIntakeQuestionSchema], default: () => [] },
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
  { collection: "trainerintakeconfigs" }
);

module.exports = mongoose.model("TrainerIntakeConfig", TrainerIntakeConfigSchema);
