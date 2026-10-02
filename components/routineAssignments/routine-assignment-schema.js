const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Tarea 4 (2026-09) — equivalente de PlanAssignment (nutrición) para
// rutinas de entrenamiento: "esta Table aplica a este cliente desde tal
// fecha". Antes de esto, cambiar de rutina era un efecto secundario
// instantáneo (User.tableInUse) sin ningún rastro consultable de fases
// pasadas/futuras.
//
// A diferencia de PlanAssignment, SIN endMode/endDate: una rutina no
// "termina" en el sentido en que termina una dieta — hay exactamente una
// vigente hasta que se sustituye por la siguiente (mismo modelo de puntero
// único que ya usa User.tableInUse). Añadir un endDate sería un campo
// muerto desde el día uno: nada en la app sabe qué significa "sin rutina
// después de tal fecha".
const RoutineAssignmentSchema = new Schema(
  {
    tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: String, required: true }, // "YYYY-MM-DD"
    status: { type: String, enum: ["active", "superseded", "ended"], default: "active", index: true },
    // Encadena con la asignación que la sustituyó — reconstruye el
    // historial de fases sin perder rastro de lo que regía antes.
    supersededBy: { type: Schema.Types.ObjectId, ref: "RoutineAssignment", default: null },
    // Cuándo se puso en uso de forma perezosa (fase programada que ya llegó,
    // ver routine-assignment-service.js#syncTableInUseIfDue). Una vez puesta,
    // no se vuelve a imponer: si el cliente cambia de rutina a mano, manda él.
    activatedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "routineassignments" }
);

// Resolver "¿qué rutina rige hoy para este cliente?" es la consulta más
// frecuente de este modelo.
RoutineAssignmentSchema.index({ clientId: 1, status: 1, startDate: 1 });

module.exports = mongoose.model("RoutineAssignment", RoutineAssignmentSchema);
