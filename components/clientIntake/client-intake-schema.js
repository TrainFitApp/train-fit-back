const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// TAREA 3 (coach-tab) — cuestionario inicial obligatorio, UNO por par
// (profesional, cliente) — no por scope: salud/lesiones/experiencia/
// disponibilidad/equipamiento no dependen de si el scope es entrenamiento o
// nutrición. Alergias/preferencias alimentarias NO se duplican aquí — el
// cuestionario reutiliza ClientNutritionPreferences (F29) para esa parte,
// ver client-intake-service.js#submitIntake.
const ClientIntakeSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    goals: { type: String, trim: true, maxlength: 1000, default: "" },
    healthConditions: { type: String, trim: true, maxlength: 1000, default: "" },
    experienceLevel: {
      type: String,
      enum: ["none", "beginner", "intermediate", "advanced", null],
      default: null,
    },
    availability: { type: String, trim: true, maxlength: 500, default: "" },
    equipment: { type: String, trim: true, maxlength: 500, default: "" },
    // Respuestas a las preguntas custom del trainer (ver
    // trainerIntakeConfig/trainer-intake-config-schema.js#customQuestions).
    // Se guarda el label junto a la respuesta (snapshot en el momento del
    // envío) para que si el trainer edita o borra la pregunta más tarde, el
    // cuestionario ya recibido siga siendo legible sin tener que resolver el
    // questionId contra una config que puede haber cambiado.
    customAnswers: {
      type: [
        {
          _id: false,
          questionId: { type: String, required: true },
          label: { type: String, required: true, trim: true, maxlength: 200 },
          value: { type: String, trim: true, maxlength: 1000, default: "" },
        },
      ],
      default: () => [],
    },
    submittedAt: { type: Date, default: Date.now },
  },
  { collection: "clientintakes" }
);

ClientIntakeSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("ClientIntake", ClientIntakeSchema);
