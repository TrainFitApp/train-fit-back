const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase de rutina de un cliente: "esta Table rige para este cliente desde tal
// fecha". El equivalente de DietPhase en entrenamiento, sin fin propio: una
// fase rige hasta que empieza la siguiente. Qué fase es la última, cuál rige
// hoy o cuál sustituyó a cuál se deduce del orden (util/phase-chain.js): no
// se guarda ningún estado de la cadena.
//
// La rutina que el cliente tiene en uso tampoco se escribe desde aquí: se
// calcula (routine-in-use.js).
const RoutineAssignmentSchema = new Schema(
  {
    tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: String, required: true }, // "YYYY-MM-DD"
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "routineassignments" }
);

// "¿Qué rutina rige tal día?" y el historial: siempre por cliente, en el
// orden de la cadena.
RoutineAssignmentSchema.index({ clientId: 1, startDate: -1, createdAt: -1 });

RoutineAssignmentSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["clientId", "trainerId"] });

module.exports = mongoose.model("RoutineAssignment", RoutineAssignmentSchema);
