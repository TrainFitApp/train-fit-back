const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CUSTOM_QUESTION_TYPES } = require("../forms/custom-question");

// Cuestionario de alta: UNO por par (profesional, cliente), embebido en el
// documento del par (TrainerClient.intake). Salud, lesiones, experiencia,
// disponibilidad y material no dependen de si el profesional lleva
// entrenamiento o nutrición. Alergias y preferencias de comida NO se guardan
// aquí: el formulario las escribe en User.nutritionPreferences, y el perfil
// (peso, altura, actividad…) en User (ver trainer-client-service.js#submitIntake).

// Dónde entrena y con qué: catálogo cerrado, mismo criterio que
// INTAKE_FIELD_KEYS (trainerIntakeConfig/intake-field-catalog.js).
const TRAINING_LOCATIONS = ["gym", "home", "outdoor", "mixed"];
const EQUIPMENT_TAGS = [
  "dumbbells",
  "barbell",
  "machines",
  "bands",
  "kettlebells",
  "bench",
  "pullup_bar",
  "none",
];
const EXPERIENCE_LEVELS = ["none", "beginner", "intermediate", "advanced"];

const ClientIntakeSchema = new Schema(
  {
    goals: { type: String, trim: true, maxlength: 1000, default: "" },
    healthConditions: { type: String, trim: true, maxlength: 1000, default: "" },
    experienceLevel: { type: String, enum: [...EXPERIENCE_LEVELS, null], default: null },
    availability: { type: String, trim: true, maxlength: 500, default: "" },
    trainingLocation: { type: String, enum: [...TRAINING_LOCATIONS, null], default: null },
    equipmentTags: { type: [String], enum: EQUIPMENT_TAGS, default: () => [] },
    // Respuestas a las preguntas propias del profesional (con tipo, como en
    // los check-ins), con el enunciado copiado: si después edita o borra la
    // pregunta, el cuestionario ya recibido sigue siendo legible. Ver
    // forms/custom-question.js#buildCustomAnswers.
    customAnswers: {
      type: [
        {
          _id: false,
          questionId: { type: String, required: true },
          label: { type: String, required: true, trim: true, maxlength: 200 },
          type: { type: String, required: true, enum: CUSTOM_QUESTION_TYPES },
          unit: { type: String, default: "" },
          // Número, sí/no (booleano) o texto, según el tipo.
          value: { type: Schema.Types.Mixed, required: true },
        },
      ],
      default: () => [],
    },
    // null mientras el cliente no lo haya enviado (el profesional puede
    // rellenarlo antes, y eso no cuenta como enviado).
    submittedAt: { type: Date, default: null },
    // "Marcar revisado" del profesional: desde entonces el cliente solo lo ve.
    reviewedAt: { type: Date, default: null },
  },
  { _id: false }
);

// Lo que llega del formulario (cliente o profesional) nunca se guarda tal
// cual: textos recortados y catálogos cerrados filtrados. Las respuestas
// propias se validan aparte, contra las preguntas del profesional.
function sanitizeIntakeAnswers(data = {}) {
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    goals: text(data.goals, 1000),
    healthConditions: text(data.healthConditions, 1000),
    experienceLevel: EXPERIENCE_LEVELS.includes(data.experienceLevel) ? data.experienceLevel : null,
    availability: text(data.availability, 500),
    trainingLocation: TRAINING_LOCATIONS.includes(data.trainingLocation) ? data.trainingLocation : null,
    equipmentTags: [...new Set((Array.isArray(data.equipmentTags) ? data.equipmentTags : []).filter((tag) => EQUIPMENT_TAGS.includes(tag)))],
  };
}

module.exports = { ClientIntakeSchema, TRAINING_LOCATIONS, EQUIPMENT_TAGS, EXPERIENCE_LEVELS, sanitizeIntakeAnswers };
