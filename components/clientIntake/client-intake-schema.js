const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Tarea 3 (Trainers, 2026-08) — "Equipamiento utilizado" (Entrenamiento)
// sustituye el antiguo campo `equipment` de texto libre por dos campos
// estructurados: dónde entrena y con qué. Catálogo cerrado, mismo criterio
// que INTAKE_FIELD_KEYS (trainerIntakeConfig/intake-field-catalog.js) — un
// tag libre sin validar es el mismo problema que ese catálogo ya resolvió.
// `equipment` (String) NO se borra ni se re-usa: es dato legado de
// cuestionarios ya enviados antes de este cambio, se sigue leyendo en la
// ficha del cliente si los campos nuevos vienen vacíos, nunca se escribe de
// nuevo desde el formulario.
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
    // DEPRECATED — ver nota de cabecera. Sustituido por trainingLocation +
    // equipmentTags; se mantiene solo para no perder lo ya respondido.
    equipment: { type: String, trim: true, maxlength: 500, default: "" },
    trainingLocation: { type: String, enum: [...TRAINING_LOCATIONS, null], default: null },
    equipmentTags: { type: [String], enum: EQUIPMENT_TAGS, default: () => [] },
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
    // El profesional lo marca revisado desde la ficha ("Marcar revisado").
    // Hasta entonces el cliente puede editarlo o rehacerlo; después solo verlo.
    reviewedAt: { type: Date, default: null },
  },
  { collection: "clientintakes" }
);

ClientIntakeSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

const ClientIntakeModel = mongoose.model("ClientIntake", ClientIntakeSchema);
// Adjuntos al propio modelo (no un export nombrado aparte) para no romper
// los `require("./client-intake-schema")` ya existentes, que esperan el
// modelo tal cual — client-intake-dao.js#sanitizeEquipmentTags es el único
// consumidor nuevo de estas dos listas.
ClientIntakeModel.TRAINING_LOCATIONS = TRAINING_LOCATIONS;
ClientIntakeModel.EQUIPMENT_TAGS = EQUIPMENT_TAGS;

module.exports = ClientIntakeModel;
