const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

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
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "trainerintakeconfigs" }
);

module.exports = mongoose.model("TrainerIntakeConfig", TrainerIntakeConfigSchema);
