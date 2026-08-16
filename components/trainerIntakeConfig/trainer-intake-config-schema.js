const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { INTAKE_FIELDS } = require("../clientIntake/intake-field-catalog");

// Única fuente del catálogo de 9 campos posibles del cuestionario inicial:
// components/clientIntake/intake-field-catalog.js.
const INTAKE_FIELD_KEYS = Object.keys(INTAKE_FIELDS);

const TrainerIntakeConfigSchema = new Schema({
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  enabledFields: {
    type: [{ type: String, enum: INTAKE_FIELD_KEYS }],
    default: INTAKE_FIELD_KEYS,
  },
  updatedAt: { type: Date, default: Date.now },
});

TrainerIntakeConfigSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

TrainerIntakeConfigSchema.statics.FIELD_KEYS = INTAKE_FIELD_KEYS;

module.exports = mongoose.model("TrainerIntakeConfig", TrainerIntakeConfigSchema);
