const mongoose = require("mongoose");
const { CustomCheckinQuestionSchema } = require("./checkin-custom-question");

// La programación de check-ins de un cliente: qué se le pregunta y cada
// cuánto. Las ocurrencias NO se materializan (no hay cron ni colección de
// solicitudes): se calculan al vuelo con checkin-schedule-dates.js y lo único
// que se persiste es la respuesta (CheckinResponse).
//
// Las preguntas se copian de la plantilla al programar (nunca una referencia
// viva), conservando el _id de cada pregunta propia: la respuesta viaja con
// la clave "custom:<id>" y regenerarlos dejaría huérfanas las anteriores.
const schema = new mongoose.Schema({
  trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, maxlength: 100 },
  sourceTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  enabledFields: [String],
  requiredFields: { type: [String], default: [] },
  customQuestions: { type: [CustomCheckinQuestionSchema], default: [] },
  // "YYYY-MM-DD" y "HH:mm" de reloj: sin zona horaria, ver
  // checkin-schedule-dates.js.
  startDate: { type: String, required: true },
  time: { type: String, required: true },
  frequency: { type: String, enum: ["once", "daily", "weekly", "monthly"], required: true },
  interval: { type: Number, min: 1, max: 52, default: 1 },
  active: { type: Boolean, default: true },
  // Contador para detectar ediciones concurrentes desde dos pantallas.
  revision: { type: Number, default: 0 },
}, { collection: "checkinschedules", timestamps: true });

schema.index({ trainerId: 1, clientId: 1 });
schema.index({ clientId: 1, active: 1 });

module.exports = mongoose.model("CheckinSchedule", schema);
