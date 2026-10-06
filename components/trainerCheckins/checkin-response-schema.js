const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// La respuesta de un check-in: UNA por ocurrencia de la programación
// (scheduleId + occurrenceDate). Mientras la ocurrencia sigue abierta —
// desde su día hasta la víspera de la siguiente — el cliente puede
// reescribirla tantas veces como quiera y se guarda `updatedAt`; cuando la
// ventana pasa, queda congelada (ver checkin-agenda-service.js).
//
// Guarda TODOS los valores respondidos (bienestar, composición corporal y
// perímetros). Los de composición se escriben ADEMÁS en Anthropometry, que es
// lo que alimenta las gráficas de peso, no en lugar de esto.
const CheckinResponseSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scheduleId: { type: Schema.Types.ObjectId, ref: "CheckinSchedule", required: true },
  // Día de la ocurrencia a la que responde ("YYYY-MM-DD").
  occurrenceDate: { type: String, required: true },
  name: { type: String },
  // Copia de las preguntas tal y como estaban al responder: la programación
  // puede cambiar después y la respuesta tiene que seguir leyéndose.
  enabledFields: { type: [String], default: [] },
  requiredFields: { type: [String], default: [] },
  customQuestions: { type: [require("../forms/custom-question").CustomQuestionSchema], default: [] },
  values: { type: Schema.Types.Mixed, required: true }, // { [fieldKey]: number|string }
  respondedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["responded", "reviewed"], default: "responded" },
  reviewedAt: { type: Date, default: null },
  reviewComment: { type: String, default: "", maxlength: 2000 },
  seenByTrainer: { type: Boolean, default: false },
  // A qué SEMANA de qué fase de dieta pertenece (docs/plan-semanas.md). Las
  // semanas son naturales, de lunes a domingo: el check-in cae dentro de una
  // y su dato es con el que se ajusta la siguiente. Ausente si el cliente no
  // tenía fase de dieta ese día.
  week: {
    phaseId: { type: Schema.Types.ObjectId, ref: "DietPhase" },
    number: { type: Number },
    start: { type: String },
    end: { type: String },
  },
}, { collection: "checkinresponses" });

// Una respuesta por ocurrencia: el segundo envío la reescribe, no crea otra.
CheckinResponseSchema.index({ scheduleId: 1, occurrenceDate: 1 }, { unique: true });
CheckinResponseSchema.index({ trainerId: 1, clientId: 1, respondedAt: -1 });
CheckinResponseSchema.index({ clientId: 1, "week.phaseId": 1, "week.number": 1 });

CheckinResponseSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "clientId"] });

module.exports = mongoose.model("CheckinResponse", CheckinResponseSchema);
