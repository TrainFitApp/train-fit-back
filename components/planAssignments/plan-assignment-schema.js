const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Auditoría de arquitectura (nutrición) — la pieza que hoy no existe: un
// registro de que "este plan (DietTemplate/NutritionPlan) aplica a este
// cliente desde tal fecha, hasta tal otra o indefinidamente". Antes de esto,
// "aplicar una plantilla" era solo un efecto secundario (escribir N DietDay
// reales) sin ningún rastro consultable de que el plan seguía vigente.
//
// endMode determina cómo se calculó endDate al crear la asignación:
//   - "fixedDate": endDate = la fecha exacta elegida
//   - "duration":  endDate = startDate + N días (se guarda ya calculada)
//   - "indefinite": endDate = null — sigue vigente hasta que se sustituya
const PlanAssignmentSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: "DietTemplate", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: String, required: true }, // "YYYY-MM-DD", mismo formato que DietDay.date
    endMode: { type: String, enum: ["fixedDate", "duration", "indefinite"], required: true },
    endDate: { type: String, default: null }, // "YYYY-MM-DD" o null si indefinido
    status: { type: String, enum: ["active", "superseded", "ended"], default: "active", index: true },
    // Encadena con la asignación que la sustituyó — permite reconstruir el
    // historial de fases sin perder rastro de lo que regía antes.
    supersededBy: { type: Schema.Types.ObjectId, ref: "PlanAssignment", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "planassignments" }
);

// Resolver "¿qué plan rige hoy para este cliente?" es la consulta más
// frecuente de este modelo — un índice compuesto la deja en O(log n) en vez
// de escanear todas las asignaciones históricas del cliente.
PlanAssignmentSchema.index({ clientId: 1, status: 1, startDate: 1 });

// Auditoría cascadas de borrado (2026-08) — las DietException puntuales de
// una asignación no tenían ningún camino de limpieza: ni al borrar la
// asignación, ni al borrar la cuenta del cliente/trainer (ver users/schema.js).
const dietExceptionSchema = require("../dietExceptions/diet-exception-schema");

const handleDelete = async function (next) {
  try {
    const query = this.getQuery();
    const assignment = await this.model.findOne(query);
    if (assignment) await dietExceptionSchema.deleteMany({ assignmentId: assignment._id });
    next();
  } catch (error) {
    next(error);
  }
};

PlanAssignmentSchema.pre("deleteOne", handleDelete);
PlanAssignmentSchema.pre("findOneAndDelete", handleDelete);

PlanAssignmentSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const assignments = await this.model.find(filter, "_id");
    await dietExceptionSchema.deleteMany({
      assignmentId: { $in: assignments.map((a) => a._id) },
    });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("PlanAssignment", PlanAssignmentSchema);
