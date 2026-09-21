const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Tab Coach, Fase 4 — tarea/hábito diario que el profesional asigna a un
// cliente concreto (p.ej. "caminar 10.000 pasos"). Registro de cumplimiento
// 100% manual (el cliente lo marca él mismo cada día) — sin integración con
// salud del dispositivo (HealthKit/Google Fit), decisión explícita de alcance.
// Solo el profesional crea tareas — el cliente únicamente marca cumplimiento
// (ver TaskCompletion), nunca crea las suyas propias.
const TrainerTaskSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["steps", "water", "sleep", "cardio", "custom"],
      required: true,
    },
    // Obligatorio solo si type: "custom" (validado en el controller, igual
    // que sourceTableId/name en assignTable — cada modo tiene sus propios
    // campos obligatorios).
    label: { type: String, trim: true, maxlength: 100, default: null },
    target: { type: Number, required: true, min: 0 },
    // Tope del rango, opcional: un hábito de pasos se pauta como "10.000 a
    // 15.000", no como un número exacto (docs/plan-semanas.md §12). Sin
    // él, `target` es el objetivo a secas ("2 L de agua").
    targetMax: { type: Number, default: null, min: 0 },
    unit: { type: String, required: true, trim: true, maxlength: 20 },
    // Cadencia única de esta fase — "desactivar" una tarea (soft-delete) en
    // vez de borrarla conserva el histórico de TaskCompletion ya generado,
    // mismo criterio que el resto del proyecto (D2 de F08).
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "trainertasks" }
);

TrainerTaskSchema.index({ trainerId: 1, clientId: 1, active: 1 });

// Auditoría cascadas de borrado (2026-08) — TaskCompletion (histórico de
// cumplimiento) nunca se limpiaba, ni al borrar la tarea ni al borrar la
// cuenta del trainer/cliente (ver users/schema.js).
const taskCompletionSchema = require("./task-completion-schema");

const handleDelete = async function (next) {
  try {
    const query = this.getQuery();
    const task = await this.model.findOne(query);
    if (task) await taskCompletionSchema.deleteMany({ taskId: task._id });
    next();
  } catch (error) {
    next(error);
  }
};

TrainerTaskSchema.pre("deleteOne", handleDelete);
TrainerTaskSchema.pre("findOneAndDelete", handleDelete);

TrainerTaskSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const tasks = await this.model.find(filter, "_id");
    await taskCompletionSchema.deleteMany({ taskId: { $in: tasks.map((t) => t._id) } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("TrainerTask", TrainerTaskSchema);
