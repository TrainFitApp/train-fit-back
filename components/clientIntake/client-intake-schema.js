const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Solo los campos de alcance "relation" del catálogo (goals, healthConditions,
// experienceLevel, availability, equipment) — los "shared" viven en
// ClientNutritionPreferences, no aquí. Un documento por par (trainer, cliente),
// no por ámbito: el cuestionario es el mismo aunque haya relaciones de
// training y nutrition simultáneas con el mismo trainer.
const ClientIntakeSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  goals: { type: String, trim: true, maxlength: 1000 },
  healthConditions: { type: String, trim: true, maxlength: 1000 },
  experienceLevel: {
    type: String,
    enum: ["none", "beginner", "intermediate", "advanced", null],
    default: null,
  },
  availability: { type: String, trim: true, maxlength: 500 },
  equipment: { type: String, trim: true, maxlength: 500 },
  submittedAt: { type: Date, default: Date.now },
});

ClientIntakeSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("ClientIntake", ClientIntakeSchema);
