const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// "Pésate cada X días".
//
// Sustituye a AnthropometryRequest, que pedía CUALQUIER medida del catálogo
// con su propia cadencia. Los perímetros y la composición corporal pasaron a
// pedirse como un check-in más (ver checkin-schedule-schema.js): son un
// formulario que se contesta cada varias semanas y que el entrenador revisa.
// El peso no es eso — es un número que el cliente ya toma solo, casi a
// diario, y montarle encima solicitudes, respuestas y revisiones habría
// llenado la bandeja de treinta trámites al mes para apuntar una cifra.
//
// Por eso aquí no hay ocurrencias ni respuestas: solo cada cuánto debería
// haber un peso nuevo. El cumplimiento NO se guarda, se deduce mirando si
// hay algún peso en Anthropometry dentro de la ventana (ver
// weight-plan-service.js) — así el cliente que se pesa por su cuenta ya
// cumple sin tener que confirmar nada a nadie.
const WeightPlanSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // En días, no en un enum de cadencias: "cada 10 días" es una pauta tan
    // razonable como "cada semana", y tres vocabularios distintos de
    // periodicidad conviviendo es justo lo que este rediseño vino a quitar.
    intervalDays: { type: Number, required: true, min: 1, max: 90 },
    notes: { type: String, default: "", maxlength: 500 },
    lastReminderSentAt: { type: Date, default: null },
  },
  { collection: "weightplans", timestamps: true }
);

// Una pauta por par entrenador-cliente. Quitarla borra el documento: "libre"
// no es un estado que haya que guardar, es no tener pauta.
WeightPlanSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("WeightPlan", WeightPlanSchema);
