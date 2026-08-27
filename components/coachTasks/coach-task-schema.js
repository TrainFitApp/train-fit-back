const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 1 Coach Pro — el pendiente DEL PROFESIONAL ("revisar la nutrición de
// Ana", "contactar a Juan").
//
// Colección aparte de TrainerTask, y con nombre distinto a propósito: pese
// al nombre, TrainerTask es un hábito diario que el profesional asigna AL
// CLIENTE (pasos, agua, sueño) y que el cliente marca cada día vía
// TaskCompletion. Son dos cosas opuestas — una la ejecuta el cliente, otra
// el coach — y meterlas en la misma colección con un campo "de quién es"
// obligaría a filtrar por él en los ~6 sitios que ya consultan TrainerTask,
// con el riesgo permanente de que alguien olvide el filtro y le muestre al
// cliente los recordatorios internos de su entrenador.
const CoachTaskSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Opcional: hay pendientes que no son de ningún cliente concreto
    // ("preparar plantillas de volumen"). Cuando está, la tarea aparece
    // también en la ficha de ese cliente.
    clientId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },

    // "YYYY-MM-DD", mismo formato y mismo criterio de comparación por
    // igualdad/rango de string que DietDay.date y TaskCompletion.date en
    // todo el proyecto — nunca un Date con zona horaria para algo que el
    // usuario percibe como un día de calendario.
    dueDate: { type: String, default: null },

    status: { type: String, enum: ["pending", "done"], default: "pending", index: true },
    completedAt: { type: Date, default: null },

    // Trazabilidad: de qué alerta salió esta tarea. Permite que la ficha
    // muestre "creada desde: posible estancamiento" y que cerrar el círculo
    // (alerta -> tarea -> acción) sea visible. En la Fase 3 se le suma
    // sourceRuleId para las tareas que cree una automatización.
    sourceAlertId: { type: Schema.Types.ObjectId, ref: "CoachAlert", default: null },

    createdAt: { type: Date, default: Date.now },
  },
  { collection: "coachtasks" }
);

// Consulta principal: "mis pendientes, los más urgentes primero". dueDate
// ascendente pone antes lo que vence antes; los que no tienen fecha (null)
// van al final en orden ascendente de Mongo.
CoachTaskSchema.index({ trainerId: 1, status: 1, dueDate: 1 });

// La ficha del cliente pide solo los suyos.
CoachTaskSchema.index({ clientId: 1, status: 1 });

module.exports = mongoose.model("CoachTask", CoachTaskSchema);
