const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 4 Coach Pro — la metodología del coach, empaquetada (§20).
//
// "Definición", "Volumen", "Recomposición": cada coach tiene sus propios
// protocolos, y dar de alta a un cliente en uno significa hoy repetir cinco
// operaciones a mano (plantilla de check-in, plan de dieta, rutina, tareas
// diarias) sin nada que garantice que no se olvida
// ninguna.
//
// Un protocolo NO es una entidad nueva de contenido: es una LISTA DE
// REFERENCIAS a lo que ya existe. Aplicarlo ejecuta exactamente las mismas
// operaciones individuales que el coach haría a mano (ver
// coach-protocol-service.js), nunca una vía paralela que pudiera divergir
// de ellas. Por eso aquí no hay ni una comida ni un ejercicio: solo ids.
const CoachProtocolSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },

    // Plantillas del profesional, reutilizables tal cual.
    // Check-ins que se programan al aplicar, cada uno con su cadencia
    // (mismos valores que CheckinSchedule). La fecha de inicio es la de
    // aplicar.
    checkins: [
      {
        _id: false,
        templateId: { type: Schema.Types.ObjectId, ref: "CheckinTemplateDefinition", required: true },
        frequency: { type: String, enum: ["once", "daily", "weekly", "monthly"], default: "weekly" },
        interval: { type: Number, min: 1, max: 52, default: 1 },
        time: { type: String, default: "09:00" },
      },
    ],
    dietTemplateId: { type: Schema.Types.ObjectId, ref: "DietTemplate", default: null },
    routineTemplateId: { type: Schema.Types.ObjectId, ref: "Table", default: null },
    ruleIds: [{ type: Schema.Types.ObjectId, ref: "CoachRule" }],

    // Objetivo nutricional que se fija al aplicar (kcal y g/día, cuadrados
    // con las kcal). null = no se toca el del cliente.
    nutritionTarget: {
      type: new Schema(
        {
          kcal: { type: Number, required: true, min: 1 },
          protein: { type: Number, required: true, min: 0 },
          carbs: { type: Number, required: true, min: 0 },
          fat: { type: Number, required: true, min: 0 },
        },
        { _id: false }
      ),
      default: null,
    },

    // Hábitos diarios (TrainerTask) que se crean para el cliente al aplicar.
    // Mismo shape que TrainerTask menos trainerId/clientId, que solo se
    // conocen al aplicar.
    dailyTasks: [
      {
        type: { type: String, enum: ["steps", "water", "sleep", "cardio", "custom"], required: true },
        label: { type: String, trim: true, maxlength: 100, default: null },
        target: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true, trim: true, maxlength: 20 },
      },
    ],
  },
  { collection: "coachprotocols", timestamps: true }
);

CoachProtocolSchema.index({ trainerId: 1, name: 1 }, { unique: true });

CoachProtocolSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"] });

module.exports = mongoose.model("CoachProtocol", CoachProtocolSchema);
