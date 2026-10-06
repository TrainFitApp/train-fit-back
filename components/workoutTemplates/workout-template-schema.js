const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const WorkoutBase = require("../workouts/workout-base-schema");

// Plantilla suelta de sesión del profesional, reutilizable al construir
// rutinas (se aplica a un microciclo creando una sesión nueva). Comparte
// colección y forma con la sesión (workout-base-schema.js) y lleva solo lo
// suyo: dueño y ficha de biblioteca. Nunca cuelga de un microciclo.
const WorkoutTemplateSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  level: {
    type: String,
    enum: ["principiante", "intermedio", "avanzado"],
    default: "intermedio",
  },
  tags: { type: [String], default: [] },
  equipment: { type: [String], default: [] },
});

WorkoutTemplateSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"] });

module.exports = WorkoutBase.discriminator("WorkoutTemplate", WorkoutTemplateSchema, "template");
